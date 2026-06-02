import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  type DockerAutostartEntryInput,
  DockerAutostartStateDocument,
  type DockerAutostartStateQuery,
  DockerSetAutostartDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_autostart_set";

type Containers = DockerAutostartStateQuery["docker"]["containers"];
type Container = Containers[number];

const changeSchema = z.object({
  id: z.string(),
  auto_start: z.boolean(),
  wait: z.number().int().nonnegative().optional(),
});

type Change = z.infer<typeof changeSchema>;

/** A merged autostart entry plus its current order, used only for sorting. */
interface MergedEntry {
  id: string;
  autoStart: boolean;
  wait: number | undefined;
  order: number | null;
}

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  changes: z.array(changeSchema).nonempty(),
  persist: z.boolean().default(false),
  confirm: z.boolean().optional(),
};

/** Rejects duplicate ids and ids absent from the live container set. */
function validateChanges(changes: Change[], containers: Containers): string | null {
  const ids = changes.map((change) => change.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) {
    return `Duplicate container id(s) in changes: ${duplicates.join(", ")}. No changes were made.`;
  }
  const known = new Set(containers.map((container) => container.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return `Unknown container id(s): ${unknown.join(", ")}. No changes were made.`;
  }
  return null;
}

/** Merges a container's current autostart with its requested change, if any. */
function mergeEntry(container: Container, change: Change | undefined): MergedEntry {
  return {
    id: container.id,
    autoStart: change ? change.auto_start : container.autoStart,
    wait: change?.wait ?? container.autoStartWait ?? undefined,
    order: container.autoStartOrder ?? null,
  };
}

/** Orders entries by autostart position ascending, with unordered ones last. */
function compareByOrder(a: MergedEntry, b: MergedEntry): number {
  if (a.order === null) {
    return b.order === null ? 0 : 1;
  }
  if (b.order === null) {
    return -1;
  }
  return a.order - b.order;
}

/** Builds the full, order-preserving autostart snapshot to resubmit. */
function buildEntries(containers: Containers, changes: Change[]): DockerAutostartEntryInput[] {
  const changeById = new Map(changes.map((change) => [change.id, change]));
  return containers
    .map((container) => mergeEntry(container, changeById.get(container.id)))
    .sort(compareByOrder)
    .map((entry) => ({ id: entry.id, autoStart: entry.autoStart, wait: entry.wait }));
}

/** Describes one requested change for the concise summary. */
function describeChange(change: Change, name: string): string {
  const state = change.auto_start ? "ON" : "OFF";
  const wait = change.auto_start && change.wait ? ` (wait ${change.wait}s)` : "";
  return `${name} ${state}${wait}`;
}

/** Maps each container id to its slash-stripped display name. */
function buildNameById(containers: Containers): Map<string, string> {
  return new Map(
    containers.map((container) => [
      container.id,
      stripLeadingSlash(container.names[0], container.id),
    ]),
  );
}

/** Resolves each requested change to a detailed record for the detailed payload. */
function detailChanges(
  changes: Change[],
  containers: Containers,
): { id: string; name: string; autoStart: boolean; wait: number | null }[] {
  const nameById = buildNameById(containers);
  return changes.map((change) => ({
    id: change.id,
    name: nameById.get(change.id) ?? change.id,
    autoStart: change.auto_start,
    wait: change.wait ?? null,
  }));
}

/** Builds the concise summary of the requested changes. */
function summarize(changes: Change[], containers: Containers, persist: boolean): string {
  const nameById = buildNameById(containers);
  const parts = changes.map((change) =>
    describeChange(change, nameById.get(change.id) ?? change.id),
  );
  const target = persist ? "autostart file + WebGUI prefs" : "autostart file only";
  return `Autostart updated: ${parts.join(", ")} — ${target}; effective next array/Docker start.`;
}

/**
 * Creates the `docker_autostart_set` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read containers and write autostart.
 * @returns An MCP handler that merge-safely sets container autostart on boot.
 */
export function createDockerAutostartSetHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    changes,
    persist,
    confirm,
  }: {
    response_format: ResponseFormat;
    changes: Change[];
    persist: boolean;
    confirm?: boolean;
  }): Promise<CallToolResult> => {
    const refusal = requireConfirmation(confirm, "change Docker autostart configuration");
    if (refusal) {
      return refusal;
    }
    try {
      const { docker } = await client.execute(DockerAutostartStateDocument);
      const validationError = validateChanges(changes, docker.containers);
      if (validationError) {
        return toolError(validationError);
      }
      const entries = buildEntries(docker.containers, changes);
      const result = await client.execute(DockerSetAutostartDocument, { entries, persist });
      const detailed = {
        ok: result.docker.updateAutostartConfiguration,
        persisted: persist,
        changes: detailChanges(changes, docker.containers),
      };
      return formatResponse(
        response_format,
        summarize(changes, docker.containers, persist),
        detailed,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to update Docker autostart: ${message}`);
    }
  };
}

/**
 * Registers the destructive `docker_autostart_set` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerAutostartSet(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Set Docker Container Autostart",
      description:
        "Sets which containers auto-start on boot. Merge-safe: reads the current autostart config, applies your changes, and resubmits the complete set (sorted to preserve boot order) so unlisted containers are untouched. Boot-time only — does not start/stop running containers now; takes effect on the next array/Docker start. `persist: true` also writes the WebGUI's saved prefs but ⚠ reorders the Docker-page container list irreversibly — leave it false unless you want that. Requires `confirm: true`. Needs Unraid OS 7.3+ (ENABLE_NEXT_DOCKER_RELEASE).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createDockerAutostartSetHandler(client),
  );
}
