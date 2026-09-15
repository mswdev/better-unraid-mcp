import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { toolError, toolText } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";

const TOOL_NAME = "disk_smart_report";

const PROBE_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 60_000;

/** SATA or NVMe block devices. */
const DEVICE_PATTERN = /^\/dev\/(sd[a-z]+|nvme[0-9]+n[0-9]+)$/;

const inputSchema = {
  device: z.string().min(1),
};

/**
 * Creates the `disk_smart_report` handler bound to a shell executor.
 * smartctl's exit code is a bitmask carrying informational flags (e.g. bit 6
 * = errors in the log), so any run that produced output is reported
 * faithfully rather than treated as a tool failure.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler returning the full smartctl attribute report.
 */
export function createDiskSmartReportHandler(shell: ShellExecutor | null) {
  return async (input: { device: string }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    if (!DEVICE_PATTERN.test(input.device)) {
      return toolError(`Invalid device: ${input.device} (expected /dev/sdX or /dev/nvmeXnY).`);
    }
    try {
      const probe = await shell.execute("command -v smartctl", PROBE_TIMEOUT_MS);
      if (probe.exitCode !== 0) {
        return toolError("smartctl is not available on this server.");
      }
      const result = await shell.execute(`smartctl -a ${input.device}`, COMMAND_TIMEOUT_MS);
      if (!result.stdout.trim()) {
        return toolError(
          `smartctl produced no output for ${input.device} (exit ${result.exitCode}): ${result.stderr.trim()}`,
        );
      }
      return toolText(truncateOutput(result.stdout.trimEnd()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read SMART report over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `disk_smart_report` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerDiskSmartReport(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Deep SMART Report",
      description:
        "Read-only. Full smartctl attribute report for one disk (`device`: /dev/sdX or /dev/nvmeXnY) over SSH — the deep view behind disk_list's summary SMART status. smartctl's informational exit flags are tolerated; the report is returned whenever produced. Get device paths from disk_list.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createDiskSmartReportHandler(shell),
  );
}
