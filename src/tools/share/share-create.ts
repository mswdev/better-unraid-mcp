import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { toolError } from "../_shared/respond.js";
import { type ShareSettings, validateShareName } from "./_shared.js";
import { applyAndVerify, checkAgainstHost, readHostContext, readShareCfg } from "./write-flow.js";

const TOOL_NAME = "share_create";

/** Shared by create and edit: the settings subset plus the gate flags. */
export const shareSettingsSchema = {
  comment: z.string().max(200).optional(),
  allocator: z.enum(["highwater", "fillup", "mostfree"]).optional(),
  useCache: z.enum(["no", "yes", "only", "prefer"]).optional(),
  cachePool: z.string().min(1).optional(),
  smbExport: z.enum(["-", "e", "eh"]).optional(),
  smbSecurity: z.enum(["public", "secure", "private"]).optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

const inputSchema = z.object({ name: z.string().min(1), ...shareSettingsSchema });

/** The validated handler input. */
export interface ShareWriteArgs extends ShareSettings {
  name: string;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** Strips the non-setting fields so only share settings reach the form builders. */
export function settingsOf(args: ShareWriteArgs): ShareSettings {
  const { comment, allocator, useCache, cachePool, smbExport, smbSecurity } = args;
  return { comment, allocator, useCache, cachePool, smbExport, smbSecurity };
}

async function runCreate(shell: ShellExecutor, args: ShareWriteArgs): Promise<CallToolResult> {
  if ((await readShareCfg(shell, args.name)) !== null) {
    return toolError(
      `Share "${args.name}" already exists — use share_edit to change it. No changes were made.`,
    );
  }
  const changes = settingsOf(args);
  const hostFailure = checkAgainstHost(args.name, changes, await readHostContext(shell));
  if (hostFailure) {
    return hostFailure;
  }
  return applyAndVerify(shell, {
    name: args.name,
    nameOrig: "",
    current: {},
    changes,
    command: "Add Share",
  });
}

/**
 * Creates the `share_create` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that creates a user share through emhttpd.
 */
export function createShareCreateHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: ShareWriteArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    const invalidName = validateShareName(args.name);
    if (invalidName) {
      return toolError(`${invalidName} No changes were made.`);
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: `Refusing to create share "${args.name}": this adds a user share (and its directory under /mnt/user) exactly as the web UI would. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return await runCreate(shell, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to create share over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `share_create` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerShareCreate(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Create User Share",
      description:
        "⚠ Creates a user share through emhttpd (the same form the web UI submits, via emcmd over SSH) and verifies it by re-reading /boot/config/shares/<name>.cfg. Optional settings: comment, allocator (highwater|fillup|mostfree), useCache (no|yes|only|prefer — Unraid's primary/secondary storage modes), cachePool (must exist), smbExport (-|e|eh = no|yes|yes-hidden), smbSecurity (public|secure|private). Refuses reserved, disk, and pool names. Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH. The GraphQL API has no share mutations.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createShareCreateHandler(shell, createElicitationChannel(server)),
  );
}
