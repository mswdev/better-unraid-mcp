import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Returns the text of the first content block, asserting it is a text block.
 *
 * @param result - The tool result to read.
 * @returns The text of the first content block.
 * @throws Error when the first content block is missing or not text.
 */
export function firstText(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected a text content block");
  }
  return block.text;
}
