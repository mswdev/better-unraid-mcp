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

/** The two flags a high-risk (tier-2) action demands. */
export interface RiskGateFlags {
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * Two-flag gate for high-risk operations (array stop, ungraceful VM kills,
 * raw mutations touching dangerous fields, host power control). Both
 * `confirm` and `acknowledge_risk` must be explicitly true.
 *
 * @param flags - The tool's `confirm` and `acknowledge_risk` arguments.
 * @param refusalMessage - Full refusal copy, naming both flags and ending
 *   with "No changes were made." — each call site owns its blast-radius text.
 * @returns `null` to proceed, or an error `CallToolResult` to return as-is.
 */
export function requireRiskAcknowledgement(
  flags: RiskGateFlags,
  refusalMessage: string,
): CallToolResult | null {
  if (flags.confirm === true && flags.acknowledge_risk === true) {
    return null;
  }
  return toolError(refusalMessage);
}
