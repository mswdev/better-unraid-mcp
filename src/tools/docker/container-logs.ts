import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ShellExecutor } from "../../shell/executor.js";
import {
  DockerContainerLogsDocument,
  type DockerContainerLogsQuery,
} from "../../types/unraid/graphql.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { type ResponseFormat, formatResponse, toolError, toolText } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";

const TOOL_NAME = "docker_container_logs";
const DEFAULT_TAIL = 200;
const MAX_TAIL = 2000;
/** Deadline for the SSH fallback read. */
const FALLBACK_TIMEOUT_MS = 30_000;

/**
 * Validator for `since`: ISO-8601 with optional offset — matches the DateTime
 * scalar and a re-passed `cursor` (which may carry a timezone offset), rejecting
 * free-text up front. Exported so the paging round-trip can be unit-tested.
 */
export const sinceSchema = z.string().datetime({ offset: true }).optional();

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  since: sinceSchema,
  tail: z.number().int().positive().max(MAX_TAIL).default(DEFAULT_TAIL),
};

type Logs = DockerContainerLogsQuery["docker"]["logs"];

/** The validated handler input (tail is always present via the zod default). */
interface ContainerLogsInput {
  response_format: ResponseFormat;
  id: string;
  since?: string;
  tail: number;
}

/** Renders the log lines and, when present, a paging hint for `cursor`. */
function summarize(logs: Logs): string {
  if (logs.lines.length === 0) {
    return "No log lines.";
  }
  const body = logs.lines.map((line) => `[${line.timestamp}] ${line.message}`).join("\n");
  const more = logs.cursor
    ? `\n— more available: re-call with since="${logs.cursor}" (the boundary line repeats; de-dupe).`
    : "";
  return body + more;
}

/** Builds the `docker logs` fallback command (2>&1 merges the stderr stream). */
function buildFallbackCommand(input: ContainerLogsInput): string {
  const since = input.since ? ` --since ${quoteForShell(input.since)}` : "";
  return `docker logs --timestamps --tail ${input.tail}${since} ${quoteForShell(input.id)} 2>&1`;
}

/**
 * Live-verified API gap: `docker.logs` returns zero lines for containers that
 * log only to stderr (e.g. Dozzle). When SSH is configured, fall back to
 * `docker logs`, which captures both streams.
 */
async function fallbackOverSsh(
  shell: ShellExecutor,
  input: ContainerLogsInput,
): Promise<CallToolResult | null> {
  const result = await shell.execute(buildFallbackCommand(input), FALLBACK_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return null;
  }
  const merged = result.stdout.trimEnd();
  if (merged === "") {
    return null;
  }
  return toolText(
    `Log lines via docker logs over SSH (the API returned none; it can miss stderr-only containers):\n${truncateOutput(merged)}`,
  );
}

/**
 * Creates the `docker_container_logs` handler bound to a GraphQL executor,
 * with an optional SSH fallback for stderr-only containers.
 *
 * @param client - The GraphQL executor used to fetch container logs.
 * @param shell - The SSH executor for the fallback, or `null` when unconfigured.
 * @returns An MCP handler returning recent log lines for a container.
 */
export function createDockerContainerLogsHandler(
  client: GraphQLExecutor,
  shell: ShellExecutor | null,
) {
  return async (input: ContainerLogsInput): Promise<CallToolResult> => {
    try {
      const { id, since, tail } = input;
      const data = await client.execute(DockerContainerLogsDocument, { id, since, tail });
      if (data.docker.logs.lines.length === 0 && shell) {
        const fallback = await fallbackOverSsh(shell, input).catch(() => null);
        if (fallback) {
          return fallback;
        }
      }
      return formatResponse(input.response_format, summarize(data.docker.logs), data.docker.logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch logs for ${input.id}: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_container_logs` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @param shell - The SSH executor for the stderr fallback, or `null`.
 */
export function registerDockerContainerLogs(
  server: McpServer,
  client: GraphQLExecutor,
  shell: ShellExecutor | null,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Docker Container Logs",
      description:
        "Read-only. Returns recent log lines for a container. `id` is the container id from docker_container_list. `tail` = trailing lines (default 200, max 2000). `since` = inclusive ISO-8601 lower bound; re-pass the returned `cursor` as `since` to page (the boundary line repeats — de-dupe). The API can miss containers that log only to stderr; when SSH is configured, this tool automatically falls back to `docker logs` for those.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerContainerLogsHandler(client, shell),
  );
}
