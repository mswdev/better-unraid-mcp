import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { DATASET_PATTERN, ZFS_COMMAND_TIMEOUT_MS, probeZfs } from "./_shared.js";

const TOOL_NAME = "zfs_dataset_list";

const BYTES_PER_GIB = 1024 ** 3;

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  pool: z.string().optional(),
});

/** One dataset row from `zfs list -H -p`. */
interface DatasetRow {
  name: string;
  usedBytes: number;
  availableBytes: number;
  referencedBytes: number;
  mountpoint: string;
}

/** Parses the tab-separated, parseable-numbers dataset listing. */
function parseDatasets(stdout: string): DatasetRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, used, available, referenced, mountpoint] = line.split("\t");
      return {
        name,
        usedBytes: Number(used),
        availableBytes: Number(available),
        referencedBytes: Number(referenced),
        mountpoint,
      };
    });
}

function gib(bytes: number): string {
  return `${(bytes / BYTES_PER_GIB).toFixed(1)} GiB`;
}

function summarize(datasets: DatasetRow[]): string {
  if (datasets.length === 0) {
    return "No ZFS datasets found.";
  }
  const lines = datasets.map(
    (dataset) =>
      `- ${dataset.name}: ${gib(dataset.usedBytes)} used, ${gib(dataset.availableBytes)} available (${dataset.mountpoint})`,
  );
  return [`${datasets.length} dataset(s):`, ...lines].join("\n");
}

/**
 * Creates the `zfs_dataset_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler listing ZFS datasets with usage.
 */
export function createZfsDatasetListHandler(shell: ShellExecutor | null) {
  return async (input: {
    response_format: ResponseFormat;
    pool?: string;
  }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    if (input.pool && !DATASET_PATTERN.test(input.pool)) {
      return toolError(`Invalid pool name: ${input.pool}`);
    }
    try {
      const missing = await probeZfs(shell);
      if (missing) {
        return missing;
      }
      const scope = input.pool ? ` -r ${quoteForShell(input.pool)}` : "";
      const command = `zfs list -H -p -o name,used,avail,refer,mountpoint${scope}`;
      const result = await shell.execute(command, ZFS_COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        return toolError(`zfs list failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
      }
      const datasets = parseDatasets(result.stdout);
      return formatResponse(input.response_format, summarize(datasets), { datasets });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list ZFS datasets over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `zfs_dataset_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerZfsDatasetList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List ZFS Datasets",
      description:
        "Read-only. Lists ZFS datasets with used/available space and mountpoints over SSH; optional `pool` limits to one pool (recursive). Reports clearly when ZFS is not available.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createZfsDatasetListHandler(shell),
  );
}
