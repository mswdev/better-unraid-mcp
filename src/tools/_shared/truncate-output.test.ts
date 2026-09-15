import { describe, expect, it } from "vitest";
import { truncateJsonPayload, truncateOutput } from "./truncate-output.js";

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

describe("truncateJsonPayload", () => {
  it("returns small payloads unchanged", () => {
    const serialized = JSON.stringify({ a: 1 }, null, 2);

    expect(truncateJsonPayload(serialized)).toBe(serialized);
  });

  it("replaces oversized payloads with a parseable envelope", () => {
    const serialized = JSON.stringify({ data: "x".repeat(40_000) }, null, 2);

    const result = truncateJsonPayload(serialized);
    const envelope = JSON.parse(result) as {
      truncated: boolean;
      dropped_chars: number;
      hint: string;
      partial_json_head: string;
    };

    expect(envelope.truncated).toBe(true);
    expect(envelope.dropped_chars).toBe(serialized.length - envelope.partial_json_head.length);
    expect(envelope.hint).toContain("Narrow");
    expect(serialized.startsWith(envelope.partial_json_head)).toBe(true);
  });

  it("keeps the envelope itself under a bounded size", () => {
    const serialized = JSON.stringify({ data: "x".repeat(500_000) }, null, 2);

    const result = truncateJsonPayload(serialized);

    expect(result.length).toBeLessThan(45_000);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
