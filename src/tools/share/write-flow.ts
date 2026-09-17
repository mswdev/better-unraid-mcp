import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ShellExecutor } from "../../shell/executor.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { toolError, toolText } from "../_shared/respond.js";
import {
  CFG_TIMEOUT_MS,
  CONTEXT_SEPARATOR,
  DISKS_INI,
  EMCMD_TIMEOUT_MS,
  type EditQueryInput,
  type ShareSettings,
  VAR_INI,
  buildEditQuery,
  buildSmbQuery,
  emcmdCommand,
  isReservedName,
  parseDiskNames,
  parsePoolNames,
  parseReservedNames,
  parseShareCfg,
  shareCfgPath,
  unverifiedKeys,
} from "./_shared.js";

/** Host facts a share write must respect. */
export interface HostContext {
  pools: string[];
  diskNames: string[];
  reserved: string[];
}

/** Reads `/boot/config/shares/<name>.cfg`; null when the file does not exist. */
export async function readShareCfg(
  shell: ShellExecutor,
  name: string,
): Promise<Record<string, string> | null> {
  const result = await shell.execute(`cat ${quoteForShell(shareCfgPath(name))}`, CFG_TIMEOUT_MS);
  return result.exitCode === 0 ? parseShareCfg(result.stdout) : null;
}

/** One round-trip for pools, disk names, and emhttpd's reserved names. */
export async function readHostContext(shell: ShellExecutor): Promise<HostContext> {
  const command = `cat ${quoteForShell(DISKS_INI)}; echo '${CONTEXT_SEPARATOR}'; grep '^reservedNames=' ${quoteForShell(VAR_INI)}`;
  const result = await shell.execute(command, CFG_TIMEOUT_MS);
  const [disksIni = "", varIni = ""] = result.stdout.split(`${CONTEXT_SEPARATOR}\n`);
  return {
    pools: parsePoolNames(disksIni),
    diskNames: parseDiskNames(disksIni),
    reserved: parseReservedNames(varIni),
  };
}

/** Name/pool refusals that depend on host facts. */
export function checkAgainstHost(
  name: string,
  changes: ShareSettings,
  host: HostContext,
): CallToolResult | null {
  if (isReservedName(name, [...host.reserved, ...host.diskNames, ...host.pools])) {
    return toolError(
      `"${name}" is a reserved name (Unraid pseudo-share, disk, or pool name). No changes were made.`,
    );
  }
  if (changes.cachePool !== undefined && !host.pools.includes(changes.cachePool)) {
    return toolError(
      `Unknown cache pool "${changes.cachePool}". Pools on this server: ${host.pools.join(", ") || "(none)"}. No changes were made.`,
    );
  }
  return null;
}

/** Runs one emcmd form submission; emhttpd prints its error text and exits 1 on failure. */
export async function submitToEmhttpd(
  shell: ShellExecutor,
  query: string,
): Promise<CallToolResult | null> {
  const result = await shell.execute(emcmdCommand(query), EMCMD_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return toolError(
      `emhttpd rejected the change (exit ${result.exitCode}): ${result.stdout.trim() || result.stderr.trim()}. Nothing was verified — check the share in the web UI.`,
    );
  }
  return null;
}

/** Submits the ShareEdit form, then the SMB form when needed, then verifies by re-reading the cfg. */
export async function applyAndVerify(
  shell: ShellExecutor,
  input: EditQueryInput,
): Promise<CallToolResult> {
  const editFailure = await submitToEmhttpd(shell, buildEditQuery(input));
  if (editFailure) {
    return editFailure;
  }
  const smbQuery = buildSmbQuery(input.name, input.current, input.changes);
  const smbFailure = smbQuery ? await submitToEmhttpd(shell, smbQuery) : null;
  if (smbFailure) {
    return smbFailure;
  }
  const after = await readShareCfg(shell, input.name);
  if (after === null) {
    return toolError(
      `emhttpd accepted the change but ${shareCfgPath(input.name)} could not be read back — not verified. Check the share in the web UI.`,
    );
  }
  const mismatched = unverifiedKeys(input.changes, after);
  if (mismatched.length > 0) {
    return toolError(
      `emhttpd accepted the change but the read-back differs for ${mismatched.join(", ")} — not verified. Check the share in the web UI (Shares → ${input.name}).`,
    );
  }
  const verb = input.command === "Add Share" ? "created" : "updated";
  return toolText(
    `Share "${input.name}" ${verb} — verified by re-reading ${shareCfgPath(input.name)}${smbQuery ? " (SMB settings applied)" : ""}. Data path: /mnt/user/${input.name}.`,
  );
}
