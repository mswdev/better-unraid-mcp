import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";
import { USER_SCRIPTS_DIR } from "./user-script-list.js";

const TOOL_NAME = "user_script_run";

const MS_PER_SECOND = 1_000;
const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 300;

/** Script folder names: no path separators, ever. */
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9 ._-]+$/;

/** "." and ".." pass the character class but escape the scripts directory. */
const DOT_ONLY_PATTERN = /^\.+$/;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  name: z.string().min(1),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_SECONDS)
    .default(DEFAULT_TIMEOUT_SECONDS),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface UserScriptRunArgs {
  response_format: ResponseFormat;
  name: string;
  timeout_seconds: number;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * The flash drive is mounted non-executable (fmask=177 since Unraid 6.8), so
 * this replicates the plugin's own runner: copy to a tmp file, strip CR
 * characters, run via bash, clean up, and preserve the script's exit code.
 */
function buildRunner(name: string): string {
  const scriptPath = quoteForShell(`${USER_SCRIPTS_DIR}/${name}/script`);
  return [
    `S=${scriptPath}`,
    'if [ ! -f "$S" ]; then echo "script not found: $S" >&2; exit 127; fi',
    "T=$(mktemp)",
    `tr -d '\\r' < "$S" > "$T"`,
    'bash "$T"',
    "RC=$?",
    'rm -f "$T"',
    "exit $RC",
  ].join("; ");
}

function summarize(name: string, exitCode: number, stdout: string, stderr: string): string {
  const parts = [`Script "${name}" finished with exit code ${exitCode}.`];
  if (stdout.trim()) {
    parts.push("--- stdout ---", truncateOutput(stdout.trimEnd()));
  }
  if (stderr.trim()) {
    parts.push("--- stderr ---", truncateOutput(stderr.trimEnd()));
  }
  return parts.join("\n");
}

/**
 * Creates the `user_script_run` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that runs one User Script behind the tier-2 gate.
 */
export function createUserScriptRunHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: UserScriptRunArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    if (!SCRIPT_NAME_PATTERN.test(args.name) || DOT_ONLY_PATTERN.test(args.name)) {
      return toolError(`Invalid script name: ${args.name}. No changes were made.`);
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: `Refusing to run user script "${args.name}": user scripts are arbitrary code running as root on your server. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const result = await shell.execute(
        buildRunner(args.name),
        args.timeout_seconds * MS_PER_SECOND,
      );
      const detailed = {
        name: args.name,
        exit_code: result.exitCode,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
      };
      const summary = summarize(args.name, result.exitCode, result.stdout, result.stderr);
      return formatResponse(args.response_format, summary, detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to run user script "${args.name}" over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `user_script_run` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerUserScriptRun(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Run a User Script",
      description:
        "⚠ Runs one User Scripts plugin script by name over SSH — user scripts are arbitrary code executing as root, by design. Requires `confirm: true` AND `acknowledge_risk: true`. The flash drive is mounted non-executable, so the script is copied to a temp file (CRs stripped) and run via bash, exactly like the plugin's own runner. Get names from user_script_list; a non-zero exit is reported faithfully, not as a tool error.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    createUserScriptRunHandler(shell, createElicitationChannel(server)),
  );
}
