import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { DATASET_PATTERN, ZFS_COMMAND_TIMEOUT_MS, probeZfs } from "./_shared.js";

const TOOL_NAME = "zfs_snapshot_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  dataset: z.string().optional(),
};

/** One snapshot row. */
interface SnapshotRow {
  name: string;
  used: string;
  creation: string;
}

function parseSnapshots(stdout: string): SnapshotRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, used, ...creation] = line.split("\t");
      return { name, used, creation: creation.join(" ") };
    });
}

function summarize(snapshots: SnapshotRow[]): string {
  if (snapshots.length === 0) {
    return "No ZFS snapshots found.";
  }
  const lines = snapshots.map(
    (snapshot) => `- ${snapshot.name} (${snapshot.used}, created ${snapshot.creation})`,
  );
  return [`${snapshots.length} snapshot(s):`, ...lines].join("\n");
}

/**
 * Creates the `zfs_snapshot_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler listing ZFS snapshots.
 */
export function createZfsSnapshotListHandler(shell: ShellExecutor | null) {
  return async (input: {
    response_format: ResponseFormat;
    dataset?: string;
  }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    if (input.dataset && !DATASET_PATTERN.test(input.dataset)) {
      return toolError(`Invalid dataset name: ${input.dataset}`);
    }
    try {
      const missing = await probeZfs(shell);
      if (missing) {
        return missing;
      }
      const scope = input.dataset ? ` -r ${quoteForShell(input.dataset)}` : "";
      const command = `zfs list -H -t snapshot -o name,used,creation${scope}`;
      const result = await shell.execute(command, ZFS_COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        return toolError(
          `zfs snapshot list failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
        );
      }
      const snapshots = parseSnapshots(result.stdout);
      return formatResponse(input.response_format, summarize(snapshots), { snapshots });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list ZFS snapshots over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `zfs_snapshot_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerZfsSnapshotList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List ZFS Snapshots",
      description:
        "Read-only. Lists ZFS snapshots (name, space used, creation time) over SSH; optional `dataset` limits to one dataset (recursive). Reports clearly when ZFS is not available.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createZfsSnapshotListHandler(shell),
  );
}
