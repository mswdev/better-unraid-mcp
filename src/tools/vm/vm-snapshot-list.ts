import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "vm_snapshot_list";

const PROBE_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 30_000;

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  vm: z.string().min(1),
});

/**
 * Probes for virsh — absent when the VM service is disabled.
 *
 * @param shell - The connected SSH executor.
 * @returns `null` when virsh exists, or an error result to return as-is.
 */
export async function probeVirsh(shell: ShellExecutor): Promise<CallToolResult | null> {
  const probe = await shell.execute("command -v virsh", PROBE_TIMEOUT_MS);
  if (probe.exitCode !== 0) {
    return toolError(
      "virsh is not available on this server — the VM service appears to be disabled (Settings → VM Manager).",
    );
  }
  return null;
}

/**
 * Creates the `vm_snapshot_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler listing a VM's libvirt snapshots.
 */
export function createVmSnapshotListHandler(shell: ShellExecutor | null) {
  return async (input: {
    response_format: ResponseFormat;
    vm: string;
  }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      const missing = await probeVirsh(shell);
      if (missing) {
        return missing;
      }
      const command = `virsh snapshot-list ${quoteForShell(input.vm)} --name`;
      const result = await shell.execute(command, COMMAND_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        return toolError(
          `virsh snapshot-list failed for ${input.vm} (exit ${result.exitCode}): ${result.stderr.trim()}`,
        );
      }
      const names = result.stdout.split("\n").filter((line) => line.trim().length > 0);
      const summary =
        names.length === 0
          ? `VM ${input.vm} has no snapshots.`
          : [`${names.length} snapshot(s) for ${input.vm}:`, ...names.map((n) => `- ${n}`)].join(
              "\n",
            );
      return formatResponse(input.response_format, summary, { vm: input.vm, snapshots: names });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list VM snapshots over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `vm_snapshot_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerVmSnapshotList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List VM Snapshots",
      description:
        "Read-only. Lists a VM's libvirt snapshots by name via virsh over SSH (snapshots are not exposed by the GraphQL API). Reports clearly when the VM service is disabled.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createVmSnapshotListHandler(shell),
  );
}
