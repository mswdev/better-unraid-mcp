import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ShellResult,
  type SshConnection,
  type SshConnectionFactory,
  SshShellExecutor,
} from "./executor.js";

const okResult: ShellResult = { stdout: "ok\n", stderr: "", exitCode: 0 };

const settings = { host: "tower.local", port: 22, username: "root", password: "pw" };

/** One controllable fake connection: records commands, close is triggerable. */
interface FakeConnection extends SshConnection {
  commands: string[];
  ended: boolean;
  triggerClose(): void;
}

interface FakeExecBehavior {
  /** When set, each exec returns a promise the test resolves manually. */
  deferred?: Array<() => void>;
}

function makeFakeConnection(behavior: FakeExecBehavior = {}): FakeConnection {
  const closeListeners: Array<() => void> = [];
  const connection: FakeConnection = {
    commands: [],
    ended: false,
    exec: (command: string) => {
      connection.commands.push(command);
      if (!behavior.deferred) {
        return Promise.resolve(okResult);
      }
      return new Promise<ShellResult>((resolve) => {
        behavior.deferred?.push(() => resolve(okResult));
      });
    },
    end: () => {
      connection.ended = true;
    },
    onClose: (listener: () => void) => {
      closeListeners.push(listener);
    },
    triggerClose: () => {
      for (const listener of closeListeners) {
        listener();
      }
    },
  };
  return connection;
}

function fakeFactory(behavior: FakeExecBehavior = {}) {
  const connections: FakeConnection[] = [];
  const factory: SshConnectionFactory = async () => {
    const connection = makeFakeConnection(behavior);
    connections.push(connection);
    return connection;
  };
  return { factory, connections };
}

describe("SshShellExecutor connection reuse", () => {
  it("reuses one connection across sequential executes", async () => {
    const { factory, connections } = fakeFactory();
    const executor = new SshShellExecutor(settings, factory);

    await executor.execute("echo one", 1000);
    await executor.execute("echo two", 1000);

    expect(connections).toHaveLength(1);
    expect(connections[0].commands).toEqual(["echo one", "echo two"]);
  });

  it("reconnects after the connection closes", async () => {
    const { factory, connections } = fakeFactory();
    const executor = new SshShellExecutor(settings, factory);

    await executor.execute("echo one", 1000);
    connections[0].triggerClose();
    await executor.execute("echo two", 1000);

    expect(connections).toHaveLength(2);
    expect(connections[1].commands).toEqual(["echo two"]);
  });

  it("surfaces a connect failure and recovers on the next call", async () => {
    let attempts = 0;
    const good = makeFakeConnection();
    const factory: SshConnectionFactory = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("auth failed");
      }
      return good;
    };
    const executor = new SshShellExecutor(settings, factory);

    await expect(executor.execute("echo one", 1000)).rejects.toThrow("auth failed");
    const result = await executor.execute("echo two", 1000);

    expect(result).toEqual(okResult);
    expect(attempts).toBe(2);
  });
});

describe("SshShellExecutor idle disconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the connection after the idle window and reconnects on the next call", async () => {
    const { factory, connections } = fakeFactory();
    const executor = new SshShellExecutor({ ...settings, idleSeconds: 90 }, factory);

    await executor.execute("echo one", 1000);
    vi.advanceTimersByTime(90_000);

    expect(connections[0].ended).toBe(true);

    await executor.execute("echo two", 1000);

    expect(connections).toHaveLength(2);
  });

  it("does not disconnect while a command is in flight", async () => {
    const deferred: Array<() => void> = [];
    const { factory, connections } = fakeFactory({ deferred });
    const executor = new SshShellExecutor({ ...settings, idleSeconds: 1 }, factory);

    const pending = executor.execute("sleep 5", 60_000);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(connections[0]?.ended).toBe(false);

    deferred[0]();
    await pending;
  });
});

describe("SshShellExecutor channel bounding", () => {
  it("runs at most four concurrent channels, queueing the fifth", async () => {
    const deferred: Array<() => void> = [];
    const { factory, connections } = fakeFactory({ deferred });
    const executor = new SshShellExecutor(settings, factory);

    const pending = [1, 2, 3, 4, 5].map((n) => executor.execute(`job ${n}`, 60_000));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connections[0].commands).toHaveLength(4);

    deferred[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connections[0].commands).toHaveLength(5);

    for (const resolve of deferred) {
      resolve();
    }
    await Promise.all(pending);
  });
});
