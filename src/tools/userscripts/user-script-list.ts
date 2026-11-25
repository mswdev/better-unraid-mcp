import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor, ShellResult } from "../../shell/executor.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import {
  formatResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";

const TOOL_NAME = "user_script_list";

const COMMAND_TIMEOUT_MS = 15_000;

/** Where the User Scripts plugin keeps its scripts, one directory per script. */
export const USER_SCRIPTS_DIR = "/boot/config/plugins/user.scripts/scripts";

/**
 * The plugin's install record on the flash. Unraid deletes it when the plugin
 * is removed, but the scripts directory survives, so this file (not the
 * directory) is what says the plugin is installed.
 */
export const USER_SCRIPTS_PLG = "/boot/config/plugins/user.scripts.plg";

/**
 * Exit code the list command uses to say the plugin's .plg is absent. GNU ls
 * only exits 0, 1 or 2, so this can never be mistaken for an ls failure.
 */
export const PLUGIN_MISSING_EXIT = 3;

/**
 * One round trip: list the scripts directory when it exists (an `ls` failure
 * there exits with ls's own code), then report through the exit code whether
 * the plugin is installed: 0 when its .plg exists, PLUGIN_MISSING_EXIT when not.
 */
const LIST_COMMAND = [
  `if [ -d ${quoteForShell(USER_SCRIPTS_DIR)} ]; then ls -1 -- ${quoteForShell(USER_SCRIPTS_DIR)} || exit $?; fi`,
  `[ -f ${quoteForShell(USER_SCRIPTS_PLG)} ] || exit ${PLUGIN_MISSING_EXIT}`,
].join("; ");

const NOT_INSTALLED_MESSAGE = `The User Scripts plugin is not installed (no ${USER_SCRIPTS_PLG}). Install it from Community Applications to use user_script_run.`;

const NO_SCRIPTS_MESSAGE =
  "The User Scripts plugin is installed but has no scripts yet. Add one in the web UI (Settings → User Scripts), then list again.";

const inputSchema = z.object({
  response_format: responseFormatSchema,
});

/** What one run of the list command found. */
export type ScriptListing =
  | { kind: "scripts"; names: string[] }
  | { kind: "no-scripts" }
  | { kind: "not-installed" }
  | { kind: "failed"; exitCode: number; detail: string };

/**
 * Interprets the list command's result. Scripts that exist are listed even
 * when the plugin has since been removed, because user_script_run runs them
 * without the plugin. Exported for tests.
 *
 * @param result - The list command's output and exit code.
 * @returns Scripts found, installed with none, not installed, or a failed listing.
 */
export function classifyListing(result: ShellResult): ScriptListing {
  const isListed = result.exitCode === 0 || result.exitCode === PLUGIN_MISSING_EXIT;
  if (!isListed) {
    const detail = result.stderr.trim() || "(no error output)";
    return { kind: "failed", exitCode: result.exitCode, detail };
  }
  const names = result.stdout.split("\n").filter((line) => line.trim().length > 0);
  if (names.length > 0) {
    return { kind: "scripts", names };
  }
  return result.exitCode === 0 ? { kind: "no-scripts" } : { kind: "not-installed" };
}

/** Renders a listing. "Installed, no scripts" is an empty result, not an error. */
function renderListing(format: ResponseFormat, listing: ScriptListing): CallToolResult {
  if (listing.kind === "not-installed") {
    return toolError(NOT_INSTALLED_MESSAGE);
  }
  if (listing.kind === "failed") {
    return toolError(
      `Could not list ${USER_SCRIPTS_DIR} (exit ${listing.exitCode}): ${listing.detail}`,
    );
  }
  if (listing.kind === "no-scripts") {
    return formatResponse(format, NO_SCRIPTS_MESSAGE, { scripts: [] });
  }
  const bullets = listing.names.map((name) => `- ${name}`);
  const summary = [`${listing.names.length} user script(s):`, ...bullets].join("\n");
  return formatResponse(format, summary, { scripts: listing.names });
}

/**
 * Creates the `user_script_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler listing User Scripts plugin scripts.
 */
export function createUserScriptListHandler(shell: ShellExecutor | null) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      const result = await shell.execute(LIST_COMMAND, COMMAND_TIMEOUT_MS);
      return renderListing(input.response_format, classifyListing(result));
    } catch (error) {
      const message = errorMessage(error);
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
        "Read-only. Lists the scripts managed by the User Scripts plugin (from /boot/config/plugins/user.scripts/scripts) over SSH. Returns names only: pass one to user_script_run, or review its source first by reading `<name>/script` in that directory with file_read. Reports clearly when the plugin is not installed, and separately (as an empty list, not an error) when it is installed but has no scripts.",
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
