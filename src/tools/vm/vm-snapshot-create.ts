import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { requireShell } from "../_shared/require-shell.js";
import { toolError, toolText } from "../_shared/respond.js";
import { probeVirsh } from "./vm-snapshot-list.js";

const TOOL_NAME = "vm_snapshot_create";

const COMMAND_TIMEOUT_MS = 120_000;

/** Snapshot names kept virsh- and filesystem-safe. */
const SNAPSHOT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const inputSchema = {
  vm: z.string().min(1),
  name: z.string().min(1),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface VmSnapshotCreateArgs {
  vm: string;
  name: string;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * External disk-only snapshots mirror Unraid 7's own flow: internal
 * snapshots fail on raw disks and are refused outright for OVMF-firmware
 * VMs (the typical Unraid setup).
 */
function buildCommand(args: VmSnapshotCreateArgs): string {
  return `virsh snapshot-create-as ${quoteForShell(args.vm)} ${quoteForShell(args.name)} --atomic --disk-only`;
}

/**
 * Creates the `vm_snapshot_create` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler creating an external VM disk snapshot.
 */
export function createVmSnapshotCreateHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: VmSnapshotCreateArgs): Promise<CallToolResult> => {
    const unavailable = requireShell(shell);
    if (unavailable || !shell) {
      return unavailable ?? toolError("SSH is not configured.");
    }
    if (!SNAPSHOT_NAME_PATTERN.test(args.name)) {
      return toolError(`Invalid snapshot name: ${args.name}. No changes were made.`);
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: `Refusing to snapshot VM ${args.vm}: this creates external overlay disk files that become part of the VM's storage chain — every later write lands in the overlay until the snapshot is merged away in the Unraid UI. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const missing = await probeVirsh(shell);
      if (missing) {
        return missing;
      }
      const result = await shell.execute(buildCommand(args), COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        return toolError(
          `virsh snapshot-create-as failed for ${args.vm} (exit ${result.exitCode}): ${result.stderr.trim()}`,
        );
      }
      return toolText(
        `External snapshot "${args.name}" created for VM ${args.vm}. Verify with vm_snapshot_list. Reverting/deleting snapshots is deliberately not offered here (external-chain corruption risk) — manage those from the Unraid VM UI.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to create VM snapshot over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `vm_snapshot_create` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerVmSnapshotCreate(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Create VM Snapshot",
      description:
        "⚠ Creates an EXTERNAL disk snapshot of a VM via `virsh snapshot-create-as --atomic --disk-only` over SSH — the same external-snapshot flow Unraid 7 uses (internal snapshots fail on raw disks and OVMF VMs). Adds overlay files to the VM's storage chain. Requires `confirm: true` AND `acknowledge_risk: true`. Revert/delete are deliberately not offered (chain-corruption risk); use the Unraid VM UI for those.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createVmSnapshotCreateHandler(shell, createElicitationChannel(server)),
  );
}
