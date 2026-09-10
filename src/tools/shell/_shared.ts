/**
 * Cap on rendered command output so one call cannot flood the conversation:
 * 30k characters is roughly 7k tokens, a bounded worst case per call.
 */
const MAX_OUTPUT_CHARS = 30_000;

const SINGLE_QUOTE = /'/g;

/**
 * Quotes a value for safe interpolation into a POSIX shell command. The value
 * is wrapped in single quotes with embedded single quotes escaped, so shell
 * metacharacters in it are never interpreted.
 *
 * @param value - The raw string (a path or pattern) to quote.
 * @returns The single-quoted, escape-safe shell token.
 * @example quoteForShell("it's") // "'it'\\''s'"
 */
export function quoteForShell(value: string): string {
  return `'${value.replace(SINGLE_QUOTE, `'\\''`)}'`;
}

/**
 * Caps command output at the rendering limit, keeping the tail (the newest
 * lines, which diagnostics care about) and noting how much was dropped.
 *
 * @param output - The raw stdout or stderr text.
 * @returns The original text, or its tail prefixed with a truncation note.
 */
export function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  const dropped = output.length - MAX_OUTPUT_CHARS;
  return `[truncated ${dropped} characters from the start]\n${output.slice(dropped)}`;
}
