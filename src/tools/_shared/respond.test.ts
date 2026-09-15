import { describe, expect, it } from "vitest";
import { formatResponse, formatStructuredResponse, toolError } from "./respond.js";
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

describe("formatStructuredResponse", () => {
  it("carries structuredContent in concise mode with the summary as text", () => {
    const result = formatStructuredResponse("concise", "all good", { overall: "ok" });

    expect(result.structuredContent).toEqual({ overall: "ok" });
    expect(firstText(result)).toBe("all good");
  });

  it("carries structuredContent in detailed mode with JSON text", () => {
    const result = formatStructuredResponse("detailed", "all good", { overall: "ok" });

    expect(result.structuredContent).toEqual({ overall: "ok" });
    expect(JSON.parse(firstText(result))).toEqual({ overall: "ok" });
  });

  it("redacts credential shapes inside structuredContent", () => {
    const result = formatStructuredResponse("concise", "summary", {
      apiKey: "abc123",
      note: "fine",
    });

    expect(JSON.stringify(result.structuredContent)).not.toContain("abc123");
  });
});
