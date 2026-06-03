import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { NotificationOverviewDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { summarizeOverview } from "./_shared.js";

const TOOL_NAME = "notification_overview";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `notification_overview` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read the overview.
 * @returns An MCP handler returning unread/archive notification counts.
 */
export function createNotificationOverviewHandler(client: GraphQLExecutor) {
  return async ({ response_format }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { notifications } = await client.execute(NotificationOverviewDocument);
      return formatResponse(response_format, summarizeOverview(notifications.overview), notifications.overview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch notification overview: ${message}`);
    }
  };
}

/**
 * Registers the read-only `notification_overview` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationOverview(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Notification Overview",
      description:
        "Read-only. Notification counts: unread and archived, each broken down by importance (alert / warning / info) plus total.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createNotificationOverviewHandler(client),
  );
}
