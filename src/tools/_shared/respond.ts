import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Number of spaces used when pretty-printing detailed JSON responses. */
const JSON_INDENT_SPACES = 2;

/** How verbose a tool response should be. */
export type ResponseFormat = "concise" | "detailed";

/**
 * Wraps plain text as a successful tool result.
 *
 * @param text - The text content to return.
 * @returns A successful `CallToolResult`.
 */
export function toolText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Wraps a message as an error tool result (sets `isError`).
 *
 * @param message - The error message to return to the client.
 * @returns An error `CallToolResult`.
 */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Formats a tool response, returning a human summary for `concise` and
 * pretty-printed JSON for `detailed`.
 *
 * @param format - Requested verbosity.
 * @param concise - Pre-built one-line/short human summary.
 * @param detailed - The full structured payload.
 * @returns A successful tool result.
 */
export function formatResponse(
  format: ResponseFormat,
  concise: string,
  detailed: unknown,
): CallToolResult {
  if (format === "detailed") {
    return toolText(JSON.stringify(detailed, null, JSON_INDENT_SPACES));
  }
  return toolText(concise);
}
