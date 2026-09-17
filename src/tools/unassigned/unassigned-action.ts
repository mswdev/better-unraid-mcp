import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import {
  DISKS_INI,
  MOUNT_TIMEOUT_MS,
  PARTITION_PATTERN,
  PROBE_TIMEOUT_MS,
  UD_SCRIPT,
  parentDiskOf,
  parseAssignedDevices,
} from "./_shared.js";

const TOOL_NAME = "unassigned_action";

type MountAction = "mount" | "unmount";

/** rc.unassigned spells unmount without the n. */
const UD_VERBS: Record<MountAction, string> = { mount: "mount", unmount: "umount" };

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["mount", "unmount"]),
  device: z.string().min(1),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
});

/** The validated handler input. */
export interface UnassignedActionArgs {
  response_format?: ResponseFormat;
  action: MountAction;
  device: string;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

function refusalMessage(args: UnassignedActionArgs): string {
  const consequence =
    args.action === "mount"
      ? "mounts the partition under /mnt/disks via the Unassigned Devices plugin (which may run its device scripts and share it over SMB per its settings)"
      : "unmounts the partition — anything still writing to it (containers, copies) will fail";
  return `Refusing to ${args.action} ${args.device}: this ${consequence}. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/** Reads the mountpoint lsblk reports for the partition after the action. */
async function readMountpoint(shell: ShellExecutor, device: string): Promise<string | null> {
  const result = await shell.execute(
    `lsblk -J -o KNAME,MOUNTPOINT ${quoteForShell(device)}`,
    PROBE_TIMEOUT_MS,
  );
  try {
    const parsed = JSON.parse(result.stdout) as {
      blockdevices?: Array<{ mountpoint?: string | null }>;
    };
    return parsed.blockdevices?.[0]?.mountpoint ?? null;
  } catch {
    return null;
  }
}

/** Substrate checks: plugin present, partition not part of the array/pools/flash. */
async function precondition(shell: ShellExecutor, device: string): Promise<CallToolResult | null> {
  const plugin = await shell.execute(`test -x ${quoteForShell(UD_SCRIPT)}`, PROBE_TIMEOUT_MS);
  if (plugin.exitCode !== 0) {
    return toolError(
      "The Unassigned Devices plugin is not installed (no /usr/local/sbin/rc.unassigned). Install it from Community Applications; a raw mount is deliberately not offered because UD owns mount-point naming, SMB sharing, and cleanup. No changes were made.",
    );
  }
  const disksIni = await shell.execute(`cat ${quoteForShell(DISKS_INI)}`, PROBE_TIMEOUT_MS);
  if (parseAssignedDevices(disksIni.stdout).has(parentDiskOf(device))) {
    return toolError(
      `${device} belongs to an assigned disk (array, pool, or flash) — it is not an unassigned device. No changes were made.`,
    );
  }
  return null;
}

function renderOutcome(args: UnassignedActionArgs, mountpoint: string | null): CallToolResult {
  const verified = args.action === "mount" ? mountpoint !== null : mountpoint === null;
  const payload = { action: args.action, device: args.device, mountpoint, verified };
  if (!verified) {
    const state = mountpoint ? `still mounted at ${mountpoint}` : "not mounted";
    return toolError(
      `rc.unassigned ${UD_VERBS[args.action]} ${args.device} ran, but lsblk shows the partition ${state}. Check the Unassigned Devices log in the web UI (Main → Unassigned Devices).`,
    );
  }
  const summary =
    args.action === "mount"
      ? `${args.device} mounted at ${mountpoint} (verified with lsblk).`
      : `${args.device} unmounted (verified with lsblk).`;
  return formatResponse(args.response_format ?? "concise", summary, payload);
}

async function runAction(
  shell: ShellExecutor,
  args: UnassignedActionArgs,
): Promise<CallToolResult> {
  const failure = await precondition(shell, args.device);
  if (failure) {
    return failure;
  }
  const command = `${quoteForShell(UD_SCRIPT)} ${UD_VERBS[args.action]} ${quoteForShell(args.device)}`;
  const result = await shell.execute(command, MOUNT_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return toolError(
      `rc.unassigned ${UD_VERBS[args.action]} failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return renderOutcome(args, await readMountpoint(shell, args.device));
}

/**
 * Creates the `unassigned_action` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that mounts/unmounts an unassigned partition through UD.
 */
export function createUnassignedActionHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: UnassignedActionArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    if (!PARTITION_PATTERN.test(args.device)) {
      return toolError(
        `"${args.device}" is not a partition path (expected /dev/sdX1 or /dev/nvmeXnYpZ — see unassigned_list). No changes were made.`,
      );
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return await runAction(shell, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.action} ${args.device} over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `unassigned_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerUnassignedAction(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Mount / Unmount an Unassigned Partition",
      description:
        "⚠ Mounts or unmounts an unassigned partition (e.g. /dev/sdz1 from unassigned_list) through the Unassigned Devices plugin's `rc.unassigned mount|umount` over SSH, then verifies the mount point with lsblk. Refuses partitions of array/pool/flash disks, and refuses entirely when the plugin is not installed (no raw mount fallback). Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createUnassignedActionHandler(shell, createElicitationChannel(server)),
  );
}
