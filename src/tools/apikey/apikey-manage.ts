import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ApiKeyAddRoleDocument,
  ApiKeyCreateDocument,
  ApiKeyDeleteDocument,
  ApiKeyRemoveRoleDocument,
  ApiKeyUpdateDocument,
  type Role,
} from "../../types/unraid/graphql.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { createElicitationChannel, type ElicitationChannel } from "../_shared/elicitation.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import { toolError, toolText } from "../_shared/respond.js";

const TOOL_NAME = "apikey_manage";

const ROLES = ["ADMIN", "CONNECT", "GUEST", "VIEWER"] as const;

type ManageAction = "create" | "update" | "add_role" | "remove_role" | "delete";

const inputSchema = z.object({
  action: z.enum(["create", "update", "add_role", "remove_role", "delete"]),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  roles: z.array(z.enum(ROLES)).optional(),
  id: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
});

/** The validated handler arguments. */
interface ApiKeyManageArgs {
  action: ManageAction;
  name?: string;
  description?: string;
  roles?: Role[];
  id?: string;
  ids?: string[];
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * Arguments that passed validation, narrowed per action so each mutation
 * reads exactly the fields its action requires (no placeholder fallbacks).
 */
type ValidatedArgs =
  | (ApiKeyManageArgs & { action: "create"; name: string })
  | (ApiKeyManageArgs & { action: "update"; id: string })
  | (ApiKeyManageArgs & { action: "add_role" | "remove_role"; id: string; roles: Role[] })
  | (ApiKeyManageArgs & { action: "delete"; ids: string[] });

/** Per-action argument requirements; returns the narrowed args or an error message. */
function validateArgs(args: ApiKeyManageArgs): ValidatedArgs | string {
  const { action, name, id, ids, roles } = args;
  if (action === "create") {
    return name ? { ...args, action, name } : 'action "create" requires `name`.';
  }
  if (action === "update") {
    return id ? { ...args, action, id } : 'action "update" requires `id`.';
  }
  if (action === "add_role" || action === "remove_role") {
    if (!id || roles?.length !== 1) {
      return `action "${action}" requires \`id\` and exactly one role in \`roles\`.`;
    }
    return { ...args, action, id, roles };
  }
  return ids?.length
    ? { ...args, action, ids }
    : 'action "delete" requires `ids` (one or more key ids).';
}

/** Blast-radius refusal copy — this tool manages credentials. */
function refusalMessage(args: ApiKeyManageArgs): string {
  return `Refusing to ${args.action} API key(s): this manages the credentials that control access to your Unraid server${
    args.action === "delete"
      ? ", and deleting the key this MCP server itself uses would lock it out"
      : ""
  }. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/** Runs the selected mutation and renders its outcome text. */
async function runManageAction(client: GraphQLExecutor, args: ValidatedArgs): Promise<string> {
  switch (args.action) {
    case "create":
      return runCreate(client, args);
    case "update": {
      const input = {
        id: args.id,
        name: args.name,
        description: args.description,
        roles: args.roles,
      };
      const data = await client.execute(ApiKeyUpdateDocument, { input });
      const updated = data.apiKey.update;
      return `Updated API key "${updated.name}" (id ${updated.id}); roles now [${updated.roles.join(", ")}].`;
    }
    case "add_role": {
      const input = { apiKeyId: args.id, role: args.roles[0] };
      await client.execute(ApiKeyAddRoleDocument, { input });
      return `Role ${input.role} added to API key ${args.id}. Verify with apikey_list.`;
    }
    case "remove_role": {
      const input = { apiKeyId: args.id, role: args.roles[0] };
      await client.execute(ApiKeyRemoveRoleDocument, { input });
      return `Role ${input.role} removed from API key ${args.id}. Verify with apikey_list.`;
    }
    case "delete": {
      await client.execute(ApiKeyDeleteDocument, { input: { ids: args.ids } });
      return `Deleted API key(s) ${args.ids.join(", ")}. Verify with apikey_list.`;
    }
  }
}

/**
 * Creation is the one sanctioned key disclosure: the value exists only at
 * creation time, so it is shown once, phrased to avoid the redactor's
 * credential key:value pattern.
 */
async function runCreate(
  client: GraphQLExecutor,
  args: ValidatedArgs & { action: "create" },
): Promise<string> {
  const input = { name: args.name, description: args.description, roles: args.roles };
  const data = await client.execute(ApiKeyCreateDocument, { input });
  const created = data.apiKey.create;
  return [
    `Created API key "${created.name}" (id ${created.id}) with roles [${created.roles.join(", ")}].`,
    `Key value (shown once — store it somewhere safe now): ${created.key}`,
  ].join("\n");
}

/**
 * Creates the `apikey_manage` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used for the mutations.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler for API key lifecycle management.
 */
export function createApiKeyManageHandler(
  client: GraphQLExecutor,
  channel?: ElicitationChannel | null,
) {
  return async (args: ApiKeyManageArgs): Promise<CallToolResult> => {
    const validated = validateArgs(args);
    if (typeof validated === "string") {
      return toolError(`${validated} No changes were made.`);
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return toolText(await runManageAction(client, validated));
    } catch (error) {
      const message = errorMessage(error);
      return toolError(`Failed to ${args.action} API key(s): ${message}`);
    }
  };
}

/**
 * Registers the destructive `apikey_manage` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerApiKeyManage(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Manage API Keys",
      description:
        "⚠ Credential management: create, update, add_role, remove_role, or delete Unraid API keys. This is the model managing the very credentials that control server access — the key VALUE is disclosed exactly once, at creation. Deleting the key this MCP server uses locks it out. Requires `confirm: true` AND `acknowledge_risk: true`. Roles: ADMIN, CONNECT, GUEST, VIEWER. Use apikey_list for ids.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createApiKeyManageHandler(client, createElicitationChannel(server)),
  );
}
