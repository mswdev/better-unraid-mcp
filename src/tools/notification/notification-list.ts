import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  NotificationListDocument,
  type NotificationListQuery,
} from "../../types/unraid/graphql.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import {
  formatResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";
import {
  IMPORTANCE_TO_API,
  type ImportanceInput,
  summarizeLine,
  TYPE_TO_API,
  type TypeInput,
} from "./_shared.js";

const TOOL_NAME = "notification_list";
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 25;

const inputSchema = z.object({
  response_format: responseFormatSchema,
  type: z
    .enum(["unread", "archive"])
    .describe("Which bucket to list: unread notifications or archived ones."),
  importance: z
    .enum(["alert", "warning", "info"])
    .optional()
    .describe("Only return notifications of this importance; omit for all levels."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_OFFSET)
    .describe("Number of notifications to skip, for paging."),
  limit: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_LIMIT)
    .describe("Maximum number of notifications to return per page."),
});

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
      const message = errorMessage(error);
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
        "Read-only. Lists notifications of one `type` (`unread` or `archive`), newest first. Optional `importance` filter (alert/warning/info); paginate with `offset` (default 0) and `limit` (default 25). The source of truth for which notifications exist and for the ids that notification_archive, notification_unread and notification_delete take; ids appear only with `response_format: detailed`. For just the unread warnings and alerts use notification_alerts; for counts only use notification_overview.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createNotificationListHandler(client),
  );
}
