import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { toolError } from "../_shared/respond.js";
import { validateShareName } from "./_shared.js";
import { type ShareWriteArgs, settingsOf, shareSettingsSchema } from "./share-create.js";
import { applyAndVerify, checkAgainstHost, readHostContext, readShareCfg } from "./write-flow.js";

const TOOL_NAME = "share_edit";

const inputSchema = z.object({ name: z.string().min(1), ...shareSettingsSchema });

function hasChanges(args: ShareWriteArgs): boolean {
  return Object.values(settingsOf(args)).some((value) => value !== undefined);
}

async function runEdit(shell: ShellExecutor, args: ShareWriteArgs): Promise<CallToolResult> {
  const current = await readShareCfg(shell, args.name);
  if (current === null) {
    return toolError(
      `Share "${args.name}" has no config under /boot/config/shares — use share_create for a new share. No changes were made.`,
    );
  }
  const changes = settingsOf(args);
  const hostFailure = checkAgainstHost(args.name, changes, await readHostContext(shell));
  if (hostFailure) {
    return hostFailure;
  }
  return applyAndVerify(shell, {
    name: args.name,
    nameOrig: args.name,
    current,
    changes,
    command: "Apply",
  });
}

/**
 * Creates the `share_edit` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that edits a user share's settings through emhttpd.
 */
export function createShareEditHandler(
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
    if (!hasChanges(args)) {
      return toolError(
        "Refusing to edit: nothing to change — pass at least one of comment, allocator, useCache, cachePool, smbExport, smbSecurity. No changes were made.",
      );
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: `Refusing to edit share "${args.name}": changing allocation, cache mode, or SMB export/security affects where new files land and who can reach them. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return await runEdit(shell, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to edit share over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `share_edit` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerShareEdit(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Edit User Share",
      description:
        "⚠ Changes a user share's settings through emhttpd (the web UI's own form, via emcmd over SSH) and verifies by re-reading /boot/config/shares/<name>.cfg. Editable subset: comment, allocator (highwater|fillup|mostfree), useCache (no|yes|only|prefer), cachePool (must exist), smbExport (-|e|eh), smbSecurity (public|secure|private); every other setting is passed through unchanged. Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createShareEditHandler(shell, createElicitationChannel(server)),
  );
}
