import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { requireShell } from "../_shared/require-shell.js";
import { toolError, toolText } from "../_shared/respond.js";

const TOOL_NAME = "system_power";

type PowerAction = "reboot" | "shutdown";

/**
 * Standard power commands. Unraid's modified rc.6 performs the clean array
 * stop on the way down; /usr/local/sbin/powerdown is a deprecated shim and
 * must not be used.
 */
const POWER_COMMANDS: Record<PowerAction, string> = {
  reboot: "/sbin/reboot",
  shutdown: "/sbin/poweroff",
};

/** The command returns quickly; the clean stop continues after it. */
const COMMAND_TIMEOUT_MS = 15_000;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["reboot", "shutdown"]),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface SystemPowerArgs {
  response_format: "concise" | "detailed";
  action: PowerAction;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** Refusal copy naming the blast radius and both required flags. */
function refusalMessage(action: PowerAction): string {
  const consequence =
    action === "shutdown"
      ? "power the server off until it is turned back on physically (or via wake-on-LAN)"
      : "take the server down for the duration of the reboot";
  return `Refusing to ${action} the server: this will ${consequence} — every share, container, and VM goes offline. Unraid performs a clean array stop on the way down. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/**
 * Maps a thrown SSH error: a failure to CONNECT is a real error (nothing was
 * issued); anything after that (timeout, dropped channel) is the expected
 * consequence of the server going down mid-session.
 */
function mapPowerError(action: PowerAction, message: string): CallToolResult {
  if (message.includes("connect")) {
    return toolError(`Failed to ${action}: could not reach the server over SSH: ${message}`);
  }
  return toolText(
    `The ${action} command was issued, then the SSH connection dropped — expected while the server goes down. Verify with connection_doctor once the server should be back.`,
  );
}

/**
 * Creates the `system_power` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler that reboots or shuts down the host behind the
 *   two-flag gate.
 */
export function createSystemPowerHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: SystemPowerArgs): Promise<CallToolResult> => {
    const unavailable = requireShell(shell);
    if (unavailable || !shell) {
      return unavailable ?? toolError("SSH is not configured.");
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args.action),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const result = await shell.execute(POWER_COMMANDS[args.action], COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || "(no error output)";
        return toolError(`${args.action} failed (exit ${result.exitCode}): ${detail}`);
      }
      return toolText(
        `${args.action === "reboot" ? "Reboot" : "Shutdown"} initiated — the server is going down now and this connection will drop. Unraid stops the array cleanly on the way down.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return mapPowerError(args.action, message);
    }
  };
}

/**
 * Registers the destructive `system_power` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerSystemPower(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Reboot or Shut Down the Server",
      description:
        "⚠ Reboots (`/sbin/reboot`) or shuts down (`/sbin/poweroff`) the entire Unraid server over SSH. Unraid performs a clean array stop on the way down. Every share, Docker container, and VM goes offline; shutdown requires physical/WoL access to power back on. Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH (UNRAID_SSH_* variables). The SSH connection dropping after the command is expected.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createSystemPowerHandler(shell, createElicitationChannel(server)),
  );
}
