/**
 * Cap on rendered tool output so one call cannot flood the conversation:
 * 30k characters is roughly 7k tokens, a bounded worst case per call.
 */
export const MAX_OUTPUT_CHARS = 30_000;

/** Spaces per indent level in detailed JSON; `formatResponse` pretty-prints the same way. */
export const JSON_INDENT_SPACES = 2;

/**
 * Caps output at the rendering limit, keeping the tail (the newest lines,
 * which diagnostics care about) and noting how much was dropped.
 *
 * @param output - The raw text (command output or serialized JSON).
 * @returns The original text, or its tail prefixed with a truncation note.
 */
export function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  const dropped = output.length - MAX_OUTPUT_CHARS;
  return `[truncated ${dropped} characters from the start]\n${output.slice(dropped)}`;
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
 * characters dropped per field, and a note. Only when the fixed fields alone
 * exceed the cap does the result still overflow (and `formatResponse` then
 * falls back to its head envelope).
 *
 * @param parts - The fixed fields, and the text fields to keep the tails of.
 * @returns The payload, unchanged when it already fits, otherwise tail-fitted.
 * @example
 * fitTailsToOutputCap({ fixed: { exit_code: 0 }, tails: { stdout, stderr } });
 * @see truncateOutput for the concise-mode equivalent.
 */
export function fitTailsToOutputCap(parts: TailFitParts): Record<string, unknown> {
  const untouched = { ...parts.fixed, ...parts.tails };
  if (serializedLength(untouched) <= MAX_OUTPUT_CHARS) {
    return untouched;
  }
  // Size the frame for the worst case: every tail empty, every drop count at its maximum.
  const emptyTails = mapValues(parts.tails, () => "");
  const maximumDrops = mapValues(parts.tails, (text) => text.length);
  const frame = withTruncationReport(parts.fixed, emptyTails, maximumDrops);
  const budget = Math.max(0, MAX_OUTPUT_CHARS - serializedLength(frame));
  const allotments = allocateBudget(mapValues(parts.tails, escapedLength), budget);
  const kept = mapValues(parts.tails, (text, field) =>
    tailWithinEscapedLength(text, allotments[field]),
  );
  const dropped = mapValues(parts.tails, (text, field) => text.length - kept[field].length);
  return withTruncationReport(parts.fixed, kept, dropped);
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

/**
 * The longest tail of `text` whose escaped form fits in `limit` characters.
 * Escaping never shrinks text, so each pass cuts the tail strictly shorter in
 * proportion to its overshoot, and the loop always ends (at worst on "").
 */
function tailWithinEscapedLength(text: string, limit: number): string {
  let length = Math.min(text.length, limit);
  let tail = text.slice(text.length - length);
  while (escapedLength(tail) > limit) {
    length = Math.floor((length * limit) / escapedLength(tail));
    tail = text.slice(text.length - length);
  }
  return tail;
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
