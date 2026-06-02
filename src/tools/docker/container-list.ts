import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerContainerListDocument,
  type DockerContainerListQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_container_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  name: z.string().optional(),
};

type Containers = DockerContainerListQuery["docker"]["containers"];

/** Filters containers by a case-insensitive substring of any slash-stripped name. */
function filterByName(containers: Containers, name: string | undefined): Containers {
  if (!name) {
    return containers;
  }
  const needle = name.toLowerCase();
  return containers.filter((container) =>
    container.names.some((raw) => stripLeadingSlash(raw).toLowerCase().includes(needle)),
  );
}

/** One line per container: name, state, image, and an update marker. */
function summarize(containers: Containers): string {
  if (containers.length === 0) {
    return "No Docker containers found.";
  }
  return containers
    .map((container) => {
      const name = stripLeadingSlash(container.names[0], "(unnamed)");
      const update = container.isUpdateAvailable ? " — ⬆ update available" : "";
      return `${name} — ${container.state} — ${container.image}${update}`;
    })
    .join("\n");
}

/**
 * Creates the `docker_container_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch containers.
 * @returns An MCP handler listing Docker containers and their state.
 */
export function createDockerContainerListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    name,
  }: { response_format: ResponseFormat; name?: string }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerContainerListDocument);
      const containers = filterByName(data.docker.containers, name);
      return formatResponse(response_format, summarize(containers), containers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch Docker containers: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_container_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Docker Containers",
      description:
        "Read-only. Lists Docker containers with state, image, and whether an update is available. Use `name` to filter by a container-name substring.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerContainerListHandler(client),
  );
}
