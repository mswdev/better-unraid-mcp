import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginListDocument, type PluginListQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "plugin_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Validated handler input. */
interface PluginListInput {
  response_format: ResponseFormat;
}

type ApiPlugin = PluginListQuery["plugins"][number];

/** Summarizes the api-plugin section; `[]` is reported as ambiguous, never a flat zero. */
function summarizeApi(plugins: ApiPlugin[]): string {
  if (plugins.length === 0) {
    return "0 api plugins reported (may also indicate safe mode or a load failure)";
  }
  return `${plugins.length} api plugin(s): ${plugins.map((plugin) => plugin.name).join(", ")}`;
}

/** Summarizes the OS `.plg` section; `[]` is reported as ambiguous, never a flat zero. */
function summarizeOsPlugins(filenames: string[]): string {
  if (filenames.length === 0) {
    return "0 OS .plg reported (may also indicate an unreadable plugin directory)";
  }
  return `${filenames.length} OS .plg: ${filenames.join(", ")}`;
}

/** Builds the concise two-section summary. */
function summarize(data: PluginListQuery): string {
  return `${summarizeApi(data.plugins)}. ${summarizeOsPlugins(data.installedUnraidPlugins)}.`;
}

/**
 * Creates the `plugin_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read plugin inventory.
 * @returns An MCP handler returning installed api plugins and OS `.plg` filenames.
 * @example
 * const handler = createPluginListHandler(client);
 * await handler({ response_format: "concise" });
 */
export function createPluginListHandler(client: GraphQLExecutor) {
  return async (input: PluginListInput): Promise<CallToolResult> => {
    try {
      const data = await client.execute(PluginListDocument);
      return formatResponse(input.response_format, summarize(data), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list plugins: ${message}`);
    }
  };
}

/**
 * Registers the read-only `plugin_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Plugins",
      description:
        "Read-only. Lists installed plugins. `plugins` are the API's active/loaded set (config-declared, installed, and schema-valid) captured as a boot snapshot that changes only after an API restart; `installedUnraidPlugins` are the live OS `.plg` filenames. An empty list is NOT a definitive zero — it can also mean safe mode (api plugins) or an unreadable plugin directory (OS `.plg`). Requires CONFIG read permission (any viewer-level key).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createPluginListHandler(client),
  );
}
