import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerNetworkListDocument,
  type DockerNetworkListQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "docker_network_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type Networks = DockerNetworkListQuery["docker"]["networks"];

/** One line per network: name, driver, scope, and an IPv6 marker when enabled. */
function summarize(networks: Networks): string {
  if (networks.length === 0) {
    return "No Docker networks.";
  }
  return networks
    .map((network) => {
      const ipv6 = network.enableIPv6 ? ", IPv6" : "";
      return `${network.name} — ${network.driver} (${network.scope})${ipv6}`;
    })
    .join("\n");
}

/**
 * Creates the `docker_network_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch Docker networks.
 * @returns An MCP handler listing Docker networks and their driver/scope.
 */
export function createDockerNetworkListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerNetworkListDocument);
      return formatResponse(response_format, summarize(data.docker.networks), data.docker.networks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch Docker networks: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_network_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerNetworkList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Docker Networks",
      description: "Read-only. Lists Docker networks (driver, scope, IPv6/internal/attachable).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerNetworkListHandler(client),
  );
}
