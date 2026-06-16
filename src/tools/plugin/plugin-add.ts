import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginAddDocument } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { formatResponse, toolError } from "../_shared/respond.js";
import {
  type PluginNamesInput,
  buildInvalidNameError,
  buildRestartReport,
  firstInvalidName,
  pluginNamesSchema,
} from "./_shared.js";

const TOOL_NAME = "plugin_add";
/** Bundled plugins are a build-time/config-only path; this tool only does real installs. */
const BUNDLED = false;
/** Apply immediately: the resolver restarts the API to load the new plugin(s). */
const RESTART = true;

/**
 * Creates the `plugin_add` handler bound to a GraphQL executor. Validates each name
 * against the registry-name allowlist, then gates on `confirm`, then installs.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @returns An MCP handler that installs api (npm) plugins behind the confirm gate.
 * @example
 * const handler = createPluginAddHandler(client);
 * await handler({ response_format: "concise", names: ["unraid-api-plugin-x"], confirm: true });
 */
export function createPluginAddHandler(client: GraphQLExecutor) {
  return async (input: PluginNamesInput): Promise<CallToolResult> => {
    const invalid = firstInvalidName(input.names);
    if (invalid !== null) {
      return toolError(buildInvalidNameError("add", invalid));
    }
    const refusal = requireConfirmation(input.confirm, `add plugin(s) ${input.names.join(", ")}`);
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(PluginAddDocument, {
        input: { names: input.names, bundled: BUNDLED, restart: RESTART },
      });
      const summary = buildRestartReport("add", input.names, data.addPlugin);
      return formatResponse(input.response_format, summary, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to add plugin(s) ${input.names.join(", ")}: ${message}`);
    }
  };
}

/**
 * Registers the confirm-gated `plugin_add` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginAdd(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Add API Plugins",
      description:
        "⚠ Installs one or more Unraid API plugins by npm package name (`names`). This runs `npm install`, which executes the package's lifecycle scripts on the server (supply-chain / code-execution risk), then RESTARTS the Unraid API to load them — your connection will drop briefly. `names` must be bare or scoped package names (no URLs, git refs, paths, or version suffixes). Requires `confirm: true` and a key with CONFIG write permission (UPDATE_ANY). Reports submission; verify with plugin_list after the API reconnects.",
      inputSchema: pluginNamesSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    createPluginAddHandler(client),
  );
}
