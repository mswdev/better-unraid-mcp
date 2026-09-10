import { describe, expect, it } from "vitest";
import { quoteForShell, truncateOutput } from "./_shared.js";

describe("quoteForShell", () => {
  it("wraps a plain value in single quotes", () => {
    expect(quoteForShell("/var/log/syslog")).toBe("'/var/log/syslog'");
  });

  it("escapes embedded single quotes so injection cannot break out", () => {
    expect(quoteForShell("a'; rm -rf /; '")).toBe(`'a'\\''; rm -rf /; '\\'''`);
  });
});

describe("truncateOutput", () => {
  it("returns short output unchanged", () => {
    expect(truncateOutput("short")).toBe("short");
  });

  it("keeps the tail and notes the dropped size for long output", () => {
    const long = "x".repeat(30_001);

    const truncated = truncateOutput(long);

    expect(truncated).toContain("[truncated 1 characters from the start]");
    expect(truncated.endsWith("x".repeat(100))).toBe(true);
  });
});
