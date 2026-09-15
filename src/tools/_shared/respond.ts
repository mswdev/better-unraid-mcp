import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { redactSecrets } from "./redact.js";
import { truncateJsonPayload } from "./truncate-output.js";

/** Number of spaces used when pretty-printing detailed JSON responses. */
const JSON_INDENT_SPACES = 2;

/** How verbose a tool response should be. */
export type ResponseFormat = "concise" | "detailed";

/**
 * Wraps plain text as a successful tool result. Secrets (configured values,
 * credential-shaped key-values, JWTs) are redacted — this is the choke point
 * every tool's text output flows through.
 *
 * @param text - The text content to return.
 * @returns A successful `CallToolResult`.
 */
export function toolText(text: string): CallToolResult {
  return { content: [{ type: "text", text: redactSecrets(text) }] };
}

/**
 * Wraps a message as an error tool result (sets `isError`). Secrets are
 * redacted the same way as in `toolText`.
 *
 * @param message - The error message to return to the client.
 * @returns An error `CallToolResult`.
 */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: redactSecrets(message) }], isError: true };
}

/**
 * Formats a tool response, returning a human summary for `concise` and
 * pretty-printed JSON for `detailed`.
 *
 * Detailed payloads are capped by a parseable truncation envelope when oversized.
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
    return toolText(truncateJsonPayload(JSON.stringify(detailed, null, JSON_INDENT_SPACES)));
  }
  return toolText(concise);
}
