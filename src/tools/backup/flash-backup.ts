import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor, ShellResult } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { progressContextFrom, startProgressHeartbeat } from "../_shared/progress.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "flash_backup";

/** User shares live here; the share name is appended after validation. */
const USER_SHARES_ROOT = "/mnt/user";
const BACKUP_SUBDIR = "flash-backups";
const FLASH_ROOT = "/boot";
const CONFIG_SUBDIR = "config";
const ARCHIVE_PREFIX = "flash-backup";
const ARCHIVE_SUFFIX = ".tar.gz";

/** Share names as Unraid allows them, minus anything that could escape the shares root. */
const SHARE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const PROBE_TIMEOUT_MS = 10_000;
/** A full-flash archive (bzroot, bzimage, … ≈ 2.6 GB on a real server) can take minutes. */
const ARCHIVE_TIMEOUT_MS = 900_000;
const VERIFY_TIMEOUT_MS = 300_000;
const PRUNE_TIMEOUT_MS = 30_000;

/** GNU tar exits 1 for "file changed as we read it" — the archive is still complete. */
const TAR_WARNING_EXIT_CODE = 1;

/** `tail -n +K` prints from line K, so the first archive to prune is keep + 1. */
const TAIL_OFFSET = 1;

/** Radix / padding for the UTC timestamp in archive names. */
const TWO_DIGITS = 2;

const SECRETS_WARNING =
  "⚠ The archive contains your Unraid license key, API keys, passwords, and network configuration — keep it on the array or encrypt it before copying it anywhere.";

type BackupScope = "config" | "full";

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  share: z.string().min(1),
  full: z.boolean().optional(),
  keep: z.number().int().positive().optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
});

/** The validated handler input. */
export interface FlashBackupArgs {
  response_format: ResponseFormat;
  share: string;
  full?: boolean;
  keep?: number;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** Collaborators; `now` is injectable so tests know the archive name. */
export interface FlashBackupDeps {
  shell: ShellExecutor | null;
  channel?: ElicitationChannel | null;
  now?: () => Date;
}

/** Everything the commands need, resolved once per call. */
interface BackupTarget {
  scope: BackupScope;
  directory: string;
  file: string;
}

/** What a successful run reports. */
interface BackupOutcome {
  path: string;
  scope: BackupScope;
  entries: number;
  bytes: number;
  pruned: string[];
  warnings: string | null;
}

function pad(value: number): string {
  return String(value).padStart(TWO_DIGITS, "0");
}

/**
 * Builds the archive file name: `flash-backup-<scope>-YYYYMMDD-HHMMSS.tar.gz` (UTC).
 *
 * @param scope - `config` for /boot/config only, `full` for the whole flash.
 * @param now - The timestamp to embed.
 * @returns The bare file name (no directory).
 * @example
 * archiveNameFor("config", new Date("2026-09-17T22:41:05Z")); // "flash-backup-config-20260917-224105.tar.gz"
 */
export function archiveNameFor(scope: BackupScope, now: Date): string {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${ARCHIVE_PREFIX}-${scope}-${date}-${time}${ARCHIVE_SUFFIX}`;
}

function targetFor(args: FlashBackupArgs, now: Date): BackupTarget {
  const scope: BackupScope = args.full ? "full" : "config";
  const directory = `${USER_SHARES_ROOT}/${args.share}/${BACKUP_SUBDIR}`;
  return { scope, directory, file: `${directory}/${archiveNameFor(scope, now)}` };
}

function refusalMessage(args: FlashBackupArgs): string {
  return `Refusing to back up the flash device: this writes an archive containing your license key, API keys, passwords, and network configuration to ${USER_SHARES_ROOT}/${args.share}/${BACKUP_SUBDIR}/. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

function buildArchiveCommand(target: BackupTarget): string {
  const source = target.scope === "config" ? quoteForShell(CONFIG_SUBDIR) : ".";
  return `mkdir -p ${quoteForShell(target.directory)} && tar -czf ${quoteForShell(target.file)} -C ${quoteForShell(FLASH_ROOT)} ${source}`;
}

function buildVerifyCommand(target: BackupTarget): string {
  const file = quoteForShell(target.file);
  return `tar -tzf ${file} | wc -l && stat -c %s ${file}`;
}

/** Parses "<entries>\n<bytes>" from the verify command; null when malformed. */
function parseVerification(stdout: string): { entries: number; bytes: number } | null {
  const [entries, bytes] = stdout.trim().split("\n").map(Number);
  if (!Number.isInteger(entries) || !Number.isInteger(bytes)) {
    return null;
  }
  return { entries, bytes };
}

function isTarWarningOnly(result: ShellResult): boolean {
  return result.exitCode === TAR_WARNING_EXIT_CODE;
}

/** Lists then deletes archives beyond `keep`, returning exactly what was removed. */
async function pruneOlder(
  shell: ShellExecutor,
  target: BackupTarget,
  keep: number,
): Promise<string[]> {
  const listCommand = `ls -1t ${quoteForShell(target.directory)}/${ARCHIVE_PREFIX}-*${ARCHIVE_SUFFIX} | tail -n +${keep + TAIL_OFFSET}`;
  const listing = await shell.execute(listCommand, PRUNE_TIMEOUT_MS);
  const prefix = `${target.directory}/${ARCHIVE_PREFIX}-`;
  const victims = listing.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix) && line.endsWith(ARCHIVE_SUFFIX));
  if (victims.length === 0) {
    return [];
  }
  await shell.execute(`rm -f ${victims.map(quoteForShell).join(" ")}`, PRUNE_TIMEOUT_MS);
  return victims;
}

function renderSuccess(outcome: BackupOutcome): string {
  const lines = [
    `Flash backup written: ${outcome.path} (${outcome.entries} entries, ${humanizeBytes(outcome.bytes)}). Verified with tar -tzf.`,
    SECRETS_WARNING,
  ];
  if (outcome.warnings) {
    lines.push(`tar warning (archive verified complete): ${outcome.warnings}`);
  }
  if (outcome.pruned.length > 0) {
    lines.push(`Pruned ${outcome.pruned.length} older archive(s): ${outcome.pruned.join(", ")}`);
  }
  return lines.join("\n");
}

/** Runs probe → archive → verify → prune; returns a tool error at the first hard failure. */
async function runBackup(
  shell: ShellExecutor,
  args: FlashBackupArgs,
  target: BackupTarget,
): Promise<BackupOutcome | CallToolResult> {
  const probe = await shell.execute(
    `test -d ${quoteForShell(`${USER_SHARES_ROOT}/${args.share}`)}`,
    PROBE_TIMEOUT_MS,
  );
  if (probe.exitCode !== 0) {
    return toolError(
      `Share "${args.share}" does not exist under ${USER_SHARES_ROOT} — see share_list. No changes were made.`,
    );
  }
  const archived = await shell.execute(buildArchiveCommand(target), ARCHIVE_TIMEOUT_MS);
  if (archived.exitCode !== 0 && !isTarWarningOnly(archived)) {
    return toolError(`tar failed (exit ${archived.exitCode}): ${archived.stderr.trim()}`);
  }
  const verified = await shell.execute(buildVerifyCommand(target), VERIFY_TIMEOUT_MS);
  const parsed = verified.exitCode === 0 ? parseVerification(verified.stdout) : null;
  if (!parsed) {
    return toolError(
      `Archive verification failed for ${target.file} (exit ${verified.exitCode}): ${verified.stderr.trim()} — do not rely on this backup.`,
    );
  }
  const pruned = args.keep === undefined ? [] : await pruneOlder(shell, target, args.keep);
  const warnings = isTarWarningOnly(archived) ? archived.stderr.trim() : null;
  return { path: target.file, scope: target.scope, ...parsed, pruned, warnings };
}

function isToolResult(value: BackupOutcome | CallToolResult): value is CallToolResult {
  return "content" in value;
}

/**
 * Creates the `flash_backup` handler bound to a shell executor.
 *
 * @param deps - Shell executor (null when SSH is unconfigured), elicitation channel, clock.
 * @returns An MCP handler that archives the flash device into a user share.
 * @example
 * const handler = createFlashBackupHandler({ shell });
 * await handler({ response_format: "concise", share: "backups", confirm: true, acknowledge_risk: true });
 */
export function createFlashBackupHandler(deps: FlashBackupDeps) {
  return async (args: FlashBackupArgs, extra?: unknown): Promise<CallToolResult> => {
    if (!deps.shell) {
      return sshUnavailableError();
    }
    if (!SHARE_NAME_PATTERN.test(args.share)) {
      return toolError(
        `Invalid share name "${args.share}": use the plain share name from share_list. No changes were made.`,
      );
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args),
      channel: deps.channel,
    });
    if (refusal) {
      return refusal;
    }
    const target = targetFor(args, (deps.now ?? (() => new Date()))());
    const stopHeartbeat = startProgressHeartbeat(progressContextFrom(extra), {
      message: `Still archiving ${target.scope === "full" ? FLASH_ROOT : `${FLASH_ROOT}/${CONFIG_SUBDIR}`} to ${target.file}`,
    });
    try {
      const outcome = await runBackup(deps.shell, args, target);
      if (isToolResult(outcome)) {
        return outcome;
      }
      return formatResponse(args.response_format, renderSuccess(outcome), outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to back up the flash device over SSH: ${message}`);
    } finally {
      stopHeartbeat();
    }
  };
}

/**
 * Registers the destructive `flash_backup` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerFlashBackup(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Back Up Flash Device",
      description:
        "⚠ Archives the Unraid flash (USB boot) device over SSH into a user share: by default /boot/config only (settings, plugins, keys — a few hundred MB); `full: true` archives all of /boot (several GB, includes the OS images). Writes /mnt/user/<share>/flash-backups/flash-backup-<scope>-<UTC timestamp>.tar.gz, verifies it with `tar -tzf`, and reports size and entry count; `keep: N` prunes older archives in that folder beyond N and lists exactly what it removed. The archive CONTAINS your license key, API keys, passwords, and network config — it stays on your own array; never copy it off the server unencrypted. Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH (UNRAID_SSH_*). Replaces the Unraid API's flash-backup mutation, which is an unimplemented stub.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createFlashBackupHandler({ shell, channel: createElicitationChannel(server) }),
  );
}
