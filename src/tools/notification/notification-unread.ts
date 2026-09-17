import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { NotificationUnreadDocument } from "../../types/unraid/graphql.js";
import { toolError, toolText } from "../_shared/respond.js";

const TOOL_NAME = "notification_unread";

const inputSchema = z.object({
  id: z.string().min(1),
});

/**
 * Creates the `notification_unread` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @returns An MCP handler that marks one notification unread.
 */
export function createNotificationUnreadHandler(client: GraphQLExecutor) {
  return async (input: { id: string }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(NotificationUnreadDocument, { id: input.id });
      const notification = data.unreadNotification;
      return toolText(
        `Marked "${notification.title}" (${notification.importance}, id ${notification.id}) as unread.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to mark notification ${input.id} unread: ${message}`);
    }
  };
}

/**
 * Registers the `notification_unread` tool on the server. Ungated: moving a
 * notification back to the unread bucket is reversible (archive it again).
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerNotificationUnread(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Mark Notification Unread",
      description:
        "Marks one notification as unread (moves it back to the unread bucket), e.g. to re-surface something archived too early. Reversible via notification_archive. Get ids from notification_list.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createNotificationUnreadHandler(client),
  );
}
