import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { RecalculateOverviewDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "notification_recalculate";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `notification_recalculate` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to re-sync the overview.
 * @returns An MCP handler that recomputes the overview counts from disk.
 */
export function createNotificationRecalculateHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { recalculateOverview } = await client.execute(RecalculateOverviewDocument);
      const concise = `Overview re-synced from disk: ${recalculateOverview.unread.total} unread / ${recalculateOverview.archive.total} archived.`;
      return formatResponse(response_format, concise, recalculateOverview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to recalculate notification overview: ${message}`);
    }
  };
}

/**
 * Registers the ungated `notification_recalculate` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationRecalculate(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Recalculate Notification Overview",
      description:
        "Re-syncs the notification overview counts from disk (corrects cache drift after bulk changes). Returns the refreshed counts.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    createNotificationRecalculateHandler(client),
  );
}
