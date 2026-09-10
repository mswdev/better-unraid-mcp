import { describe, expect, it } from "vitest";
import { quoteForShell } from "./_shared.js";

describe("quoteForShell", () => {
  it("wraps a plain value in single quotes", () => {
    expect(quoteForShell("/var/log/syslog")).toBe("'/var/log/syslog'");
  });

  it("escapes embedded single quotes so injection cannot break out", () => {
    expect(quoteForShell("a'; rm -rf /; '")).toBe(`'a'\\''; rm -rf /; '\\'''`);
  });
});
