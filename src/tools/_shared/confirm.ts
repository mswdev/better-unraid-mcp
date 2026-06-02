import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolError } from "./respond.js";

/**
 * Gate for state-changing operations. Returns `null` when the caller explicitly
 * confirmed; otherwise returns an error result and the caller must abort. The
 * copy says "state-changing" rather than "destructive" so it reads correctly for
 * gated-but-restorative actions (e.g. start/unpause) as well as destructive ones.
 *
 * @param confirm - The tool's `confirm` argument.
 * @param actionDescription - Human description of the state-changing action.
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
    `Refusing to ${actionDescription}: this is a state-changing action that requires confirmation. Re-call with "confirm": true to proceed. No changes were made.`,
  );
}
