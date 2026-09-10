import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireShell } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "docker_stats";
/**
 * Fixed command (no interpolated input, so no quoting/injection surface).
 * One JSON object per line, one line per running container.
 */
const STATS_COMMAND = "docker stats --no-stream --format '{{json .}}'";
/** docker stats takes one sampling interval (~2s) per call; allow slow daemons. */
const STATS_TIMEOUT_MS = 30_000;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

interface DockerStatsInput {
  response_format: ResponseFormat;
}

/** One container's stats row as `docker stats --format '{{json .}}'` emits it. */
interface StatsRow {
  Name?: string;
  CPUPerc?: string;
  MemUsage?: string;
  MemPerc?: string;
  NetIO?: string;
  BlockIO?: string;
  PIDs?: string;
}

/** Parses one output line, returning `null` for non-JSON noise. */
function parseRow(line: string): StatsRow | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as StatsRow) : null;
  } catch {
    return null;
  }
}

/** Extracts the numeric value of a percentage like "12.34%" for sorting. */
function percentValue(percent: string | undefined): number {
  const value = Number.parseFloat(percent ?? "");
  return Number.isNaN(value) ? 0 : value;
}

/** Parses all rows and sorts them by CPU usage, hungriest first. */
function parseRows(stdout: string): StatsRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseRow)
    .filter((row): row is StatsRow => row !== null)
    .sort((a, b) => percentValue(b.CPUPerc) - percentValue(a.CPUPerc));
}

/** Renders one line per container: name, CPU, memory, network, block IO, PIDs. */
function summarize(rows: StatsRow[]): string {
  if (rows.length === 0) {
    return "No running containers reported by docker stats.";
  }
  const lines = rows.map(
    (row) =>
      `${row.Name ?? "(unnamed)"}: CPU ${row.CPUPerc ?? "?"}, MEM ${row.MemUsage ?? "?"} (${row.MemPerc ?? "?"}), NET ${row.NetIO ?? "?"}, IO ${row.BlockIO ?? "?"}, PIDs ${row.PIDs ?? "?"}`,
  );
  return [`Per-container usage (${rows.length} running, sorted by CPU):`, ...lines].join("\n");
}

/**
 * Creates the `docker_stats` handler bound to a shell executor. Runs a fixed
 * `docker stats --no-stream` snapshot over SSH because the GraphQL API only
 * exposes container stats as a subscription, which MCP tools cannot consume.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler returning per-container CPU/memory/IO usage.
 * @example
 * const handler = createDockerStatsHandler(shell);
 * await handler({ response_format: "concise" });
 */
export function createDockerStatsHandler(shell: ShellExecutor | null) {
  return async (input: DockerStatsInput): Promise<CallToolResult> => {
    const unavailable = requireShell(shell);
    if (unavailable || !shell) {
      return unavailable ?? toolError("SSH is not configured.");
    }
    try {
      const result = await shell.execute(STATS_COMMAND, STATS_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || "(no error output)";
        return toolError(`docker stats failed (exit ${result.exitCode}): ${detail}`);
      }
      const rows = parseRows(result.stdout);
      return formatResponse(input.response_format, summarize(rows), rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to collect docker stats over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_stats` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerDockerStats(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Docker Container Stats",
      description:
        "Read-only. Point-in-time per-container resource usage (CPU %, memory, network IO, block IO, PIDs) from `docker stats --no-stream`, sorted hungriest CPU first: use it to find which container is eating the box. Takes a couple of seconds (one stats sampling interval). Runs over SSH because the GraphQL API only exposes these numbers as a subscription; requires SSH to be configured (UNRAID_SSH_* environment variables).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerStatsHandler(shell),
  );
}
