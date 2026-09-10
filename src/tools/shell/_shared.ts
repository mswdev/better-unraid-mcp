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
