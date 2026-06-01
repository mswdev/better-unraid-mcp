import pino, { type Logger } from "pino";

const STDERR_FD = 2;

/**
 * Creates a structured logger that writes to stderr only. stdout is reserved
 * for the MCP stdio transport — logging there would corrupt the protocol.
 *
 * @param level - The minimum log level (e.g. `info`, `debug`).
 * @returns A pino logger bound to stderr.
 */
export function createLogger(level: string): Logger {
  return pino({ level }, pino.destination(STDERR_FD));
}
