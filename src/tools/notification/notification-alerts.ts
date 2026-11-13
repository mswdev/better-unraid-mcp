import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { NotificationAlertsDocument } from "../../types/unraid/graphql.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import {
  formatResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";
import { summarizeLine } from "./_shared.js";

const TOOL_NAME = "notification_alerts";

const inputSchema = z.object({
  response_format: responseFormatSchema,
});

/**
 * Creates the `notification_alerts` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read warnings and alerts.
 * @returns An MCP handler returning the unread warning/alert attention set.
 */
export function createNotificationAlertsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: {
    response_format: ResponseFormat;
  }): Promise<CallToolResult> => {
    try {
      const { notifications } = await client.execute(NotificationAlertsDocument);
      const items = notifications.warningsAndAlerts;
      const concise =
        items.length === 0 ? "No unread warnings or alerts." : items.map(summarizeLine).join("\n");
      return formatResponse(response_format, concise, items);
    } catch (error) {
      const message = errorMessage(error);
      return toolError(`Failed to fetch warnings and alerts: ${message}`);
    }
  };
}

/**
 * Registers the read-only `notification_alerts` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationAlerts(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Notification Alerts",
      description:
        "Read-only. Lists the unread warning and alert notifications, deduplicated and newest first (up to 50) — the 'needs attention now' view. Takes no filters and never includes info or archived notifications; for those, or for an importance filter or paging, use notification_list. For counts only use notification_overview. Ids appear only with `response_format: detailed`.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createNotificationAlertsHandler(client),
  );
}
