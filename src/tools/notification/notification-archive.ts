import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ArchiveAllDocument,
  ArchiveNotificationsDocument,
  UnarchiveAllDocument,
  UnarchiveNotificationsDocument,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { IMPORTANCE_TO_API, type ImportanceInput } from "./_shared.js";

const TOOL_NAME = "notification_archive";

type Direction = "archive" | "unarchive";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  direction: z.enum(["archive", "unarchive"]),
  ids: z.array(z.string()).nonempty().optional(),
  all: z.boolean().optional(),
  importance: z.enum(["alert", "warning", "info"]).optional(),
};

interface ArchiveArgs {
  response_format: ResponseFormat;
  direction: Direction;
  ids?: string[];
  all?: boolean;
  importance?: ImportanceInput;
}

/** Validates the target is exactly one of ids|all and that importance is all-only. */
function validateTarget(args: ArchiveArgs): string | null {
  const hasIds = Array.isArray(args.ids) && args.ids.length > 0;
  if (hasIds === Boolean(args.all)) {
    return "Specify exactly one of `ids` (non-empty) or `all: true`. No changes were made.";
  }
  if (args.importance && !args.all) {
    return "`importance` is only valid with `all: true`. No changes were made.";
  }
  return null;
}

/** Runs the ids-target mutation (archive or unarchive) and returns the raw overview. */
async function runIds(client: GraphQLExecutor, direction: Direction, ids: string[]) {
  if (direction === "archive") {
    return (await client.execute(ArchiveNotificationsDocument, { ids })).archiveNotifications;
  }
  return (await client.execute(UnarchiveNotificationsDocument, { ids })).unarchiveNotifications;
}

/** Runs the all-target mutation (archive or unarchive) and returns the raw overview. */
async function runAll(client: GraphQLExecutor, direction: Direction, importance?: ImportanceInput) {
  const variables = { importance: importance ? IMPORTANCE_TO_API[importance] : undefined };
  if (direction === "archive") {
    return (await client.execute(ArchiveAllDocument, variables)).archiveAll;
  }
  return (await client.execute(UnarchiveAllDocument, variables)).unarchiveAll;
}

/** Builds the action-based concise summary (never derived from the returned counts). */
function summarize(args: ArchiveArgs): string {
  const target = args.ids
    ? `${args.ids.length} notification(s)`
    : `all${args.importance ? ` ${IMPORTANCE_TO_API[args.importance]}` : ""} notifications`;
  return `Requested ${args.direction} of ${target}; verify with notification_list.`;
}

/**
 * Creates the `notification_archive` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to archive/unarchive.
 * @returns An MCP handler that moves notifications between unread and archive.
 */
export function createNotificationArchiveHandler(client: GraphQLExecutor) {
  return async (args: ArchiveArgs): Promise<CallToolResult> => {
    const invalid = validateTarget(args);
    if (invalid) {
      return toolError(invalid);
    }
    try {
      const serverOverview = args.ids
        ? await runIds(client, args.direction, args.ids)
        : await runAll(client, args.direction, args.importance);
      const detailed = {
        requested: {
          direction: args.direction,
          ids: args.ids ?? null,
          all: Boolean(args.all),
          importance: args.importance ?? null,
        },
        serverOverview,
      };
      return formatResponse(args.response_format, summarize(args), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.direction} notifications: ${message}`);
    }
  };
}

/**
 * Registers the ungated `notification_archive` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationArchive(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Archive or Unarchive Notifications",
      description:
        "Archive (hide) or unarchive (restore to unread) notifications — reversible. Target specific `ids` (from notification_list — archive expects currently-unread ids, unarchive expects archived ids) or `all: true` (optionally one `importance`). Reports the action; confirm with notification_list.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    createNotificationArchiveHandler(client),
  );
}
