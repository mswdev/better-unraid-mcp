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
