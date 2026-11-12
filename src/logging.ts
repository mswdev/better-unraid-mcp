import pino, { type DestinationStream, type Logger } from "pino";

const STDERR_FD = 2;

/** Opens the stream a logger writes to from a file descriptor; injectable for tests. */
export type DestinationFactory = (fd: number) => DestinationStream;

/**
 * Creates a structured logger that writes to stderr only. stdout is reserved
 * for the MCP stdio transport — logging there would corrupt the protocol.
 *
 * @param level - The minimum log level (e.g. `info`, `debug`).
 * @param openDestination - Opens the output stream; pino's file-descriptor destination outside tests.
 * @returns A pino logger bound to stderr.
 */
export function createLogger(
  level: string,
  openDestination: DestinationFactory = pino.destination,
): Logger {
  return pino({ level }, openDestination(STDERR_FD));
}
