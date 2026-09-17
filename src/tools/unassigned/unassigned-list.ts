import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import {
  DISKS_INI,
  LIST_TIMEOUT_MS,
  LSBLK_COMMAND,
  type UnassignedDisk,
  parseAssignedDevices,
  selectUnassigned,
} from "./_shared.js";

const TOOL_NAME = "unassigned_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

function renderPartition(partition: UnassignedDisk["partitions"][number]): string {
  const mount = partition.mountpoint ? `mounted at ${partition.mountpoint}` : "not mounted";
  const label = partition.label ? ` "${partition.label}"` : "";
  return `  - ${partition.device}${label}: ${partition.fstype ?? "no filesystem"}, ${partition.size}, ${mount}`;
}

function renderDisk(disk: UnassignedDisk): string {
  const identity = [disk.model, disk.serial].filter(Boolean).join(" / ") || "unknown model";
  const header = `${disk.device} — ${identity}, ${disk.size}${disk.transport ? ` (${disk.transport})` : ""}`;
  const partitions =
    disk.partitions.length === 0 ? ["  (no partitions)"] : disk.partitions.map(renderPartition);
  return [header, ...partitions].join("\n");
}

function summarize(disks: UnassignedDisk[]): string {
  if (disks.length === 0) {
    return "No unassigned disks (every block device belongs to the array, a pool, or the flash).";
  }
  return [`${disks.length} unassigned disk(s):`, ...disks.map(renderDisk)].join("\n");
}

/**
 * Creates the `unassigned_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns An MCP handler listing disks outside the array, pools, and flash.
 */
export function createUnassignedListHandler(shell: ShellExecutor | null) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      const disksIni = await shell.execute(`cat ${quoteForShell(DISKS_INI)}`, LIST_TIMEOUT_MS);
      const lsblk = await shell.execute(LSBLK_COMMAND, LIST_TIMEOUT_MS);
      const disks = selectUnassigned(lsblk.stdout, parseAssignedDevices(disksIni.stdout));
      return formatResponse(input.response_format, summarize(disks), { disks });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list unassigned devices over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `unassigned_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerUnassignedList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Unassigned Disks",
      description:
        "Read-only. Lists disks that belong to neither the array, a pool, nor the flash drive (cross-referencing lsblk with emhttpd's disks.ini over SSH): model, serial, size, transport, and each partition's filesystem, label, and mount point. The GraphQL API has no unassigned-devices surface. Requires SSH (UNRAID_SSH_*).",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createUnassignedListHandler(shell),
  );
}
