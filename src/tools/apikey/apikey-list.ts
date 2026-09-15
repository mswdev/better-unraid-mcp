import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ApiKeyListDocument, type ApiKeyListQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "apikey_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type ApiKeyEntry = ApiKeyListQuery["apiKeys"][number];

/** One line per key: name, roles, and creation date — never the key value. */
function summarize(keys: ApiKeyEntry[]): string {
  if (keys.length === 0) {
    return "No API keys configured.";
  }
  const lines = keys.map(
    (key) =>
      `- ${key.name} (id ${key.id}): roles [${key.roles.join(", ")}], created ${key.createdAt}`,
  );
  return [`${keys.length} API key(s):`, ...lines].join("\n");
}

/**
 * Creates the `apikey_list` handler bound to a GraphQL executor. The query
 * deliberately never selects the `key` field, so secret values cannot enter
 * the response path at all.
 *
 * @param client - The GraphQL executor used for the read.
 * @returns An MCP handler listing configured API keys (metadata only).
 */
export function createApiKeyListHandler(client: GraphQLExecutor) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ApiKeyListDocument);
      const detailed = { keys: data.apiKeys };
      return formatResponse(input.response_format, summarize(data.apiKeys), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list API keys: ${message}`);
    }
  };
}

/**
 * Registers the read-only `apikey_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerApiKeyList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List API Keys",
      description:
        "Read-only. Lists the Unraid API keys configured on the server: name, id, roles, permissions, and creation date. Key VALUES are never selected or returned. Requires an API key with permission to read API keys (typically ADMIN).",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createApiKeyListHandler(client),
  );
}
