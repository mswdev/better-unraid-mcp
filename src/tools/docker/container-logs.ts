import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerContainerLogsDocument,
  type DockerContainerLogsQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "docker_container_logs";
const DEFAULT_TAIL = 200;
const MAX_TAIL = 2000;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  // ISO-8601 with optional offset — matches the DateTime scalar and a re-passed
  // `cursor` (which may carry a timezone offset), rejecting free-text up front.
  since: z.string().datetime({ offset: true }).optional(),
  tail: z.number().int().positive().max(MAX_TAIL).default(DEFAULT_TAIL),
};

type Logs = DockerContainerLogsQuery["docker"]["logs"];

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

/**
 * Creates the `docker_container_logs` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch container logs.
 * @returns An MCP handler returning recent log lines for a container.
 */
export function createDockerContainerLogsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    id,
    since,
    tail,
  }: {
    response_format: ResponseFormat;
    id: string;
    since?: string;
    tail?: number;
  }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerContainerLogsDocument, { id, since, tail });
      return formatResponse(response_format, summarize(data.docker.logs), data.docker.logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch logs for ${id}: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_container_logs` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerLogs(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Docker Container Logs",
      description:
        "Read-only. Returns recent log lines for a container. `id` is the container id from docker_container_list. `tail` = trailing lines (default 200, max 2000). `since` = inclusive ISO-8601 lower bound; re-pass the returned `cursor` as `since` to page (the boundary line repeats — de-dupe).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerContainerLogsHandler(client),
  );
}
