import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginRemoveDocument } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { formatResponse, toolError } from "../_shared/respond.js";
import {
  type PluginNamesInput,
  firstInvalidName,
  invalidNameError,
  pluginNamesSchema,
  restartReport,
} from "./_shared.js";

const TOOL_NAME = "plugin_remove";
/** Bundled plugins are a config-only path; this tool only does real uninstalls. */
const BUNDLED = false;
/** Apply immediately: the resolver restarts the API to unload the plugin(s). */
const RESTART = true;

/**
 * Creates the `plugin_remove` handler bound to a GraphQL executor. Validates each
 * name against the registry-name allowlist, then gates on `confirm`, then uninstalls.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @returns An MCP handler that uninstalls api (npm) plugins behind the confirm gate.
 * @example
 * const handler = createPluginRemoveHandler(client);
 * await handler({ response_format: "concise", names: ["unraid-api-plugin-x"], confirm: true });
 */
export function createPluginRemoveHandler(client: GraphQLExecutor) {
  return async (input: PluginNamesInput): Promise<CallToolResult> => {
    const invalid = firstInvalidName(input.names);
    if (invalid !== null) {
      return toolError(invalidNameError("remove", invalid));
    }
    const refusal = requireConfirmation(
      input.confirm,
      `remove plugin(s) ${input.names.join(", ")}`,
    );
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(PluginRemoveDocument, {
        input: { names: input.names, bundled: BUNDLED, restart: RESTART },
      });
      const summary = restartReport("remove", input.names, data.removePlugin);
      return formatResponse(input.response_format, summary, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to remove plugin(s) ${input.names.join(", ")}: ${message}`);
    }
  };
}

/**
 * Registers the confirm-gated `plugin_remove` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginRemove(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Remove API Plugins",
      description:
        "⚠ Uninstalls one or more Unraid API plugins by npm package name (`names`, as shown by plugin_list) and RESTARTS the Unraid API to unload them — your connection will drop briefly. Only plugins currently in the API config are affected (unknown names are a no-op). `names` must be bare or scoped package names. Requires `confirm: true` and a key with CONFIG write permission (DELETE_ANY). Reports submission; verify with plugin_list after the API reconnects.",
      inputSchema: pluginNamesSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createPluginRemoveHandler(client),
  );
}
