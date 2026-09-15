import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireShell } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "user_script_list";

const COMMAND_TIMEOUT_MS = 15_000;

/** Where the User Scripts plugin keeps its scripts, one directory per script. */
export const USER_SCRIPTS_DIR = "/boot/config/plugins/user.scripts/scripts";

const LIST_COMMAND = `ls -1 ${USER_SCRIPTS_DIR} 2>/dev/null`;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `user_script_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler listing User Scripts plugin scripts.
 */
export function createUserScriptListHandler(shell: ShellExecutor | null) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    const unavailable = requireShell(shell);
    if (unavailable || !shell) {
      return unavailable ?? toolError("SSH is not configured.");
    }
    try {
      const result = await shell.execute(LIST_COMMAND, COMMAND_TIMEOUT_MS);
      const names = result.stdout.split("\n").filter((line) => line.trim().length > 0);
      if (result.exitCode !== 0 || names.length === 0) {
        return toolError(
          "No User Scripts found: the User Scripts plugin is not installed (or has no scripts). Install it from Community Applications to use user_script_run.",
        );
      }
      const summary = [`${names.length} user script(s):`, ...names.map((name) => `- ${name}`)].join(
        "\n",
      );
      return formatResponse(input.response_format, summary, { scripts: names });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list user scripts over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `user_script_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerUserScriptList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List User Scripts",
      description:
        "Read-only. Lists the scripts managed by the User Scripts plugin (from /boot/config/plugins/user.scripts/scripts) over SSH. Reports clearly when the plugin is not installed.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createUserScriptListHandler(shell),
  );
}
