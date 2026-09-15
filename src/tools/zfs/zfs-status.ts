import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { PROBE_TIMEOUT_MS, ZFS_COMMAND_TIMEOUT_MS, probeZfs } from "./_shared.js";

const TOOL_NAME = "zfs_status";

/** Tab-separated pool listing, stable across zfs versions. */
const POOL_LIST_COMMAND = "zpool list -H -o name,size,alloc,free,cap,health";

/** ARC stats live in procfs; the arcstat script is Python (absent on stock Unraid). */
const ARCSTATS_COMMAND = "cat /proc/spl/kstat/zfs/arcstats 2>/dev/null";

const BYTES_PER_GIB = 1024 ** 3;
const PERCENT = 100;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** One imported pool's health line. */
interface PoolStatus {
  name: string;
  size: string;
  allocated: string;
  free: string;
  capacity: string;
  health: string;
}

/** Parses the tab-separated `zpool list -H` output. */
function parsePools(stdout: string): PoolStatus[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, size, allocated, free, capacity, health] = line.split("\t");
      return { name, size, allocated, free, capacity, health };
    });
}

/** Pulls one numeric field out of the procfs arcstats table. */
function arcField(stdout: string, field: string): number | null {
  const match = stdout.match(new RegExp(`^${field}\\s+\\d+\\s+(\\d+)`, "m"));
  return match ? Number(match[1]) : null;
}

/** Renders the ARC line, or an honest absence note. */
function arcSummary(stdout: string): {
  text: string;
  sizeBytes: number | null;
  maxBytes: number | null;
} {
  const sizeBytes = arcField(stdout, "size");
  const maxBytes = arcField(stdout, "c_max");
  if (sizeBytes === null || maxBytes === null || maxBytes === 0) {
    return { text: "ARC stats unavailable.", sizeBytes, maxBytes };
  }
  const sizeGib = (sizeBytes / BYTES_PER_GIB).toFixed(1);
  const maxGib = (maxBytes / BYTES_PER_GIB).toFixed(1);
  const percent = Math.round((sizeBytes / maxBytes) * PERCENT);
  return { text: `ARC: ${sizeGib} GiB of ${maxGib} GiB max (${percent}%).`, sizeBytes, maxBytes };
}

function summarize(pools: PoolStatus[], arcText: string): string {
  if (pools.length === 0) {
    return `No ZFS pools imported. ${arcText}`;
  }
  const lines = pools.map(
    (pool) =>
      `- ${pool.name}: ${pool.health}, ${pool.allocated} used of ${pool.size} (${pool.capacity} full)`,
  );
  return [`${pools.length} ZFS pool(s):`, ...lines, arcText].join("\n");
}

/**
 * Creates the `zfs_status` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler reporting pool health and ARC usage.
 */
export function createZfsStatusHandler(shell: ShellExecutor | null) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      const missing = await probeZfs(shell);
      if (missing) {
        return missing;
      }
      const list = await shell.execute(POOL_LIST_COMMAND, ZFS_COMMAND_TIMEOUT_MS);
      if (list.exitCode !== 0) {
        return toolError(`zpool list failed (exit ${list.exitCode}): ${list.stderr.trim()}`);
      }
      const arc = await shell.execute(ARCSTATS_COMMAND, PROBE_TIMEOUT_MS);
      const pools = parsePools(list.stdout);
      const arcInfo = arcSummary(arc.stdout);
      const detailed = { pools, arc: { sizeBytes: arcInfo.sizeBytes, maxBytes: arcInfo.maxBytes } };
      return formatResponse(input.response_format, summarize(pools, arcInfo.text), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read ZFS status over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `zfs_status` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerZfsStatus(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "ZFS Pool Status",
      description:
        "Read-only. ZFS pool health and capacity (zpool list) plus ARC memory usage from /proc/spl/kstat/zfs/arcstats, over SSH. Reports clearly when ZFS is not available. ZFS ships with Unraid 6.12+.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createZfsStatusHandler(shell),
  );
}
