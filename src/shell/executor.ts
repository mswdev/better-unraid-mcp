import { readFileSync } from "node:fs";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

/** How long to wait for the SSH handshake before giving up. */
const CONNECT_TIMEOUT_MS = 10_000;

/** ssh2 keepalive probe interval, so NAT/firewall state stays warm. */
const KEEPALIVE_INTERVAL_MS = 15_000;

/** Missed keepalive probes before ssh2 declares the connection dead. */
const KEEPALIVE_COUNT_MAX = 3;

/** Upper bound on concurrent exec channels over the one connection. */
const MAX_CONCURRENT_CHANNELS = 4;

/** Idle seconds before the kept-alive connection is closed. */
const DEFAULT_IDLE_SECONDS = 90;

const MS_PER_SECOND = 1_000;

/** Result of one remote command: both output streams plus the exit code. */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Seam for running commands on the Unraid host over SSH; faked in tests. */
export interface ShellExecutor {
  execute(command: string, timeoutMs: number): Promise<ShellResult>;
}

/** Connection settings for the SSH-backed executor. */
export interface SshSettings {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  /** Idle seconds before disconnecting; defaults to 90. */
  idleSeconds?: number;
}

/**
 * A remote process that finished without reporting an exit status (killed by
 * a signal, or the channel dropped mid-run). Never 0: success must be earned.
 */
export const EXIT_CODE_UNKNOWN = -1;

/** One open SSH connection, reduced to what the executor needs. Test seam. */
export interface SshConnection {
  exec(command: string, timeoutMs: number): Promise<ShellResult>;
  end(): void;
  onClose(listener: () => void): void;
}

/** Opens a connection; injectable so tests never touch the network. */
export type SshConnectionFactory = (config: ConnectConfig) => Promise<SshConnection>;

/**
 * Runs commands over ONE kept-alive SSH connection: lazy connect on first
 * use, ssh2 keepalive probes, automatic reconnect after a drop, disconnect
 * after an idle window, and a bounded number of concurrent exec channels.
 * The `ShellExecutor` interface is unchanged, so tools and fakes are
 * untouched.
 */
export class SshShellExecutor implements ShellExecutor {
  private readonly connectConfig: ConnectConfig;
  private readonly idleMs: number;
  private readonly factory: SshConnectionFactory;
  private connection: SshConnection | null = null;
  private connecting: Promise<SshConnection> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private activeChannels = 0;
  private readonly waiters: Array<() => void> = [];

  /**
   * Builds the executor, reading the private key file (when configured) once
   * up front so a bad key path fails at startup instead of on first use.
   *
   * @param settings - Host, port, user, credential, and idle configuration.
   * @param connectionFactory - Injectable connection opener (tests only).
   * @throws Error when the configured private key file cannot be read.
   */
  constructor(settings: SshSettings, connectionFactory: SshConnectionFactory = openSshConnection) {
    this.connectConfig = {
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      privateKey: settings.privateKeyPath ? readFileSync(settings.privateKeyPath) : undefined,
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: KEEPALIVE_COUNT_MAX,
    };
    this.idleMs = (settings.idleSeconds ?? DEFAULT_IDLE_SECONDS) * MS_PER_SECOND;
    this.factory = connectionFactory;
  }

  /**
   * Runs one command on the shared connection, connecting lazily first.
   *
   * @param command - The shell command to run on the host.
   * @param timeoutMs - Overall deadline for the command (and for connecting).
   * @returns The command's stdout, stderr, and exit code.
   * @throws Error on connection failure, auth failure, or timeout.
   */
  async execute(command: string, timeoutMs: number): Promise<ShellResult> {
    const connection = await withTimeout(this.acquireConnection(), timeoutMs, "connect");
    await this.acquireChannel();
    try {
      return await connection.exec(command, timeoutMs);
    } finally {
      this.releaseChannel();
    }
  }

  /** Returns the live connection, opening one (once) when absent. */
  private async acquireConnection(): Promise<SshConnection> {
    if (this.connection) {
      return this.connection;
    }
    this.connecting ??= this.openConnection();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** Opens a connection and installs the auto-reconnect close handler. */
  private async openConnection(): Promise<SshConnection> {
    const connection = await this.factory(this.connectConfig);
    connection.onClose(() => this.dropConnection(connection));
    this.connection = connection;
    return connection;
  }

  /** Forgets a dropped connection so the next call reconnects. */
  private dropConnection(dropped: SshConnection): void {
    if (this.connection === dropped) {
      this.connection = null;
    }
  }

  /**
   * Takes a channel slot, waiting when all slots are busy. A resumed waiter
   * INHERITS the releasing call's slot (the counter never dips), so a
   * concurrently arriving caller cannot slip past the bound.
   */
  private async acquireChannel(): Promise<void> {
    this.clearIdleTimer();
    if (this.activeChannels < MAX_CONCURRENT_CHANNELS) {
      this.activeChannels += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Hands the slot to a waiter (counter unchanged) or frees it. */
  private releaseChannel(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeChannels -= 1;
    if (this.activeChannels === 0) {
      this.scheduleIdleDisconnect();
    }
  }

  /** Arms the idle-disconnect timer (never blocks process exit). */
  private scheduleIdleDisconnect(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.disconnectIdle(), this.idleMs);
    this.idleTimer.unref?.();
  }

  /** Closes the idle connection; the next call reconnects lazily. */
  private disconnectIdle(): void {
    this.connection?.end();
    this.connection = null;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

/** The real ssh2-backed connection factory. */
async function openSshConnection(config: ConnectConfig): Promise<SshConnection> {
  const client = await connect(config);
  return {
    exec: (command, timeoutMs) => run(client, command, timeoutMs),
    end: () => client.end(),
    onClose: (listener) => {
      client.on("close", listener);
      client.on("error", listener);
    },
  };
}

/** Opens an SSH connection, resolving once the handshake completes. */
function connect(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.once("ready", () => resolve(client));
    client.once("error", reject);
    client.connect(config);
  });
}

/**
 * Executes one command on an open connection under a hard deadline. On
 * timeout the channel is closed (freeing the ssh session slot and stopping
 * output buffering); note the remote process itself may keep running.
 */
function run(connection: Client, command: string, timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    connection.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        stream.close();
        reject(
          new Error(
            `Timed out after ${timeoutMs} ms trying to run the command over SSH. The channel was closed, but the remote process may still be running.`,
          ),
        );
      }, timeoutMs);
      collect(stream, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  });
}

/**
 * Accumulates a stream's stdout/stderr and resolves with the exit code on
 * close. A null code (signal kill, dropped channel) maps to
 * EXIT_CODE_UNKNOWN, never 0 — success must come from a real exit status.
 */
function collect(stream: ClientChannel, resolve: (result: ShellResult) => void): void {
  let stdout = "";
  let stderr = "";
  stream.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  stream.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  stream.on("close", (code: number | null) =>
    resolve({ stdout, stderr, exitCode: code ?? EXIT_CODE_UNKNOWN }),
  );
}

/** Races a promise against a deadline, rejecting with a descriptive timeout error. */
function withTimeout<T>(work: Promise<T>, timeoutMs: number, action: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs} ms trying to ${action} over SSH.`));
    }, timeoutMs);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
