import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { firstText } from "../_shared/test-support.js";
import {
  findRiskyFields,
  parseSingleOperation,
  renderJsonResult,
  validateAgainstSchema,
} from "./_shared.js";

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
  it("replaces oversized JSON with a parseable truncation envelope", () => {
    const result = renderJsonResult({ content: "x".repeat(40_000) });

    const envelope = JSON.parse(firstText(result)) as {
      truncated: boolean;
      partial_json_head: string;
    };
    expect(envelope.truncated).toBe(true);
    expect(envelope.partial_json_head.startsWith("{")).toBe(true);
  });
});

describe("validateAgainstSchema", () => {
  const TINY_SDL = "type Query { online: Boolean! info: Info } type Info { versions: String }";

  it("returns no messages for a document that fits the schema", () => {
    const messages = validateAgainstSchema(parse("query { online }"), () => TINY_SDL);

    expect(messages).toEqual([]);
  });

  it("returns graphql-js messages with did-you-mean hints for unknown fields", () => {
    const messages = validateAgainstSchema(parse("query { info { versionz } }"), () => TINY_SDL);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Cannot query field "versionz"');
    expect(messages[0]).toContain("Did you mean");
  });

  it("builds the schema once per loader and reuses it", () => {
    let loads = 0;
    const loader = () => {
      loads += 1;
      return TINY_SDL;
    };

    validateAgainstSchema(parse("query { online }"), loader);
    validateAgainstSchema(parse("query { online }"), loader);

    expect(loads).toBe(1);
  });

  it("validates against the real vendored schema by default", () => {
    const messages = validateAgainstSchema(parse("query { info { versionz } }"));

    expect(messages[0]).toContain("versions");
  });
});
