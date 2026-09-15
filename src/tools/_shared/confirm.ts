import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ElicitationChannel } from "./elicitation.js";
import { toolError } from "./respond.js";

/** Refusal returned when a human explicitly declines an elicitation prompt. */
const DECLINED_MESSAGE = "The user declined the confirmation prompt. No changes were made.";

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

/** Options for the interactive tier-1 gate. */
export interface InteractiveConfirmationOptions {
  confirm?: boolean;
  actionDescription: string;
  channel?: ElicitationChannel | null;
}

/** Options for the interactive tier-2 gate. */
export interface InteractiveRiskOptions {
  flags: RiskGateFlags;
  refusalMessage: string;
  channel?: ElicitationChannel | null;
}

/** Asks the human through the channel; null = proceed, result = refuse, undefined = fall back. */
async function askHuman(
  channel: ElicitationChannel | null | undefined,
  message: string,
  requireRisk: boolean,
): Promise<CallToolResult | null | undefined> {
  if (!channel?.isAvailable()) {
    return undefined;
  }
  const outcome = await channel.confirm({ message, requireRiskAcknowledgement: requireRisk });
  if (outcome === "accepted") {
    return null;
  }
  if (outcome === "declined") {
    return toolError(DECLINED_MESSAGE);
  }
  return undefined;
}

/**
 * Interactive tier-1 gate: an explicit `confirm: true` argument passes; when
 * the client supports elicitation the human is prompted instead of refused;
 * otherwise this falls back to `requireConfirmation`'s refusal, byte for byte.
 *
 * @param options - The confirm argument, action copy, and optional channel.
 * @returns `null` to proceed, or an error `CallToolResult` to return as-is.
 */
export async function requireConfirmationInteractive(
  options: InteractiveConfirmationOptions,
): Promise<CallToolResult | null> {
  if (options.confirm === true) {
    return null;
  }
  const asked = await askHuman(
    options.channel,
    `Confirm: ${options.actionDescription}? This is a state-changing action.`,
    false,
  );
  if (asked !== undefined) {
    return asked;
  }
  return requireConfirmation(options.confirm, options.actionDescription);
}

/**
 * Interactive tier-2 gate: both flags as arguments pass; when the client
 * supports elicitation the human answers a two-checkbox prompt carrying the
 * blast-radius copy; otherwise this falls back to
 * `requireRiskAcknowledgement`'s refusal, byte for byte.
 *
 * @param options - The flags, blast-radius refusal copy, and optional channel.
 * @returns `null` to proceed, or an error `CallToolResult` to return as-is.
 */
export async function requireRiskAcknowledgementInteractive(
  options: InteractiveRiskOptions,
): Promise<CallToolResult | null> {
  if (options.flags.confirm === true && options.flags.acknowledge_risk === true) {
    return null;
  }
  const asked = await askHuman(options.channel, options.refusalMessage, true);
  if (asked !== undefined) {
    return asked;
  }
  return requireRiskAcknowledgement(options.flags, options.refusalMessage);
}
