import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor, ShellResult } from "../../shell/executor.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { requireShell } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";

const TOOL_NAME = "shell_exec";
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MS_PER_SECOND = 1000;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  command: z.string().min(1),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_SECONDS)
    .default(DEFAULT_TIMEOUT_SECONDS),
  confirm: z.boolean().optional(),
};

/** The validated handler input (timeout always present via the zod default). */
interface ShellExecInput {
  response_format: ResponseFormat;
  command: string;
  timeout_seconds: number;
  confirm?: boolean;
}

/** Renders exit code plus whichever output streams are non-empty. */
function summarize(result: ShellResult): string {
  const parts = [`Exit code ${result.exitCode}.`];
  if (result.stdout.trim()) {
    parts.push("--- stdout ---", truncateOutput(result.stdout.trimEnd()));
  }
  if (result.stderr.trim()) {
    parts.push("--- stderr ---", truncateOutput(result.stderr.trimEnd()));
  }
  if (!result.stdout.trim() && !result.stderr.trim()) {
    parts.push("(no output)");
  }
  return parts.join("\n");
}

/**
 * Creates the `shell_exec` handler bound to a shell executor. A non-zero exit
 * code is reported faithfully as a normal result (diagnostic commands like
 * grep use non-zero exits meaningfully); only transport failures error.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler that runs one confirmed command on the host.
 * @example
 * const handler = createShellExecHandler(shell);
 * await handler({ response_format: "concise", command: "dmesg | tail -n 50", timeout_seconds: 30, confirm: true });
 */
export function createShellExecHandler(shell: ShellExecutor | null) {
  return async (input: ShellExecInput): Promise<CallToolResult> => {
    const unavailable = requireShell(shell);
    if (unavailable || !shell) {
      return unavailable ?? toolError("SSH is not configured.");
    }
    const refusal = requireConfirmation(
      input.confirm,
      `run a shell command on the Unraid host as the SSH user: ${input.command}`,
    );
    if (refusal) {
      return refusal;
    }
    try {
      const result = await shell.execute(input.command, input.timeout_seconds * MS_PER_SECOND);
      return formatResponse(input.response_format, summarize(result), {
        command: input.command,
        exit_code: result.exitCode,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to run command over SSH: ${message}`);
    }
  };
}

/**
 * Registers the confirm-gated `shell_exec` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerShellExec(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Run Shell Command",
      description:
        "⚠ Runs an arbitrary shell command on the Unraid host over SSH as the SSH user (typically root, i.e. full control of the server). Requires `confirm: true` on every call; without it the tool refuses and nothing runs. Use file_read for plain file reads (it is ungated). Non-zero exit codes are reported as results, not errors. `timeout_seconds` defaults to 30 (max 120). Requires SSH to be configured (UNRAID_SSH_* environment variables).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    createShellExecHandler(shell),
  );
}
