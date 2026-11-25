import { describe, expect, it } from "vitest";
import { formatIdTag, formatResponse, formatStructuredResponse, toolError } from "./respond.js";
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

  it("redacts a secret in detailed output without breaking the JSON", () => {
    const result = formatResponse("detailed", "summary", { stdout: 'PASSWORD="hunter2"\nnext' });

    const parsed = JSON.parse(firstText(result)) as { stdout: string };
    expect(firstText(result)).not.toContain("hunter2");
    expect(parsed.stdout).toBe('PASSWORD="[redacted]"\nnext');
  });
});

describe("formatIdTag", () => {
  it("wraps the full id in an [id: …] marker", () => {
    const id = "srv:3f2a9c1e5b7d4a6f8e0c2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a";

    const tag = formatIdTag(id);

    expect(tag).toBe(`[id: ${id}]`);
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

  it("redacts a secret inside a string field without breaking either channel", () => {
    const result = formatStructuredResponse("detailed", "summary", { note: "TOKEN=abc\nnext" });

    expect(firstText(result)).not.toContain("abc");
    expect(JSON.parse(firstText(result))).toEqual({ note: 'TOKEN="[redacted]"\nnext' });
    expect(result.structuredContent).toEqual({ note: 'TOKEN="[redacted]"\nnext' });
  });
});
