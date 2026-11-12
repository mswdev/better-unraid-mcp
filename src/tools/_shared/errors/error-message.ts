/**
 * Renders a caught value as text for a tool error: an `Error`'s message, or
 * the value itself coerced with `String()` (some libraries reject with plain
 * strings or other non-`Error` values).
 *
 * @param error - The value a `catch` block or rejection handler received.
 * @returns The error's message, or the stringified value.
 * @example
 * errorMessage(new Error("connection refused")); // "connection refused"
 * errorMessage("socket hang up"); // "socket hang up"
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
