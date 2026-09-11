import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerPauseDocument,
  DockerStartDocument,
  DockerStopDocument,
  DockerUnpauseDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError, toolText } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_container_action";

type ContainerAction = "start" | "stop" | "pause" | "unpause";

/** A lifecycle action's resulting container (all four ops return this shape). */
interface ActionResult {
  id: string;
  names: string[];
  state: string;
  status: string;
}

const PAST_TENSE: Record<ContainerAction, string> = {
  start: "Started",
  stop: "Stopped",
  pause: "Paused",
  unpause: "Unpaused",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  action: z.enum(["start", "stop", "pause", "unpause"]),
  confirm: z.boolean().optional(),
};

/** Dispatches one lifecycle action to its typed mutation Document. */
async function runAction(
  client: GraphQLExecutor,
  action: ContainerAction,
  id: string,
): Promise<ActionResult> {
  switch (action) {
    case "start":
      return (await client.execute(DockerStartDocument, { id })).docker.start;
    case "stop":
      return (await client.execute(DockerStopDocument, { id })).docker.stop;
    case "pause":
      return (await client.execute(DockerPauseDocument, { id })).docker.pause;
    case "unpause":
      return (await client.execute(DockerUnpauseDocument, { id })).docker.unpause;
  }
}

/**
 * Creates the `docker_container_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the lifecycle mutation.
 * @returns An MCP handler that starts/stops/pauses/unpauses a container.
 */
export function createDockerContainerActionHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    id,
    action,
    confirm,
  }: {
    response_format: ResponseFormat;
    id: string;
    action: ContainerAction;
    confirm?: boolean;
  }): Promise<CallToolResult> => {
    const refusal = requireConfirmation(confirm, `${action} container ${id}`);
    if (refusal) {
      return refusal;
    }
    try {
      const container = await runAction(client, action, id);
      const name = stripLeadingSlash(container.names[0], id);
      return formatResponse(response_format, `${PAST_TENSE[action]} container ${name}.`, container);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Live-verified API quirk: the mutation performs the action, then fails
      // its own read-back (especially when addressed by name) and throws
      // "... not found after <action>". Reporting that as a failure invites a
      // pointless retry, so surface it as issued-but-unverified instead.
      if (message.includes("not found after")) {
        return toolText(
          `Requested ${action} for container ${id}. The API could not read the container back after the action (a known quirk, most common when addressing by name instead of id); the ${action} very likely succeeded. Verify with docker_container_list.`,
        );
      }
      return toolError(`Failed to ${action} container ${id}: ${message}`);
    }
  };
}

/**
 * Registers the destructive `docker_container_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerAction(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Start/Stop/Pause Docker Container",
      description:
        "Changes a container's run state (start | stop | pause | unpause). Requires `confirm: true`. Pass the container `id` from docker_container_list; names often work but the API's post-action read-back is unreliable with names. stop/pause disrupt a running container; start/unpause are restorative but still gated for consistency.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createDockerContainerActionHandler(client),
  );
}
