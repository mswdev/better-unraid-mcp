import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  CreateNotificationDocument,
  type CreateNotificationMutation,
  NotifyIfUniqueDocument,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { IMPORTANCE_TO_API, type ImportanceInput } from "./_shared.js";

const TOOL_NAME = "notification_create";

type Mode = "always" | "if_unique";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  mode: z.enum(["always", "if_unique"]),
  title: z.string().min(1),
  subject: z.string().min(1),
  description: z.string().min(1),
  importance: z.enum(["alert", "warning", "info"]),
  link: z.string().optional(),
};

interface CreateArgs {
  response_format: ResponseFormat;
  mode: Mode;
  title: string;
  subject: string;
  description: string;
  importance: ImportanceInput;
  link?: string;
}

/**
 * A created notification — the full selection both create mutations return (they share
 * the same fields). Aliased to the generated type so the detailed payload tracks the
 * `.graphql` selection and the `NotificationImportance` enum automatically; `runCreate`
 * may still resolve to `null` (notifyIfUnique skipped a duplicate).
 */
type CreatedNotification = NonNullable<CreateNotificationMutation["createNotification"]>;

/** Runs the chosen create mutation; `if_unique` may resolve to null (duplicate exists). */
async function runCreate(
  client: GraphQLExecutor,
  args: CreateArgs,
): Promise<CreatedNotification | null> {
  const input = {
    title: args.title,
    subject: args.subject,
    description: args.description,
    importance: IMPORTANCE_TO_API[args.importance],
    link: args.link,
  };
  if (args.mode === "if_unique") {
    return (await client.execute(NotifyIfUniqueDocument, { input })).notifyIfUnique;
  }
  return (await client.execute(CreateNotificationDocument, { input })).createNotification;
}

/**
 * Creates the `notification_create` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to create notifications.
 * @returns An MCP handler that writes a notification into Unraid's center.
 */
export function createNotificationCreateHandler(client: GraphQLExecutor) {
  return async (args: CreateArgs): Promise<CallToolResult> => {
    try {
      const notification = await runCreate(client, args);
      if (!notification) {
        return formatResponse(
          args.response_format,
          "An equivalent unread notification already exists; not created.",
          { created: false, notification: null },
        );
      }
      const concise = `Created notification '${notification.title}' (${notification.importance}).`;
      return formatResponse(args.response_format, concise, { created: true, notification });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to create notification: ${message}`);
    }
  };
}

/**
 * Registers the ungated `notification_create` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationCreate(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Create Notification",
      description:
        "Creates a notification in Unraid's notification center. `mode: always` always creates; `mode: if_unique` skips creation when an equivalent unread one already exists. `importance`: alert/warning/info.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    createNotificationCreateHandler(client),
  );
}
