import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireConfirmationInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "mover_action";

/**
 * The mover script. The action argument is REQUIRED on current Unraid builds
 * (a bare `mover` invocation prints usage and exits 1).
 */
const MOVER_BINARY = "/usr/local/sbin/mover";

/** The script returns promptly (the move itself runs in the background). */
const COMMAND_TIMEOUT_MS = 30_000;

type MoverAction = "start" | "stop";

/** Success copy per action; stop warns about interrupted transfers. */
const SUCCESS_SUMMARY: Record<MoverAction, string> = {
  start:
    "Mover start requested. Progress appears in the syslog (log_read) and mover_status reports whether it is still running.",
  stop: "Mover stop requested. Note: interrupting the mover can leave partial files on the destination; check the syslog for what was in flight.",
};

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["start", "stop"]),
  confirm: z.boolean().optional(),
});

/** The validated handler arguments. */
interface MoverActionArgs {
  response_format: ResponseFormat;
  action: MoverAction;
  confirm?: boolean;
}

/**
 * Creates the `mover_action` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler that starts or stops the mover behind the gate.
 * @example
 * const handler = createMoverActionHandler(shell);
 * await handler({ response_format: "concise", action: "start", confirm: true });
 */
export function createMoverActionHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: MoverActionArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    const refusal = await requireConfirmationInteractive({
      confirm: args.confirm,
      actionDescription: `${args.action} the mover`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const result = await shell.execute(`${MOVER_BINARY} ${args.action}`, COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || "(no output)";
        return toolError(`mover ${args.action} failed (exit ${result.exitCode}): ${detail}`);
      }
      const detailed = { action: args.action, exitCode: result.exitCode, stdout: result.stdout };
      return formatResponse(args.response_format, SUCCESS_SUMMARY[args.action], detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.action} the mover over SSH: ${message}`);
    }
  };
}

/**
 * Registers the `mover_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerMoverAction(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Start or Stop the Mover",
      description:
        "Starts or stops the mover (the process migrating data from the cache pool to the array) via `/usr/local/sbin/mover` over SSH. Requires `confirm: true` and SSH to be configured (UNRAID_SSH_* variables). ⚠ stop interrupts in-flight transfers and can leave partial files on the destination. Check mover_status first; progress appears in the syslog.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createMoverActionHandler(shell, createElicitationChannel(server)),
  );
}
