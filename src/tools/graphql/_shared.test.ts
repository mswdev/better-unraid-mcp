import { describe, expect, it } from "vitest";
import { firstText } from "../_shared/test-support.js";
import { findRiskyFields, parseSingleOperation, renderJsonResult } from "./_shared.js";

describe("parseSingleOperation", () => {
  it("parses a single query and reports its operation type", () => {
    const parsed = parseSingleOperation("query { online }");

    expect(parsed.operation).toBe("query");
  });

  it("accepts a fragment alongside exactly one operation", () => {
    const parsed = parseSingleOperation("fragment F on Query { online } query { ...F }");

    expect(parsed.operation).toBe("query");
  });

  it("rejects a fragment-only document (zero operations)", () => {
    expect(() => parseSingleOperation("fragment F on Query { online }")).toThrow(
      /exactly one GraphQL operation, found 0/,
    );
  });

  it("rejects multiple operations", () => {
    expect(() => parseSingleOperation("query A { online } mutation B { x }")).toThrow(
      /exactly one GraphQL operation, found 2/,
    );
  });

  it("throws a syntax error for invalid GraphQL", () => {
    expect(() => parseSingleOperation("query {")).toThrow();
  });
});

describe("findRiskyFields", () => {
  it("finds a nested dangerous field", () => {
    const parsed = parseSingleOperation(
      "mutation { array { setState(input: { desiredState: STOP }) { state } } }",
    );

    expect(findRiskyFields(parsed.document)).toEqual(["setState"]);
  });

  it("ignores similarly named but distinct fields", () => {
    const parsed = parseSingleOperation("mutation { resetOnboarding { completed } }");

    expect(findRiskyFields(parsed.document)).toEqual([]);
  });

  it("returns empty for a benign mutation", () => {
    const parsed = parseSingleOperation("mutation { archiveAll { total } }");

    expect(findRiskyFields(parsed.document)).toEqual([]);
  });
});

describe("renderJsonResult", () => {
  it("head-truncates oversized JSON so the top-level structure survives", () => {
    const result = renderJsonResult({ content: "x".repeat(40_000) });

    const text = firstText(result);
    expect(text.startsWith("{")).toBe(true);
    expect(text).toContain("truncated");
    expect(text).toContain("narrow the selection");
  });
});
