import { describe, expect, it } from "vitest";
import { truncateOutput } from "./truncate-output.js";

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
