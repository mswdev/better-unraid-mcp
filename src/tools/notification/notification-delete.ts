import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DeleteArchivedNotificationsDocument,
  DeleteNotificationDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { type Overview, TYPE_TO_API, type TypeInput } from "./_shared.js";

const TOOL_NAME = "notification_delete";

type Scope = "one" | "all_archived";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  scope: z.enum(["one", "all_archived"]),
  id: z.string().optional(),
  type: z.enum(["unread", "archive"]).optional(),
  confirm: z.boolean().optional(),
};

interface DeleteArgs {
  response_format: ResponseFormat;
  scope: Scope;
  id?: string;
  type?: TypeInput;
  confirm?: boolean;
}

/** Validates scope arguments: `one` needs id+type; `all_archived` takes neither. */
function validateScope(args: DeleteArgs): string | null {
  if (args.scope === "one" && (!args.id || !args.type)) {
    return "`scope: one` requires both `id` and `type`. No changes were made.";
  }
  if (args.scope === "all_archived" && (args.id || args.type)) {
    return "`scope: all_archived` takes no `id`/`type`. No changes were made.";
  }
  return null;
}

/** Runs the scoped delete and returns the resulting (race-free) overview. */
async function runDelete(client: GraphQLExecutor, args: DeleteArgs): Promise<Overview> {
  if (args.scope === "all_archived") {
    return (await client.execute(DeleteArchivedNotificationsDocument)).deleteArchivedNotifications;
  }
  // validateScope guarantees id+type are present here.
  const id = args.id as string;
  const type = TYPE_TO_API[args.type as TypeInput];
  return (await client.execute(DeleteNotificationDocument, { id, type })).deleteNotification;
}

/** Builds the resulting-counts summary (deletes are race-free, so counts are reportable). */
function summarize(scope: Scope, overview: Overview): string {
  const tally = `now ${overview.unread.total} unread / ${overview.archive.total} archived`;
  const what = scope === "all_archived" ? "all archived notifications" : "1 notification";
  return `Deleted ${what}; ${tally}.`;
}

/**
 * Creates the `notification_delete` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to delete notifications.
 * @returns An MCP handler that permanently deletes notifications behind a confirm gate.
 */
export function createNotificationDeleteHandler(client: GraphQLExecutor) {
  return async (args: DeleteArgs): Promise<CallToolResult> => {
    const refusal = requireConfirmation(args.confirm, `delete notifications (${args.scope})`);
    if (refusal) {
      return refusal;
    }
    const invalid = validateScope(args);
    if (invalid) {
      return toolError(invalid);
    }
    try {
      const overview = await runDelete(client, args);
      return formatResponse(args.response_format, summarize(args.scope, overview), { overview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to delete notifications: ${message}`);
    }
  };
}

/**
 * Registers the destructive `notification_delete` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationDelete(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Delete Notifications",
      description:
        "⚠ Permanently deletes notifications (irreversible). `scope`: `one` (needs `id` and its `type`) or `all_archived` (every archived notification). Requires `confirm: true`. Reports the resulting counts.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createNotificationDeleteHandler(client),
  );
}
