import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, type DestinationFactory } from "./logging.js";

/** A destination factory that records the file descriptor it was asked for and every line written. */
function capturingDestination() {
  const openedFds: number[] = [];
  const lines: string[] = [];
  const open: DestinationFactory = (fd) => {
    openedFds.push(fd);
    const stream: DestinationStream = { write: (line: string) => lines.push(line) };
    return stream;
  };
  return { open, openedFds, lines };
}

describe("createLogger", () => {
  it("opens its destination on stderr, keeping stdout free for the stdio transport", () => {
    const { open, openedFds } = capturingDestination();

    createLogger("info", open);

    expect(openedFds).toEqual([process.stderr.fd]);
  });

  it("writes structured lines at or above the configured level to that destination", () => {
    const { open, lines } = capturingDestination();
    const logger = createLogger("warn", open);

    logger.info("routine detail");
    logger.warn("disk running hot");

    expect(lines.map((line) => JSON.parse(line).msg)).toEqual(["disk running hot"]);
  });
});
