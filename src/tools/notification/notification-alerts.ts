import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { NotificationAlertsDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { summarizeLine } from "./_shared.js";

const TOOL_NAME = "notification_alerts";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `notification_alerts` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read warnings and alerts.
 * @returns An MCP handler returning the unread warning/alert attention set.
 */
export function createNotificationAlertsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { notifications } = await client.execute(NotificationAlertsDocument);
      const items = notifications.warningsAndAlerts;
      const concise =
        items.length === 0 ? "No unread warnings or alerts." : items.map(summarizeLine).join("\n");
      return formatResponse(response_format, concise, items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        "Read-only. Deduplicated unread warnings and alerts, newest first — the 'needs attention now' view (up to 50).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createNotificationAlertsHandler(client),
  );
}
