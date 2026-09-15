import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { toolError, toolText } from "../_shared/respond.js";
import {
  DATASET_PATTERN,
  SNAPSHOT_NAME_PATTERN,
  ZFS_COMMAND_TIMEOUT_MS,
  probeZfs,
} from "./_shared.js";

const TOOL_NAME = "zfs_snapshot_action";

type SnapshotAction = "create" | "destroy" | "rollback";

const inputSchema = {
  action: z.enum(["create", "destroy", "rollback"]),
  dataset: z.string().min(1),
  snapshot: z.string().min(1),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface SnapshotActionArgs {
  action: SnapshotAction;
  dataset: string;
  snapshot: string;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** Blast-radius refusal copy per action. */
function refusalMessage(args: SnapshotActionArgs): string {
  const consequence = {
    create: "creates a new snapshot (cheap, but pins space as data changes)",
    destroy: "PERMANENTLY deletes the snapshot and the rollback point it provides",
    rollback:
      "DISCARDS every change to the dataset made after the snapshot — files written since are lost",
  }[args.action];
  return `Refusing to ${args.action} ZFS snapshot ${args.dataset}@${args.snapshot}: this ${consequence}. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/**
 * The full `dataset@snapshot` target, always with the `@` — so destroy can
 * never be aimed at a bare dataset.
 */
function snapshotTarget(args: SnapshotActionArgs): string {
  return `${args.dataset}@${args.snapshot}`;
}

/** The zfs CLI invocation per action; rollback deliberately omits -r. */
function buildCommand(args: SnapshotActionArgs): string {
  const target = quoteForShell(snapshotTarget(args));
  const subcommand = { create: "snapshot", destroy: "destroy", rollback: "rollback" }[args.action];
  return `zfs ${subcommand} ${target}`;
}

/**
 * Creates the `zfs_snapshot_action` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler for ZFS snapshot create/destroy/rollback.
 */
export function createZfsSnapshotActionHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: SnapshotActionArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    if (!DATASET_PATTERN.test(args.dataset) || !SNAPSHOT_NAME_PATTERN.test(args.snapshot)) {
      return toolError(
        `Invalid dataset or snapshot name (dataset: ${args.dataset}, snapshot: ${args.snapshot}). No changes were made.`,
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
      const missing = await probeZfs(shell);
      if (missing) {
        return missing;
      }
      const result = await shell.execute(buildCommand(args), ZFS_COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        return toolError(
          `zfs ${args.action} failed (exit ${result.exitCode}): ${result.stderr.trim() || "(no output)"}`,
        );
      }
      return toolText(
        `ZFS snapshot ${args.action} succeeded for ${snapshotTarget(args)}. Verify with zfs_snapshot_list.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.action} ZFS snapshot over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `zfs_snapshot_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerZfsSnapshotAction(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "ZFS Snapshot Actions",
      description:
        "⚠ Creates, destroys, or rolls back a ZFS snapshot (`dataset` + `snapshot` name) over SSH. destroy permanently deletes the rollback point; rollback DISCARDS all changes made after the snapshot and only works against the most recent snapshot (older ones fail with zfs's own error — deliberate: no -r). Requires `confirm: true` AND `acknowledge_risk: true`.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createZfsSnapshotActionHandler(shell, createElicitationChannel(server)),
  );
}
