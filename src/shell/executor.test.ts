import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectConfig } from "ssh2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXIT_CODE_UNKNOWN,
  openSshConnection,
  type ShellResult,
  type SshChannelLike,
  type SshClientConstructor,
  type SshClientLike,
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

  it("ignores a late close from a connection it already replaced", async () => {
    const { factory, connections } = fakeFactory();
    const executor = new SshShellExecutor({ ...settings, idleSeconds: 1 }, factory);
    await executor.execute("echo one", 1000);
    vi.advanceTimersByTime(1_000);
    await executor.execute("echo two", 1000);

    connections[0].triggerClose();
    await executor.execute("echo three", 1000);

    expect(connections).toHaveLength(2);
    expect(connections[1].commands).toEqual(["echo two", "echo three"]);
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

describe("SshShellExecutor connection setup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the configured private key once and hands it to the connection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "executor-key-"));
    const keyPath = join(directory, "id_ed25519");
    writeFileSync(keyPath, "fake-private-key");
    const configs: ConnectConfig[] = [];
    const factory: SshConnectionFactory = async (config) => {
      configs.push(config);
      return makeFakeConnection();
    };
    const executor = new SshShellExecutor({ ...settings, privateKeyPath: keyPath }, factory);

    await executor.execute("echo ok", 1000);
    rmSync(directory, { recursive: true, force: true });

    expect(configs[0].privateKey?.toString()).toBe("fake-private-key");
    expect(configs[0].password).toBe("pw");
  });

  it("times out a connection attempt that never completes", async () => {
    vi.useFakeTimers();
    const never: SshConnectionFactory = () => new Promise<SshConnection>(() => {});
    const executor = new SshShellExecutor(settings, never);

    const pending = executor.execute("echo ok", 1000);
    const assertion = expect(pending).rejects.toThrow(
      "Timed out after 1000 ms trying to connect over SSH.",
    );
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
  });
});

/** A hand-written exec channel: stdout/stderr emitters plus a recorded close(). */
class FakeChannel extends EventEmitter implements SshChannelLike {
  readonly stderr = new EventEmitter();
  closed = false;

  close(): void {
    this.closed = true;
  }
}

/** Scripted behavior for one fake ssh2 client. */
interface FakeClientScript {
  handshake: "ready" | Error;
  execError?: Error;
}

/** Builds a fake ssh2 Client constructor and records every instance it creates. */
function fakeSshClient(script: FakeClientScript) {
  const instances: FakeSshClient[] = [];
  class FakeSshClient extends EventEmitter implements SshClientLike {
    readonly channel = new FakeChannel();
    readonly commands: string[] = [];
    connectedWith: ConnectConfig | null = null;
    ended = false;

    constructor() {
      super();
      instances.push(this);
    }

    connect(config: ConnectConfig): void {
      this.connectedWith = config;
      const { handshake } = script;
      queueMicrotask(() =>
        handshake === "ready" ? this.emit("ready") : this.emit("error", handshake),
      );
    }

    exec(command: string, callback: (error: Error | undefined, channel: SshChannelLike) => void) {
      this.commands.push(command);
      callback(script.execError, this.channel);
    }

    end(): void {
      this.ended = true;
    }
  }
  const ClientImpl: SshClientConstructor = FakeSshClient;
  return { ClientImpl, instances };
}

const connectConfig: ConnectConfig = { host: "tower.local", port: 22, username: "root" };

describe("openSshConnection over an ssh2-style client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects with the given config and resolves once the handshake is ready", async () => {
    const { ClientImpl, instances } = fakeSshClient({ handshake: "ready" });

    await openSshConnection(connectConfig, ClientImpl);

    expect(instances).toHaveLength(1);
    expect(instances[0].connectedWith).toEqual(connectConfig);
  });

  it("rejects with the handshake error", async () => {
    const { ClientImpl } = fakeSshClient({
      handshake: new Error("All configured authentication methods failed"),
    });

    await expect(openSshConnection(connectConfig, ClientImpl)).rejects.toThrow(
      "All configured authentication methods failed",
    );
  });

  it("collects stdout, stderr, and the exit code of a command", async () => {
    const { ClientImpl, instances } = fakeSshClient({ handshake: "ready" });
    const connection = await openSshConnection(connectConfig, ClientImpl);
    const { channel } = instances[0];

    const pending = connection.exec("uptime", 1000);
    channel.emit("data", Buffer.from("up 3 days"));
    channel.emit("data", Buffer.from(", load 0.1"));
    channel.stderr.emit("data", Buffer.from("warning: locale"));
    channel.emit("close", 0);

    await expect(pending).resolves.toEqual({
      stdout: "up 3 days, load 0.1",
      stderr: "warning: locale",
      exitCode: 0,
    });
    expect(instances[0].commands).toEqual(["uptime"]);
  });

  it("maps a channel that closes without an exit status to EXIT_CODE_UNKNOWN", async () => {
    const { ClientImpl, instances } = fakeSshClient({ handshake: "ready" });
    const connection = await openSshConnection(connectConfig, ClientImpl);

    const pending = connection.exec("sleep 100", 1000);
    instances[0].channel.emit("close", null);

    await expect(pending).resolves.toMatchObject({ exitCode: EXIT_CODE_UNKNOWN });
  });

  it("rejects when the server refuses to open an exec channel", async () => {
    const { ClientImpl } = fakeSshClient({
      handshake: "ready",
      execError: new Error("Channel open failure"),
    });
    const connection = await openSshConnection(connectConfig, ClientImpl);

    await expect(connection.exec("uptime", 1000)).rejects.toThrow("Channel open failure");
  });

  it("closes the channel and rejects when a command outlives its deadline", async () => {
    const { ClientImpl, instances } = fakeSshClient({ handshake: "ready" });
    const connection = await openSshConnection(connectConfig, ClientImpl);
    vi.useFakeTimers();

    const pending = connection.exec("sleep 100", 500);
    const assertion = expect(pending).rejects.toThrow(
      /Timed out after 500 ms trying to run the command over SSH/,
    );
    await vi.advanceTimersByTimeAsync(500);

    await assertion;
    expect(instances[0].channel.closed).toBe(true);
  });

  it("ends the client and reports both close and error as a dropped connection", async () => {
    const { ClientImpl, instances } = fakeSshClient({ handshake: "ready" });
    const connection = await openSshConnection(connectConfig, ClientImpl);
    let drops = 0;
    connection.onClose(() => {
      drops += 1;
    });

    instances[0].emit("close");
    instances[0].emit("error", new Error("ECONNRESET"));
    connection.end();

    expect(drops).toBe(2);
    expect(instances[0].ended).toBe(true);
  });
});
