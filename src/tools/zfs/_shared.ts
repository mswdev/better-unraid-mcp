import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ShellExecutor } from "../../shell/executor.js";
import { toolError } from "../_shared/respond.js";

/** Quick availability probes should never hang a tool call. */
export const PROBE_TIMEOUT_MS = 10_000;

/** Deadline for the ZFS CLI reads themselves. */
export const ZFS_COMMAND_TIMEOUT_MS = 30_000;

/** ZFS dataset names: pool/dataset path segments. */
export const DATASET_PATTERN = /^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)*$/;

/** Snapshot short names (the part after @). */
export const SNAPSHOT_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Probes for the ZFS userland; ZFS ships with Unraid 6.12+ but a server may
 * simply have no pools or an older release.
 *
 * @param shell - The connected SSH executor.
 * @returns `null` when ZFS is usable, or an error result to return as-is.
 */
export async function probeZfs(shell: ShellExecutor): Promise<CallToolResult | null> {
  const probe = await shell.execute("command -v zpool", PROBE_TIMEOUT_MS);
  if (probe.exitCode !== 0) {
    return toolError(
      "ZFS is not available on this server: the zpool command was not found. ZFS ships with Unraid 6.12+; on older releases this tool cannot work.",
    );
  }
  return null;
}
