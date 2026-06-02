import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerPortConflictsDocument,
  type DockerPortConflictsQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "docker_port_conflicts";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type Conflicts = DockerPortConflictsQuery["docker"]["portConflicts"];

/** Counts the container-port and LAN-port conflicts, or notes there are none. */
function summarize(conflicts: Conflicts): string {
  const containerCount = conflicts.containerPorts.length;
  const lanCount = conflicts.lanPorts.length;
  if (containerCount === 0 && lanCount === 0) {
    return "No port conflicts.";
  }
  return `${containerCount} container-port conflict(s), ${lanCount} LAN-port conflict(s).`;
}

/**
 * Creates the `docker_port_conflicts` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch Docker port conflicts.
 * @returns An MCP handler reporting container/LAN port conflicts.
 */
export function createDockerPortConflictsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerPortConflictsDocument);
      const conflicts = data.docker.portConflicts;
      return formatResponse(response_format, summarize(conflicts), conflicts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch Docker port conflicts: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_port_conflicts` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerPortConflicts(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Docker Port Conflicts",
      description: "Read-only. Reports Docker container/LAN port conflicts.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerPortConflictsHandler(client),
  );
}
