import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerNetworkListDocument,
  type DockerNetworkListQuery,
} from "../../types/unraid/graphql.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import {
  formatResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";

const TOOL_NAME = "docker_network_list";

const inputSchema = z.object({
  response_format: responseFormatSchema,
});

type Networks = DockerNetworkListQuery["docker"]["networks"];

/** Formats one network with its scope and any active flag markers (IPv6, internal). */
function formatNetwork(network: Networks[number]): string {
  const flags: string[] = [];
  if (network.enableIPv6) {
    flags.push("IPv6");
  }
  if (network.internal) {
    flags.push("internal");
  }
  const suffix = flags.length > 0 ? `, ${flags.join(", ")}` : "";
  return `${network.name} — ${network.driver} (${network.scope})${suffix}`;
}

/** One line per network: name, driver, scope, and IPv6/internal flag markers. */
function summarize(networks: Networks): string {
  if (networks.length === 0) {
    return "No Docker networks.";
  }
  return networks.map(formatNetwork).join("\n");
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
  }: {
    response_format: ResponseFormat;
  }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerNetworkListDocument);
      return formatResponse(response_format, summarize(data.docker.networks), data.docker.networks);
    } catch (error) {
      const message = errorMessage(error);
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
      description:
        "Read-only. Lists the Docker networks defined on the server: name, driver, scope, and IPv6/internal flags (`detailed` adds id and attachable). It does not show which containers are attached to each network; for port clashes between containers use docker_port_conflicts.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createDockerNetworkListHandler(client),
  );
}
