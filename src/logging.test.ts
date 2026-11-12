import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logging.js";

const STDERR_FD = 2;

describe("createLogger", () => {
  it("filters below the requested level", () => {
    const logger = createLogger("warn");

    expect(logger.level).toBe("warn");
    expect(logger.isLevelEnabled("info")).toBe(false);
    expect(logger.isLevelEnabled("error")).toBe(true);
  });

  it("writes to stderr so stdout stays reserved for the stdio transport", () => {
    const logger = createLogger("info");

    const destination = (logger as unknown as Record<symbol, { fd: number }>)[
      pino.symbols.streamSym
    ];

    expect(destination.fd).toBe(STDERR_FD);
  });
});
