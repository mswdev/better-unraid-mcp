import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolError } from "./respond.js";

/**
 * Gate for destructive operations. Returns `null` when the caller explicitly
 * confirmed; otherwise returns an error result and the caller must abort.
 *
 * @param confirm - The tool's `confirm` argument.
 * @param actionDescription - Human description of the destructive action.
 * @returns `null` to proceed, or an error `CallToolResult` to return as-is.
 */
export function requireConfirmation(
  confirm: boolean | undefined,
  actionDescription: string,
): CallToolResult | null {
  if (confirm === true) {
    return null;
  }
  return toolError(
    `Refusing to ${actionDescription}: this is a destructive action. Re-call with "confirm": true to proceed. No changes were made.`,
  );
}
