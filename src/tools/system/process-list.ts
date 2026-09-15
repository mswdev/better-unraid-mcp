import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "process_list";

const COMMAND_TIMEOUT_MS = 20_000;
const DEFAULT_COUNT = 15;
const MAX_COUNT = 50;

/** ps sort keys per user-facing sort mode. */
const SORT_KEYS = { cpu: "-pcpu", memory: "-pmem" } as const;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  sort_by: z.enum(["cpu", "memory"]).default("cpu"),
  count: z.number().int().positive().max(MAX_COUNT).default(DEFAULT_COUNT),
};

/** One parsed process row. */
interface ProcessRow {
  pid: number;
  cpuPercent: number;
  memoryPercent: number;
  residentKib: number;
  elapsed: string;
  command: string;
}

/** Parses fixed-order `ps axo` output (header dropped). */
function parseProcesses(stdout: string): ProcessRow[] {
  return stdout
    .split("\n")
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [pid, pcpu, pmem, rss, etime, ...command] = line.trim().split(/\s+/);
      return {
        pid: Number(pid),
        cpuPercent: Number(pcpu),
        memoryPercent: Number(pmem),
        residentKib: Number(rss),
        elapsed: etime,
        command: command.join(" "),
      };
    });
}

function summarize(processes: ProcessRow[], sortBy: "cpu" | "memory"): string {
  const lines = processes.map(
    (process) =>
      `- ${process.command} (pid ${process.pid}): ${process.cpuPercent}% CPU, ${process.memoryPercent}% mem, up ${process.elapsed}`,
  );
  return [`Top ${processes.length} processes by ${sortBy}:`, ...lines].join("\n");
}

/**
 * Creates the `process_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler listing the busiest host processes.
 */
export function createProcessListHandler(shell: ShellExecutor | null) {
  return async (input: {
    response_format: ResponseFormat;
    sort_by: "cpu" | "memory";
    count: number;
  }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      const command = `ps axo pid,pcpu,pmem,rss,etime,comm --sort=${SORT_KEYS[input.sort_by]} | head -n ${input.count + 1}`;
      const result = await shell.execute(command, COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        return toolError(`ps failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
      }
      const processes = parseProcesses(result.stdout);
      return formatResponse(input.response_format, summarize(processes, input.sort_by), {
        sort_by: input.sort_by,
        processes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list processes over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `process_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerProcessList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Top Processes",
      description:
        "Read-only. The host's busiest processes by CPU or memory (`sort_by`, default cpu; `count` up to 50) via `ps` over SSH — for finding what's eating resources when docker_stats doesn't explain the load.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createProcessListHandler(shell),
  );
}
