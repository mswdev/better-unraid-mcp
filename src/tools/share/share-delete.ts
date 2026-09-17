import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { toolError, toolText } from "../_shared/respond.js";
import {
  CFG_TIMEOUT_MS,
  SHARES_ROOT,
  buildEditQuery,
  shareCfgPath,
  validateShareName,
} from "./_shared.js";
import { readShareCfg, submitToEmhttpd } from "./write-flow.js";

const TOOL_NAME = "share_delete";

const inputSchema = z.object({
  name: z.string().min(1),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
});

/** The validated handler input. */
export interface ShareDeleteArgs {
  name: string;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** First entry under /mnt/user/<name>, or empty when the share holds no data. */
async function firstEntry(shell: ShellExecutor, name: string): Promise<string> {
  const dir = quoteForShell(`${SHARES_ROOT}/${name}`);
  const result = await shell.execute(
    `find ${dir} -mindepth 1 -print -quit 2>/dev/null`,
    CFG_TIMEOUT_MS,
  );
  return result.stdout.trim();
}

async function runDelete(shell: ShellExecutor, name: string): Promise<CallToolResult> {
  if ((await readShareCfg(shell, name)) === null) {
    return toolError(
      `Share "${name}" has no config under /boot/config/shares. No changes were made.`,
    );
  }
  const entry = await firstEntry(shell, name);
  if (entry) {
    return toolError(
      `Share "${name}" still contains data (e.g. ${entry}). share_delete only removes the share configuration, never files: move or delete the contents of ${SHARES_ROOT}/${name} first (they live on the array/pool disks). No changes were made.`,
    );
  }
  const query = buildEditQuery({
    name,
    nameOrig: name,
    current: {},
    changes: {},
    command: "Delete",
  });
  const failure = await submitToEmhttpd(shell, deleteQueryOnly(query));
  if (failure) {
    return failure;
  }
  if ((await readShareCfg(shell, name)) !== null) {
    return toolError(
      `emhttpd accepted the delete but ${shareCfgPath(name)} still exists — not verified. Check Shares in the web UI.`,
    );
  }
  return toolText(
    `Share "${name}" configuration deleted — verified: ${shareCfgPath(name)} is gone. No files were touched.`,
  );
}

/** The UI's delete submission carries only the name fields and the command. */
function deleteQueryOnly(fullQuery: string): string {
  return fullQuery
    .split("&")
    .filter((pair) => /^(shareName|shareNameOrig|cmdEditShare)=/.test(pair))
    .join("&");
}

/**
 * Creates the `share_delete` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that deletes an EMPTY user share's configuration.
 */
export function createShareDeleteHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: ShareDeleteArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    const invalidName = validateShareName(args.name);
    if (invalidName) {
      return toolError(`${invalidName} No changes were made.`);
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: `Refusing to delete share "${args.name}": this removes the share's configuration (SMB/NFS export, allocation settings). It never deletes files, and refuses while the share holds data. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return await runDelete(shell, args.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to delete share over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `share_delete` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerShareDelete(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Delete User Share (config only)",
      description:
        "⚠ Deletes an EMPTY user share's configuration through emhttpd (the web UI's own delete, via emcmd over SSH) and verifies that /boot/config/shares/<name>.cfg is gone. Never deletes files: if /mnt/user/<name> still contains anything the tool refuses and says where the data lives. Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createShareDeleteHandler(shell, createElicitationChannel(server)),
  );
}
