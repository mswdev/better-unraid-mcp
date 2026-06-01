import { describe, expect, it } from "vitest";
import { formatResponse, toolError } from "./respond.js";
import { firstText } from "./test-support.js";

describe("formatResponse", () => {
  it("returns the concise string for the concise format", () => {
    const result = formatResponse("concise", "short summary", { a: 1 });

    expect(firstText(result)).toBe("short summary");
    expect(result.isError).toBeUndefined();
  });

  it("returns pretty JSON for the detailed format", () => {
    const result = formatResponse("detailed", "short summary", { a: 1 });

    expect(firstText(result)).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
});

describe("toolError", () => {
  it("marks the result as an error", () => {
    const result = toolError("boom");

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("boom");
  });
});
