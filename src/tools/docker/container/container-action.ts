import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../../graphql/client.js";
import {
  DockerPauseDocument,
  DockerStartDocument,
  DockerStopDocument,
  DockerUnpauseDocument,
} from "../../../types/unraid/graphql.js";
import { requireConfirmationInteractive } from "../../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../../_shared/elicitation.js";
import { type ResponseFormat, formatResponse, toolError, toolText } from "../../_shared/respond.js";
import { stripLeadingSlash } from "../_shared.js";

const TOOL_NAME = "docker_container_action";

type ContainerAction = "start" | "stop" | "pause" | "unpause" | "restart";

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
  restart: "Restarted",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  action: z.enum(["start", "stop", "pause", "unpause", "restart"]),
  confirm: z.boolean().optional(),
};

/** The API quirk fragment: the action ran but the read-back failed. */
const READBACK_QUIRK = "not found after";

/** True for the known post-action read-back failure (action very likely succeeded). */
function isReadbackQuirk(error: unknown): boolean {
  return error instanceof Error && error.message.includes(READBACK_QUIRK);
}

/**
 * Restart = stop then start (the Unraid API has no restart mutation). A stop
 * read-back quirk is tolerated (the stop happened); any other stop failure
 * aborts before start so a genuinely un-stoppable container is not started
 * into an inconsistent state.
 */
async function runRestart(client: GraphQLExecutor, id: string): Promise<ActionResult> {
  try {
    await client.execute(DockerStopDocument, { id });
  } catch (error) {
    if (!isReadbackQuirk(error)) {
      throw error;
    }
  }
  return (await client.execute(DockerStartDocument, { id })).docker.start;
}

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
    case "restart":
      return runRestart(client, id);
  }
}

/**
 * Creates the `docker_container_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the lifecycle mutation.
 * @returns An MCP handler that starts/stops/pauses/unpauses a container.
 */
export function createDockerContainerActionHandler(
  client: GraphQLExecutor,
  channel?: ElicitationChannel | null,
) {
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
    const refusal = await requireConfirmationInteractive({
      confirm,
      actionDescription: `${action} container ${id}`,
      channel,
    });
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
      if (message.includes(READBACK_QUIRK)) {
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
        "Changes a container's run state (start | stop | pause | unpause | restart). restart is composed stop-then-start (the API has no restart mutation). Requires `confirm: true`. Pass the container `id` from docker_container_list; names often work but the API's post-action read-back is unreliable with names. stop/pause/restart disrupt a running container; start/unpause are restorative but still gated for consistency.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createDockerContainerActionHandler(client, createElicitationChannel(server)),
  );
}
