import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ShellExecutor } from "../../shell/executor.js";
import { toolError } from "./respond.js";

/**
 * Gate for SSH-backed tools. Returns `null` when an executor is configured;
 * otherwise returns the error result explaining how to enable the domain.
 *
 * @param shell - The configured executor, or `null` when SSH is not set up.
 * @returns `null` to proceed, or an error `CallToolResult` to return as-is.
 */
export function requireShell(shell: ShellExecutor | null): CallToolResult | null {
  if (shell) {
    return null;
  }
  return toolError(
    "SSH is not configured, so host-level tools are unavailable. Set UNRAID_SSH_HOST plus UNRAID_SSH_PASSWORD or UNRAID_SSH_KEY_PATH (and optionally UNRAID_SSH_PORT, UNRAID_SSH_USER) in the MCP server's environment, then restart it.",
  );
}
