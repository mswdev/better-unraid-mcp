import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerUpdateAllDocument,
  DockerUpdateContainersDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_container_update";

/** A container as returned by either update mutation (shared fields). */
interface UpdatedContainer {
  names: string[];
}

/** The resolved, mutually-exclusive update target, or a validation error. */
type Target = { error: string } | { mode: "all" } | { mode: "ids"; ids: string[] };

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  ids: z.array(z.string()).nonempty().optional(),
  all: z.boolean().optional(),
  confirm: z.boolean().optional(),
};

/**
 * Resolves the mutually-exclusive target from the `ids`/`all` arguments. The
 * narrowed `ids` is carried on the result so the caller never re-checks it.
 *
 * @param ids - Explicit container ids, when provided.
 * @param all - Whether to update every container with an available update.
 * @returns A validation error, or the chosen update mode (with `ids` when applicable).
 */
function resolveTarget(ids: string[] | undefined, all: boolean | undefined): Target {
  if (ids !== undefined && ids.length > 0) {
    if (all === true) {
      return { error: "Provide either `ids` or `all`, not both." };
    }
    return { mode: "ids", ids };
  }
  if (all !== true) {
    return { error: "Provide `ids` (one or more) or `all: true`." };
  }
  return { mode: "all" };
}

/**
 * Dispatches the resolved target to its typed mutation Document.
 *
 * @param client - The GraphQL executor used to run the update mutation.
 * @param target - The resolved update mode (`ids` carries its container ids).
 * @returns The containers reported by the chosen mutation.
 */
async function runUpdate(
  client: GraphQLExecutor,
  target: { mode: "all" } | { mode: "ids"; ids: string[] },
): Promise<UpdatedContainer[]> {
  if (target.mode === "all") {
    return (await client.execute(DockerUpdateAllDocument)).docker.updateAllContainers;
  }
  return (await client.execute(DockerUpdateContainersDocument, { ids: target.ids })).docker
    .updateContainers;
}

/** Summarizes the update result; empty is a success, not a failure. */
function summarize(containers: UpdatedContainer[]): string {
  if (containers.length === 0) {
    return "No containers had an available update.";
  }
  const names = containers.map((container) => stripLeadingSlash(container.names[0], "(unnamed)"));
  // "requested", not "Updated": updating an orphaned (no-template) container is
  // a silent no-op — the API returns it unchanged, so we must not over-claim.
  return `Update requested for ${containers.length} container(s): ${names.join(", ")}.`;
}

/**
 * Creates the `docker_container_update` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the update mutation.
 * @returns An MCP handler that pulls latest images and recreates containers.
 */
export function createDockerContainerUpdateHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    ids,
    all,
    confirm,
  }: {
    response_format: ResponseFormat;
    ids?: string[];
    all?: boolean;
    confirm?: boolean;
  }): Promise<CallToolResult> => {
    const refusal = requireConfirmation(confirm, "update Docker container(s)");
    if (refusal) {
      return refusal;
    }
    const target = resolveTarget(ids, all);
    if ("error" in target) {
      return toolError(target.error);
    }
    try {
      const containers = await runUpdate(client, target);
      return formatResponse(response_format, summarize(containers), containers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to update Docker container(s): ${message}`);
    }
  };
}

/**
 * Registers the destructive `docker_container_update` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerUpdate(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Update Docker Container(s)",
      description:
        "Pulls the latest image(s) and recreates container(s). `ids` updates those containers (force-pull regardless of update-available); `all` updates every container with a known-available update (returns none if the cache is cold — not an error). Updating an orphaned container with no template is a silent no-op. Requires `confirm: true`. Needs Unraid OS 7.3+.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createDockerContainerUpdateHandler(client),
  );
}
