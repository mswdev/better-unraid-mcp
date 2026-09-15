/**
 * Cap on rendered tool output so one call cannot flood the conversation:
 * 30k characters is roughly 7k tokens, a bounded worst case per call.
 */
const MAX_OUTPUT_CHARS = 30_000;

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
const TRUNCATED_HEAD_CHARS = 20_000;

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
    2,
  );
}
