import { afterEach, describe, expect, it } from "vitest";
import { clearSecretValues, registerSecretValues } from "./redact.js";
import { formatResponse } from "./respond.js";
import { firstText } from "./test-support.js";
import {
  fitTailsToOutputCap,
  MAX_OUTPUT_CHARS,
  TRUNCATED_HEAD_CHARS,
  truncateJsonPayload,
  truncateOutput,
  truncateStreams,
} from "./truncate-output.js";

afterEach(() => {
  clearSecretValues();
});

/** A registered secret long enough that a cut can leave a recognizable piece of it. */
const LONG_SECRET = "0123456789abcdef".repeat(3).concat("tail");

/** A registered secret shorter than "[redacted]", so redacting it lengthens the text. */
const SHORT_SECRET = "abcd";
const SHORT_SECRET_REPEATS = 20_000;

/** Enough back-to-back copies of LONG_SECRET to overflow the cap, but not once redacted. */
const SECRET_REPEATS_OVER_CAP = 1_200;

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

describe("truncateOutput redaction and limit", () => {
  it("redacts before cutting, so a secret on the cut line leaves no fragment", () => {
    registerSecretValues([LONG_SECRET]);
    const prefix = "x".repeat(MAX_OUTPUT_CHARS + LONG_SECRET.length);
    const output = `${prefix}${LONG_SECRET}${"y".repeat(MAX_OUTPUT_CHARS - LONG_SECRET.length / 2)}`;

    const truncated = truncateOutput(output);

    expect(truncated).not.toContain(LONG_SECRET.slice(-LONG_SECRET.length / 2));
    expect(truncated).toContain("[redacted]");
  });

  it("cuts to a smaller limit when given one", () => {
    const truncated = truncateOutput("z".repeat(MAX_OUTPUT_CHARS), MAX_OUTPUT_CHARS / 2);

    expect(truncated).toContain(`[truncated ${MAX_OUTPUT_CHARS / 2} characters from the start]`);
  });
});

describe("truncateStreams", () => {
  it("gives each stream half the cap when both have output", () => {
    const streams = truncateStreams("o".repeat(MAX_OUTPUT_CHARS), "e".repeat(MAX_OUTPUT_CHARS));

    expect(streams.stdout).toContain(`[truncated ${MAX_OUTPUT_CHARS / 2} characters`);
    expect(streams.stderr).toContain(`[truncated ${MAX_OUTPUT_CHARS / 2} characters`);
  });

  it("gives a lone stream the whole cap and trims trailing whitespace", () => {
    const streams = truncateStreams(`${"o".repeat(MAX_OUTPUT_CHARS)}\n\n`, "  \n");

    expect(streams.stdout).toBe("o".repeat(MAX_OUTPUT_CHARS));
    expect(streams.stderr).toBe("");
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

  it("shrinks the head of an escape-heavy payload until the envelope fits the cap", () => {
    const serialized = JSON.stringify({ data: '"'.repeat(40_000) }, null, 2);

    const result = truncateJsonPayload(serialized);
    const envelope = JSON.parse(result) as { partial_json_head: string };

    const headAfterOneHalving = TRUNCATED_HEAD_CHARS / 2;
    expect(result.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(envelope.partial_json_head).toHaveLength(headAfterOneHalving);
    expect(serialized.startsWith(envelope.partial_json_head)).toBe(true);
  });
});

/** Numbered log-style lines, newest last; the newlines double in size once JSON-escaped. */
function numberedLines(count: number, label = "line"): string {
  return Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join("\n");
}

/** Serializes a payload exactly the way detailed output is rendered. */
function rendered(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/** The most two tail-fitted fields may differ by when the budget is split evenly. */
const EVEN_SPLIT_TOLERANCE_CHARS = 100;

/** A control character JSON escapes to six characters (\u0001). */
const CONTROL_CHARACTER = "\u0001";
const CONTROL_PREFIX_CHARS = 5_000;
const PLAIN_TAIL_CHARS = 27_000;

/**
 * How far under the cap an exact fit may land: one escaped control character
 * (6) plus the slack left by sizing the drop counts at their maximum digits.
 */
const TIGHT_FIT_TOLERANCE_CHARS = 20;

const EMOJI_LINES = 20_000;

describe("fitTailsToOutputCap", () => {
  it("returns the payload unchanged, with no truncation fields, when it fits", () => {
    const parts = { fixed: { path: "/etc/hosts", exit_code: 0 }, tails: { content: "short" } };

    const payload = fitTailsToOutputCap(parts);

    expect(payload).toEqual({ path: "/etc/hosts", exit_code: 0, content: "short" });
  });

  it("keeps the newest lines of an oversized field and says earlier content was dropped", () => {
    const content = numberedLines(5_000);

    const payload = fitTailsToOutputCap({ fixed: { exit_code: 0 }, tails: { content } });
    const parsed = JSON.parse(rendered(payload)) as {
      content: string;
      truncated: boolean;
      dropped_leading_chars: { content: number };
      truncation_note: string;
    };

    expect(rendered(payload).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(parsed.content.endsWith("line 4999\nline 5000")).toBe(true);
    expect(content.endsWith(parsed.content)).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.dropped_leading_chars.content).toBe(content.length - parsed.content.length);
    expect(parsed.truncation_note).toContain("earlier content was dropped");
  });

  it("budgets by escaped size, so quote-heavy output still fits once serialized", () => {
    const content = `${'"'.repeat(40_000)}newest`;

    const payload = fitTailsToOutputCap({ fixed: {}, tails: { content } });
    const parsed = JSON.parse(rendered(payload)) as { content: string };

    expect(rendered(payload).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(parsed.content.endsWith('""newest')).toBe(true);
    expect(parsed.content.length).toBeGreaterThan(TRUNCATED_HEAD_CHARS / 2);
  });

  it("splits the budget evenly between two large fields, keeping each one's tail", () => {
    const stdout = numberedLines(5_000, "out");
    const stderr = numberedLines(5_000, "err");

    const payload = fitTailsToOutputCap({ fixed: {}, tails: { stdout, stderr } });
    const parsed = JSON.parse(rendered(payload)) as { stdout: string; stderr: string };

    expect(rendered(payload).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(parsed.stdout.endsWith("out 5000")).toBe(true);
    expect(parsed.stderr.endsWith("err 5000")).toBe(true);
    expect(Math.abs(parsed.stdout.length - parsed.stderr.length)).toBeLessThan(
      EVEN_SPLIT_TOLERANCE_CHARS,
    );
  });

  it("keeps a small field whole and gives the rest of the budget to the large one", () => {
    const stdout = numberedLines(5_000, "out");
    const stderr = "warning: one small thing";

    const payload = fitTailsToOutputCap({ fixed: {}, tails: { stdout, stderr } });
    const parsed = JSON.parse(rendered(payload)) as {
      stdout: string;
      stderr: string;
      dropped_leading_chars: { stdout: number; stderr: number };
    };

    expect(parsed.stderr).toBe(stderr);
    expect(parsed.dropped_leading_chars.stderr).toBe(0);
    expect(parsed.stdout.length).toBeGreaterThan(TRUNCATED_HEAD_CHARS);
  });

  it("keeps every character that fits when the dropped part is escape-heavy", () => {
    const plainTail = "a".repeat(PLAIN_TAIL_CHARS);
    const stdout = `${CONTROL_CHARACTER.repeat(CONTROL_PREFIX_CHARS)}${plainTail}`;

    const payload = fitTailsToOutputCap({ fixed: { exit_code: 0 }, tails: { stdout } });
    const parsed = JSON.parse(rendered(payload)) as { stdout: string };

    expect(rendered(payload).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(parsed.stdout.endsWith(plainTail)).toBe(true);
    expect(parsed.stdout.length).toBeGreaterThan(PLAIN_TAIL_CHARS);
    expect(rendered(payload).length).toBeGreaterThan(MAX_OUTPUT_CHARS - TIGHT_FIT_TOLERANCE_CHARS);
  });

  it("never starts the kept tail in the middle of an emoji", () => {
    const stdout = `${"😀\n".repeat(EMOJI_LINES)}aaa`;

    const payload = fitTailsToOutputCap({
      fixed: { command: "", exit_code: 0 },
      tails: { stdout },
    });
    const parsed = JSON.parse(rendered(payload)) as { stdout: string };

    expect(rendered(payload).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(parsed.stdout).toMatch(/^(😀|\n)/u);
    expect(parsed.stdout.endsWith("😀\naaa")).toBe(true);
  });

  it("redacts before measuring, so no cut can land inside a secret", () => {
    registerSecretValues([LONG_SECRET]);
    const stdout = LONG_SECRET.repeat(SECRET_REPEATS_OVER_CAP);

    const payload = fitTailsToOutputCap({ fixed: { command: LONG_SECRET }, tails: { stdout } });

    expect(payload).toEqual({
      command: "[redacted]",
      stdout: "[redacted]".repeat(SECRET_REPEATS_OVER_CAP),
    });
  });

  it("stays under the cap after redaction when a short secret repeats", () => {
    registerSecretValues([SHORT_SECRET]);
    const stdout = SHORT_SECRET.repeat(SHORT_SECRET_REPEATS);

    const payload = fitTailsToOutputCap({ fixed: { exit_code: 0 }, tails: { stdout } });
    const text = firstText(formatResponse("detailed", "summary", payload));

    expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(text).not.toContain(SHORT_SECRET);
    expect(JSON.parse(text)).toMatchObject({ truncated: true, exit_code: 0 });
    expect(JSON.parse(text)).toHaveProperty("stdout");
  });

  it("empties the tails and still ends when the fixed fields alone exceed the cap", () => {
    const command = "x".repeat(MAX_OUTPUT_CHARS);

    const payload = fitTailsToOutputCap({ fixed: { command }, tails: { stdout: "y".repeat(10) } });

    expect(payload).toMatchObject({ stdout: "", truncated: true });
    expect(payload).toMatchObject({ dropped_leading_chars: { stdout: 10 } });
  });
});
