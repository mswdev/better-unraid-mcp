import { redactSecrets, stringifyRedacted } from "./redact.js";

/**
 * Cap on rendered tool output so one call cannot flood the conversation:
 * 30k characters is roughly 7k tokens, a bounded worst case per call.
 */
export const MAX_OUTPUT_CHARS = 30_000;

/** Spaces per indent level in detailed JSON; `formatResponse` pretty-prints the same way. */
export const JSON_INDENT_SPACES = 2;

/** stdout and stderr: the streams a concise command summary shows together. */
const STREAMS_PER_SUMMARY = 2;

/**
 * Caps raw text at the rendering limit, keeping the tail (the newest lines,
 * which diagnostics care about) and noting how much was dropped. Secrets are
 * redacted first, so a cut can never leave the end of a secret behind.
 *
 * @param output - Raw text such as command output or a log tail (not serialized JSON).
 * @param limit - The most characters to keep; defaults to the output cap.
 * @returns The redacted text, or its tail prefixed with a truncation note.
 */
export function truncateOutput(output: string, limit: number = MAX_OUTPUT_CHARS): string {
  const redacted = redactSecrets(output);
  if (redacted.length <= limit) {
    return redacted;
  }
  const dropped = redacted.length - limit;
  return `[truncated ${dropped} characters from the start]\n${redacted.slice(dropped)}`;
}

/** A command's two output streams, each trimmed and capped for a concise summary. */
export interface TruncatedStreams {
  stdout: string;
  stderr: string;
}

/**
 * Caps stdout and stderr for a concise summary so that together they stay
 * within the output cap: when both have output, each keeps the tail of an
 * even share; a lone stream gets the whole cap. Trailing whitespace is
 * trimmed first, so a whitespace-only stream comes back empty.
 *
 * @param stdout - The command's raw standard output.
 * @param stderr - The command's raw standard error.
 * @returns Both streams, trimmed, redacted, and tail-truncated.
 * @example
 * const { stdout, stderr } = truncateStreams(result.stdout, result.stderr);
 */
export function truncateStreams(stdout: string, stderr: string): TruncatedStreams {
  const outText = stdout.trimEnd();
  const errText = stderr.trimEnd();
  const bothHaveOutput = outText.trim() !== "" && errText.trim() !== "";
  const limit = bothHaveOutput
    ? Math.floor(MAX_OUTPUT_CHARS / STREAMS_PER_SUMMARY)
    : MAX_OUTPUT_CHARS;
  return { stdout: truncateOutput(outText, limit), stderr: truncateOutput(errText, limit) };
}

/**
 * Head length carried inside the truncation envelope. Smaller than
 * MAX_OUTPUT_CHARS because JSON-escaping the head (quotes, newlines) expands
 * it; 20k keeps the worst-case envelope safely inside the output budget.
 */
export const TRUNCATED_HEAD_CHARS = 20_000;

/** Remediation copy carried in the truncation envelope. */
const TRUNCATION_HINT =
  "Narrow the selection, add filters, or page the data to fit under the output cap.";

/**
 * Caps serialized JSON while keeping the output parseable. Oversized payloads
 * become a small JSON envelope whose `partial_json_head` field carries the
 * head of the original serialization as an escaped string, so clients can
 * always JSON.parse a tool's detailed output.
 *
 * @param serialized - The pretty-printed JSON string to cap.
 * @returns The original string, or a parseable truncation envelope.
 */
export function truncateJsonPayload(serialized: string): string {
  if (serialized.length <= MAX_OUTPUT_CHARS) {
    return serialized;
  }
  // Escape-heavy heads (quotes, backslashes, newlines) can double when
  // re-stringified, so shrink until the ENVELOPE fits the output budget.
  let headLength = TRUNCATED_HEAD_CHARS;
  let envelope = renderEnvelope(serialized, headLength);
  while (envelope.length > MAX_OUTPUT_CHARS && headLength > MIN_HEAD_CHARS) {
    headLength = Math.floor(headLength / 2);
    envelope = renderEnvelope(serialized, headLength);
  }
  return envelope;
}

/** Smallest head still worth carrying in the envelope. */
const MIN_HEAD_CHARS = 1_000;

/** Builds the parseable truncation envelope for one head length. */
function renderEnvelope(serialized: string, headLength: number): string {
  const head = serialized.slice(0, headLength);
  return JSON.stringify(
    {
      truncated: true,
      dropped_chars: serialized.length - head.length,
      hint: TRUNCATION_HINT,
      partial_json_head: head,
    },
    null,
    JSON_INDENT_SPACES,
  );
}

/** The two quote characters JSON wraps around every string. */
const QUOTE_PAIR_LENGTH = 2;

/** Explains a tail-fitted payload to whoever reads the JSON. */
const TAIL_TRUNCATION_NOTE = `Output exceeded the ${MAX_OUTPUT_CHARS}-character cap, so earlier content was dropped: each field in dropped_leading_chars lost that many characters from its start, and its newest output (the tail) is kept.`;

/** A detailed payload split into the fields kept as-is and the text fields that may be cut. */
export interface TailFitParts {
  /** Small fields copied through untouched (a path, a command, an exit code). */
  fixed: Record<string, unknown>;
  /** Text fields (stdout, file content) that lose their oldest characters first. */
  tails: Record<string, string>;
}

/**
 * Builds a detailed payload whose pretty-printed JSON fits the output cap by
 * cutting text fields from the START, so the newest lines of a log tail or a
 * command's output survive. `truncateJsonPayload` keeps the head instead,
 * which is right for structured data but loses exactly the lines a tail is for.
 * When anything is cut, the payload says so with `truncated: true`, the
 * characters dropped per field, and a note. Every field is redacted BEFORE it
 * is measured, so no cut lands inside a secret and redaction cannot push the
 * result back over the cap. Only when the fixed fields alone exceed the cap
 * does the result still overflow (and `formatResponse` then falls back to its
 * head envelope).
 *
 * @param parts - The fixed fields, and the text fields to keep the tails of.
 * @returns The payload, unchanged when it already fits, otherwise tail-fitted.
 * @example
 * fitTailsToOutputCap({ fixed: { exit_code: 0 }, tails: { stdout, stderr } });
 * @see truncateOutput for the concise-mode equivalent.
 */
export function fitTailsToOutputCap(parts: TailFitParts): Record<string, unknown> {
  const fixed = JSON.parse(stringifyRedacted(parts.fixed)) as Record<string, unknown>;
  const tails = mapValues(parts.tails, (text) => redactSecrets(text));
  const untouched = { ...fixed, ...tails };
  if (serializedLength(untouched) <= MAX_OUTPUT_CHARS) {
    return untouched;
  }
  // Size the frame for the worst case: every tail empty, every drop count at its maximum.
  const emptyTails = mapValues(tails, () => "");
  const maximumDrops = mapValues(tails, (text) => text.length);
  const frame = withTruncationReport(fixed, emptyTails, maximumDrops);
  const budget = Math.max(0, MAX_OUTPUT_CHARS - serializedLength(frame));
  const allotments = allocateBudget(mapValues(tails, escapedLength), budget);
  const kept = mapValues(tails, (text, field) => tailWithinEscapedLength(text, allotments[field]));
  const dropped = mapValues(tails, (text, field) => text.length - kept[field].length);
  return withTruncationReport(fixed, kept, dropped);
}

/** Assembles a tail-fitted payload: fixed fields, kept tails, then the truncation report. */
function withTruncationReport(
  fixed: Record<string, unknown>,
  kept: Record<string, string>,
  dropped: Record<string, number>,
): Record<string, unknown> {
  return {
    ...fixed,
    ...kept,
    truncated: true,
    dropped_leading_chars: dropped,
    truncation_note: TAIL_TRUNCATION_NOTE,
  };
}

/** Characters a value occupies once pretty-printed the way detailed output is. */
function serializedLength(value: unknown): number {
  return JSON.stringify(value, null, JSON_INDENT_SPACES).length;
}

/** Characters a string occupies inside JSON once escaped, not counting its quotes. */
function escapedLength(text: string): number {
  return JSON.stringify(text).length - QUOTE_PAIR_LENGTH;
}

/**
 * Splits the budget across fields as evenly as possible. Fields are visited
 * smallest first: one smaller than its even share keeps all of itself, and
 * what it leaves over goes to the larger fields after it.
 */
function allocateBudget(sizes: Record<string, number>, budget: number): Record<string, number> {
  const smallestFirst = Object.entries(sizes).sort(([, left], [, right]) => left - right);
  const allotments: Record<string, number> = {};
  let remaining = budget;
  smallestFirst.forEach(([field, size], index) => {
    const evenShare = Math.floor(remaining / (smallestFirst.length - index));
    allotments[field] = Math.min(size, evenShare);
    remaining -= allotments[field];
  });
  return allotments;
}

/** The largest code point that fits in one UTF-16 unit; anything above is a surrogate pair. */
const MAX_SINGLE_UNIT_CODE_POINT = 0xffff;

/** UTF-16 units in a surrogate pair (an emoji, for example). */
const SURROGATE_PAIR_UNITS = 2;

/**
 * The longest tail of `text` whose escaped form fits in `limit` characters.
 * It walks back from the end one code point at a time, adding each one's
 * escaped width, so the fit is exact however escape-heavy the dropped part
 * is, and the tail never starts with the second half of a surrogate pair.
 */
function tailWithinEscapedLength(text: string, limit: number): string {
  let start = text.length;
  let used = 0;
  while (start > 0) {
    const previous = codePointStartBefore(text, start);
    used += escapedLength(text.slice(previous, start));
    if (used > limit) {
      return text.slice(start);
    }
    start = previous;
  }
  return text;
}

/** Index where the code point that ends just before `index` starts. */
function codePointStartBefore(text: string, index: number): number {
  const pairStart = index - SURROGATE_PAIR_UNITS;
  const codePoint = pairStart >= 0 ? text.codePointAt(pairStart) : undefined;
  const isSurrogatePair = codePoint !== undefined && codePoint > MAX_SINGLE_UNIT_CODE_POINT;
  return isSurrogatePair ? pairStart : index - 1;
}

/** Applies a transform to every value of a string record, keeping the keys. */
function mapValues<T>(
  record: Record<string, string>,
  transform: (value: string, key: string) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, transform(value, key)]),
  );
}
