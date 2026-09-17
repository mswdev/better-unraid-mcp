import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginInstallPlgDocument } from "../../types/unraid/graphql.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { toolError, toolText } from "../_shared/respond.js";

const TOOL_NAME = "plugin_install_plg";

/** Native Unraid plugin files end in .plg; anything else is a wrong URL. */
const PLG_SUFFIX = ".plg";

const inputSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).optional(),
  forced: z.boolean().optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
});

/** The validated handler arguments. */
interface PluginInstallPlgArgs {
  url: string;
  name?: string;
  forced?: boolean;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** Blast-radius refusal copy: a .plg runs arbitrary code as root. */
function refusalMessage(url: string): string {
  return `Refusing to install the Unraid plugin at ${url}: a .plg installer runs arbitrary code as root on your server — only install plugins from sources you trust. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/**
 * Creates the `plugin_install_plg` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the install mutation.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that installs a native Unraid `.plg` plugin.
 */
export function createPluginInstallPlgHandler(
  client: GraphQLExecutor,
  channel?: ElicitationChannel | null,
) {
  return async (args: PluginInstallPlgArgs): Promise<CallToolResult> => {
    if (!args.url.endsWith(PLG_SUFFIX)) {
      return toolError(
        `Not a .plg URL: ${args.url}. Native Unraid plugins are installed from a .plg file URL (for API plugins use plugin_add). No changes were made.`,
      );
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args.url),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const input = { url: args.url, name: args.name, forced: args.forced };
      const data = await client.execute(PluginInstallPlgDocument, { input });
      const operation = data.unraidPlugins.installPlugin;
      return toolText(
        `Plugin install ${operation.status} (operation ${operation.id}) for ${operation.name ?? operation.url}. Installation continues on the server — check plugin_list and the syslog (log_read) for completion.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to install plugin from ${args.url}: ${message}`);
    }
  };
}

/**
 * Registers the destructive `plugin_install_plg` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginInstallPlg(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Install Native Unraid Plugin (.plg)",
      description:
        "⚠ Installs a native Unraid OS plugin from a .plg URL (the Community Applications format) via the Unraid API. A .plg installer runs arbitrary code as root — only install from trusted sources. Requires `confirm: true` AND `acknowledge_risk: true`. Returns a queued/running operation; verify with plugin_list and the syslog. For npm-based API plugins use plugin_add instead.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    createPluginInstallPlgHandler(client, createElicitationChannel(server)),
  );
}
