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
 * Caps output at the rendering limit, keeping the head. Use this for
 * structured payloads like JSON, where the opening braces and top-level keys
 * are what make a truncated result interpretable; tail-keeping would return
 * an unparseable fragment with no hint of what it belongs to.
 *
 * @param output - The raw serialized text (e.g. pretty-printed JSON).
 * @returns The original text, or its head suffixed with a truncation note.
 */
export function truncateOutputKeepingHead(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  const dropped = output.length - MAX_OUTPUT_CHARS;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n[truncated ${dropped} characters from the end; narrow the selection or page the data]`;
}
