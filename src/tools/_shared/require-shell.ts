import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolError } from "./respond.js";

/**
 * The refusal every SSH-backed tool returns when SSH is not configured.
 * Handlers guard with `if (!shell) return sshUnavailableError();` — the
 * plain null check narrows the type for the rest of the handler.
 *
 * @returns An error `CallToolResult` explaining how to enable SSH tools.
 */
export function sshUnavailableError(): CallToolResult {
  return toolError(
    "SSH is not configured, so host-level tools are unavailable. Set UNRAID_SSH_HOST plus UNRAID_SSH_PASSWORD or UNRAID_SSH_KEY_PATH (and optionally UNRAID_SSH_PORT, UNRAID_SSH_USER) in the MCP server's environment, then restart it.",
  );
}
