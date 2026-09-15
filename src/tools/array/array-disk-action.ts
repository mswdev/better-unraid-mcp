import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ArrayDiskAddDocument,
  ArrayDiskClearStatsDocument,
  ArrayDiskMountDocument,
  ArrayDiskRemoveDocument,
  ArrayDiskUnmountDocument,
  ArrayStateProbeDocument,
} from "../../types/unraid/graphql.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "array_disk_action";

type DiskAction = "add" | "remove" | "mount" | "unmount" | "clear_statistics";

/** Actions that reconfigure array membership — they demand a STOPPED array. */
const NEEDS_STOPPED_ARRAY = new Set<DiskAction>(["add", "remove"]);

/** Actions on a live disk — they demand a STARTED array. */
const NEEDS_STARTED_ARRAY = new Set<DiskAction>(["mount", "unmount", "clear_statistics"]);

/** Actions that accept the optional `slot` argument. */
const SLOT_ACTIONS = new Set<DiskAction>(["add", "remove"]);

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["add", "remove", "mount", "unmount", "clear_statistics"]),
  id: z.string().min(1),
  slot: z.number().int().optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface ArrayDiskActionArgs {
  response_format: ResponseFormat;
  action: DiskAction;
  id: string;
  slot?: number;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** Blast-radius refusal copy per action family. */
function refusalMessage(args: ArrayDiskActionArgs): string {
  const consequence = NEEDS_STOPPED_ARRAY.has(args.action)
    ? "changes which disks are part of the protected array — a wrong disk here risks data loss"
    : "changes a live array disk's mount/statistics state";
  return `Refusing to ${args.action} disk ${args.id}: this ${consequence}. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/** Verifies the array is in the state this action demands. */
async function statePrecondition(
  client: GraphQLExecutor,
  action: DiskAction,
): Promise<CallToolResult | null> {
  const data = await client.execute(ArrayStateProbeDocument);
  const state = data.array.state;
  if (NEEDS_STOPPED_ARRAY.has(action) && state !== "STOPPED") {
    return toolError(
      `Cannot ${action} a disk while the array state is ${state}: Unraid requires a STOPPED array for membership changes. Stop it first with array_action (this takes shares, containers, and VMs offline). No changes were made.`,
    );
  }
  if (NEEDS_STARTED_ARRAY.has(action) && state !== "STARTED") {
    return toolError(
      `Cannot ${action} disk while the array state is ${state}: this action needs a STARTED array. Start it with array_action. No changes were made.`,
    );
  }
  return null;
}

/** Dispatches one disk action to its typed mutation document. */
async function runDiskAction(client: GraphQLExecutor, args: ArrayDiskActionArgs): Promise<void> {
  const membershipInput = { input: { id: args.id, slot: args.slot } };
  switch (args.action) {
    case "add":
      await client.execute(ArrayDiskAddDocument, membershipInput);
      return;
    case "remove":
      await client.execute(ArrayDiskRemoveDocument, membershipInput);
      return;
    case "mount":
      await client.execute(ArrayDiskMountDocument, { id: args.id });
      return;
    case "unmount":
      await client.execute(ArrayDiskUnmountDocument, { id: args.id });
      return;
    case "clear_statistics":
      await client.execute(ArrayDiskClearStatsDocument, { id: args.id });
      return;
  }
}

/** Success copy: requested, never done (mutations return pre-mutation snapshots). */
function successSummary(args: ArrayDiskActionArgs): string {
  return `Disk ${args.action} requested for ${args.id}. The API returns a pre-mutation snapshot, so verify the result with array_status and disk_list.`;
}

/**
 * Creates the `array_disk_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used for the probe and mutation.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler for array disk membership and mount operations.
 */
export function createArrayDiskActionHandler(
  client: GraphQLExecutor,
  channel?: ElicitationChannel | null,
) {
  return async (args: ArrayDiskActionArgs): Promise<CallToolResult> => {
    if (args.slot !== undefined && !SLOT_ACTIONS.has(args.action)) {
      return toolError(
        '`slot` is only valid with actions "add" and "remove". No changes were made.',
      );
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const preconditionFailure = await statePrecondition(client, args.action);
      if (preconditionFailure) {
        return preconditionFailure;
      }
      await runDiskAction(client, args);
      const detailed = { action: args.action, id: args.id, slot: args.slot, requested: true };
      return formatResponse(args.response_format, successSummary(args), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.action} disk ${args.id}: ${message}`);
    }
  };
}

/**
 * Registers the destructive `array_disk_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerArrayDiskAction(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Array Disk Operations",
      description:
        "⚠ Array disk operations: add/remove a disk to/from the protected array (requires a STOPPED array — checked first), mount/unmount an array disk, or clear a disk's error statistics (require a STARTED array). A wrong disk id on add/remove risks data loss. Requires `confirm: true` AND `acknowledge_risk: true`. Get disk ids from disk_list. Results are requested, not confirmed — verify with array_status/disk_list.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createArrayDiskActionHandler(client, createElicitationChannel(server)),
  );
}
