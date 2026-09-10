import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { DockerRemoveContainerDocument } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "docker_container_remove";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  with_image: z.boolean().optional(),
  confirm: z.boolean().optional(),
};

/** Builds the concise summary for a remove result. */
function summarize(id: string, removed: boolean, withImage: boolean | undefined): string {
  if (!removed) {
    return `Container ${id} was not removed (API returned false).`;
  }
  const note = withImage ? " Image removal attempted (best-effort)." : "";
  return `Removed container ${id}.${note}`;
}

/**
 * Creates the `docker_container_remove` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the remove mutation.
 * @returns An MCP handler that permanently removes a container.
 */
export function createDockerContainerRemoveHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    id,
    with_image,
    confirm,
  }: {
    response_format: ResponseFormat;
    id: string;
    with_image?: boolean;
    confirm?: boolean;
  }): Promise<CallToolResult> => {
    const refusal = requireConfirmation(confirm, `remove container ${id}`);
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(DockerRemoveContainerDocument, {
        id,
        withImage: with_image,
      });
      const removed = data.docker.removeContainer;
      return formatResponse(response_format, summarize(id, removed, with_image), { removed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to remove container ${id}: ${message}`);
    }
  };
}

/**
 * Registers the destructive `docker_container_remove` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerRemove(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Remove Docker Container",
      description:
        "Permanently deletes a container; force-kills it if running (no graceful stop); irreversible. `with_image` also attempts to delete the image (best-effort — may report success without deleting a shared/in-use image). Requires `confirm: true`. Needs Unraid OS 7.3+.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createDockerContainerRemoveHandler(client),
  );
}
