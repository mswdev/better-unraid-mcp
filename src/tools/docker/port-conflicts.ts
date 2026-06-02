import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerPortConflictsDocument,
  type DockerPortConflictsQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_port_conflicts";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type Conflicts = DockerPortConflictsQuery["docker"]["portConflicts"];
type ContainerPortConflict = Conflicts["containerPorts"][number];
type LanPortConflict = Conflicts["lanPorts"][number];

/** Joins the slash-stripped names of the containers involved in a conflict. */
function formatConflictNames(containers: { name: string }[]): string {
  return containers.map((container) => stripLeadingSlash(container.name)).join(", ");
}

/** Renders one container-port conflict: port/protocol and the offending containers. */
function formatContainerPort(conflict: ContainerPortConflict): string {
  return `${conflict.privatePort}/${conflict.type} (${formatConflictNames(conflict.containers)})`;
}

/** Renders one LAN-port conflict: host:port and the offending containers. */
function formatLanPort(conflict: LanPortConflict): string {
  return `${conflict.lanIpPort} (${formatConflictNames(conflict.containers)})`;
}

/** Lists the offending container/LAN port conflicts, or notes there are none. */
function summarize(conflicts: Conflicts): string {
  const { containerPorts, lanPorts } = conflicts;
  if (containerPorts.length === 0 && lanPorts.length === 0) {
    return "No port conflicts.";
  }
  const lines: string[] = [];
  if (containerPorts.length > 0) {
    lines.push(`Container-port conflicts: ${containerPorts.map(formatContainerPort).join("; ")}`);
  }
  if (lanPorts.length > 0) {
    lines.push(`LAN-port conflicts: ${lanPorts.map(formatLanPort).join("; ")}`);
  }
  return lines.join("\n");
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
