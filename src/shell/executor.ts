import { readFileSync } from "node:fs";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

/** How long to wait for the SSH handshake before giving up. */
const CONNECT_TIMEOUT_MS = 10_000;

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
}

/**
 * Runs each command over a fresh SSH connection to the Unraid host. A
 * connection per call keeps the executor stateless (matching the GraphQL
 * client) and avoids stale-socket handling; host diagnostics are low-volume
 * so the handshake cost is acceptable.
 */
export class SshShellExecutor implements ShellExecutor {
  private readonly connectConfig: ConnectConfig;

  /**
   * Builds the executor, reading the private key file (when configured) once
   * up front so a bad key path fails at startup instead of on first use.
   *
   * @param settings - Host, port, user, and credential configuration.
   * @throws Error when the configured private key file cannot be read.
   */
  constructor(settings: SshSettings) {
    this.connectConfig = {
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      privateKey: settings.privateKeyPath ? readFileSync(settings.privateKeyPath) : undefined,
      readyTimeout: CONNECT_TIMEOUT_MS,
    };
  }

  /**
   * Connects, runs one command, and always closes the connection.
   *
   * @param command - The shell command to run on the host.
   * @param timeoutMs - Overall deadline for the command (and for connecting).
   * @returns The command's stdout, stderr, and exit code.
   * @throws Error on connection failure, auth failure, or timeout.
   */
  async execute(command: string, timeoutMs: number): Promise<ShellResult> {
    const connection = await withTimeout(connect(this.connectConfig), timeoutMs, "connect");
    try {
      return await withTimeout(run(connection, command), timeoutMs, "run the command");
    } finally {
      connection.end();
    }
  }
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

/** Executes one command on an open connection and collects its result. */
function run(connection: Client, command: string): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    connection.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      collect(stream, resolve);
    });
  });
}

/** Accumulates a stream's stdout/stderr and resolves with the exit code on close. */
function collect(stream: ClientChannel, resolve: (result: ShellResult) => void): void {
  let stdout = "";
  let stderr = "";
  stream.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  stream.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  stream.on("close", (code: number | null) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
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
