import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Returns the text of the first content block, asserting it is a text block. */
export function firstText(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected a text content block");
  }
  return block.text;
}
