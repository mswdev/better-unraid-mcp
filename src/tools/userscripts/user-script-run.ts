import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor, ShellResult } from "../../shell/executor.js";
import { confirmSchema, requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { createElicitationChannel, type ElicitationChannel } from "../_shared/elicitation.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import {
  formatResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";
import { fitTailsToOutputCap, truncateStreams } from "../_shared/truncate-output.js";
import { USER_SCRIPTS_DIR } from "./user-script-list.js";

const TOOL_NAME = "user_script_run";

const MS_PER_SECOND = 1_000;
const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 300;

/** Script folder names: no path separators, ever. */
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9 ._-]+$/;

/** "." and ".." pass the character class but escape the scripts directory. */
const DOT_ONLY_PATTERN = /^\.+$/;

const inputSchema = z.object({
  response_format: responseFormatSchema,
  name: z
    .string()
    .min(1)
    .describe("Script name exactly as returned by user_script_list (its folder name)."),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_SECONDS)
    .default(DEFAULT_TIMEOUT_SECONDS)
    .describe(
      "Seconds to wait for the script; on timeout the call fails but the script may keep running on the host.",
    ),
  confirm: confirmSchema,
  acknowledge_risk: z
    .boolean()
    .optional()
    .describe(
      "Set `true` only after the user accepts running arbitrary code as the SSH user; needed on every call.",
    ),
});

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

/** Renders the exit code plus whichever output streams are non-empty, sharing one output cap. */
function summarize(name: string, result: ShellResult): string {
  const parts = [`Script "${name}" finished with exit code ${result.exitCode}.`];
  const { stdout, stderr } = truncateStreams(result.stdout, result.stderr);
  if (stdout.trim()) {
    parts.push("--- stdout ---", stdout);
  }
  if (stderr.trim()) {
    parts.push("--- stderr ---", stderr);
  }
  return parts.join("\n");
}

/**
 * The gate's blast-radius copy. It names the configured SSH user when the
 * registry passed one (scripts run as whoever SSH logs in as, not always
 * root), and falls back to the neutral "the SSH user" otherwise.
 */
function refusalMessage(name: string, sshUser: string | undefined): string {
  const runsAs = sshUser ? `the SSH user "${sshUser}"` : "the SSH user";
  return `Refusing to run user script "${name}": user scripts are arbitrary code, and this one would run as ${runsAs} on your server. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/** Runs the script and renders its result; both modes keep the newest output. */
async function runScript(shell: ShellExecutor, args: UserScriptRunArgs): Promise<CallToolResult> {
  const result = await shell.execute(buildRunner(args.name), args.timeout_seconds * MS_PER_SECOND);
  const detailed = fitTailsToOutputCap({
    fixed: { name: args.name, exit_code: result.exitCode },
    tails: { stdout: result.stdout, stderr: result.stderr },
  });
  const summary = summarize(args.name, result);
  return formatResponse(args.response_format, summary, detailed);
}

/**
 * Creates the `user_script_run` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @param sshUser - The configured SSH login (UNRAID_SSH_USER), named in the
 *   refusal; when omitted the refusal says "the SSH user".
 * @returns An MCP handler that runs one User Script behind the tier-2 gate.
 */
export function createUserScriptRunHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
  sshUser?: string,
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
      refusalMessage: refusalMessage(args.name, sshUser),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return await runScript(shell, args);
    } catch (error) {
      const message = errorMessage(error);
      return toolError(`Failed to run user script "${args.name}" over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `user_script_run` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @param sshUser - The configured SSH login, named in the confirmation refusal.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerUserScriptRun(
  server: McpServer,
  shell: ShellExecutor | null,
  sshUser?: string,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Run a User Script",
      description:
        "⚠ Runs one User Scripts plugin script by name over SSH — user scripts are arbitrary code, executed here as the SSH user (typically root). Requires `confirm: true` AND `acknowledge_risk: true`. The flash drive is mounted non-executable, so the script is copied to a temp file (CRs stripped) and run via bash, exactly like the plugin's own runner. Get names from user_script_list; a non-zero exit is reported faithfully, not as a tool error. Waits for the script to finish and returns its exit code, stdout, and stderr. For a one-off command that is not a saved script use shell_exec instead.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    createUserScriptRunHandler(shell, createElicitationChannel(server), sshUser),
  );
}
