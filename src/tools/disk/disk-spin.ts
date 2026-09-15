import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireConfirmationInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { toolError, toolText } from "../_shared/respond.js";

const TOOL_NAME = "disk_spin";

const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Array/pool disks spin through emhttpd, keeping its tracked spin state (and
 * the web UI) consistent; calling sdspin directly on them leaves stale state.
 */
const EMCMD_BINARY = "/usr/local/sbin/emcmd";

/** For unassigned devices only; an hdparm wrapper — ATA drives only. */
const SDSPIN_BINARY = "/usr/local/sbin/sdspin";

/** Array slot names emhttpd understands. */
const DISK_NAME_PATTERN = /^(disk[0-9]+|parity[0-9]?|cache[0-9]*)$/;

/** Only spinning-rust block devices; NVMe does not spin. */
const DEVICE_PATTERN = /^\/dev\/sd[a-z]+$/;

type SpinAction = "up" | "down";

const inputSchema = {
  action: z.enum(["up", "down"]),
  disk: z.string().optional(),
  device: z.string().optional(),
  confirm: z.boolean().optional(),
};

/** The validated handler arguments. */
interface DiskSpinArgs {
  action: SpinAction;
  disk?: string;
  device?: string;
  confirm?: boolean;
}

/** Exactly one target, matching its pattern; returns an error message or null. */
function validateTarget(args: DiskSpinArgs): string | null {
  if ((args.disk === undefined) === (args.device === undefined)) {
    return "Pass exactly one of `disk` (array slot like disk1/parity/cache) or `device` (/dev/sdX for unassigned devices).";
  }
  if (args.disk !== undefined && !DISK_NAME_PATTERN.test(args.disk)) {
    return `Invalid array disk name: ${args.disk} (expected disk1, parity, cache, ...).`;
  }
  if (args.device !== undefined && !DEVICE_PATTERN.test(args.device)) {
    return `Invalid device: ${args.device} (expected /dev/sdX; NVMe devices do not spin).`;
  }
  return null;
}

/** emcmd for array slots (state-consistent), sdspin for unassigned devices. */
function buildCommand(args: DiskSpinArgs): string {
  if (args.disk !== undefined) {
    const verb = args.action === "up" ? "cmdSpinup" : "cmdSpindown";
    return `${EMCMD_BINARY} ${verb}=${args.disk}`;
  }
  return `${SDSPIN_BINARY} ${args.device} ${args.action}`;
}

/**
 * Creates the `disk_spin` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler spinning disks up or down.
 */
export function createDiskSpinHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: DiskSpinArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    const invalid = validateTarget(args);
    if (invalid) {
      return toolError(`${invalid} No changes were made.`);
    }
    const target = args.disk ?? args.device ?? "";
    const refusal = await requireConfirmationInteractive({
      confirm: args.confirm,
      actionDescription: `spin ${args.action} ${target}`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      const result = await shell.execute(buildCommand(args), COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || "(no output)";
        return toolError(`disk_spin ${args.action} failed (exit ${result.exitCode}): ${detail}`);
      }
      return toolText(`Spin ${args.action} requested for ${target}. Verify with disk_list.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to spin ${args.action} ${target} over SSH: ${message}`);
    }
  };
}

/**
 * Registers the `disk_spin` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerDiskSpin(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Spin Disk Up/Down",
      description:
        "Spins a disk up or down over SSH. Array/pool slots (`disk`: disk1, parity, cache, ...) go through emhttpd (`emcmd`) so Unraid's tracked spin state stays consistent; unassigned devices (`device`: /dev/sdX) use `sdspin` (an hdparm wrapper — ATA only, SAS needs the community plugin). Requires `confirm: true`. Spinning down interrupts nothing but adds spin-up latency on next access.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createDiskSpinHandler(shell, createElicitationChannel(server)),
  );
}
