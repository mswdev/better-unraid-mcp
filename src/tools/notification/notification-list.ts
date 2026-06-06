import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  NotificationListDocument,
  type NotificationListQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import {
  IMPORTANCE_TO_API,
  type ImportanceInput,
  TYPE_TO_API,
  type TypeInput,
  summarizeLine,
} from "./_shared.js";

const TOOL_NAME = "notification_list";
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 25;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  type: z.enum(["unread", "archive"]),
  importance: z.enum(["alert", "warning", "info"]).optional(),
  offset: z.number().int().nonnegative().default(DEFAULT_OFFSET),
  limit: z.number().int().positive().default(DEFAULT_LIMIT),
};

// `offset`/`limit` are optional here even though the Zod schema defaults them: a unit
// test calls the handler directly (bypassing Zod), so the handler also defaults them.
interface ListArgs {
  response_format: ResponseFormat;
  type: TypeInput;
  importance?: ImportanceInput;
  offset?: number;
  limit?: number;
}

type Notifications = NotificationListQuery["notifications"]["list"];

/** Builds the empty-result message, distinguishing an importance filter from none. */
function emptyMessage(args: ListArgs): string {
  if (args.importance) {
    return `No ${args.type} notifications match importance ${IMPORTANCE_TO_API[args.importance]}.`;
  }
  return `No ${args.type} notifications.`;
}

function summarize(list: Notifications, args: ListArgs): string {
  if (list.length === 0) {
    return emptyMessage(args);
  }
  return list.map(summarizeLine).join("\n");
}

/**
 * Creates the `notification_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to list notifications.
 * @returns An MCP handler listing notifications of one type.
 */
export function createNotificationListHandler(client: GraphQLExecutor) {
  return async (args: ListArgs): Promise<CallToolResult> => {
    const filter = {
      type: TYPE_TO_API[args.type],
      ...(args.importance ? { importance: IMPORTANCE_TO_API[args.importance] } : {}),
      offset: args.offset ?? DEFAULT_OFFSET,
      limit: args.limit ?? DEFAULT_LIMIT,
    };
    try {
      const { notifications } = await client.execute(NotificationListDocument, { filter });
      return formatResponse(
        args.response_format,
        summarize(notifications.list, args),
        notifications.list,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list notifications: ${message}`);
    }
  };
}

/**
 * Registers the read-only `notification_list` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Notifications",
      description:
        "Read-only. Lists notifications of one `type` (`unread` or `archive`), newest first. Optional `importance` filter (alert/warning/info); paginate with `offset` (default 0) and `limit` (default 25). The source of truth for which notifications exist and their ids.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createNotificationListHandler(client),
  );
}
