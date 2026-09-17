import { quoteForShell } from "../_shared/quote-shell.js";

export const SHARE_CFG_DIR = "/boot/config/shares";
export const SHARES_ROOT = "/mnt/user";
export const DISKS_INI = "/var/local/emhttp/disks.ini";
export const VAR_INI = "/var/local/emhttp/var.ini";
/** emhttpd's command socket client (what the web UI's forms end up calling). */
export const EMCMD = "/usr/local/sbin/emcmd";

/** Separator between the disks.ini and var.ini parts of the one-shot context read. */
export const CONTEXT_SEPARATOR = "=== VAR";

export const MAX_SHARE_NAME_LENGTH = 40;
const SHARE_NAME_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/** Names Unraid itself uses under /mnt or as pseudo-shares; never creatable. */
export const RESERVED_SHARE_NAMES = [
  "flash",
  "boot",
  "disks",
  "disk",
  "user",
  "user0",
  "cache",
  "parity",
  "remotes",
  "addons",
  "rootshare",
];

export const CFG_TIMEOUT_MS = 10_000;
/** emhttpd applies a share change synchronously but may reload shares first. */
export const EMCMD_TIMEOUT_MS = 60_000;

export type CacheMode = "no" | "yes" | "only" | "prefer";
export type Allocator = "highwater" | "fillup" | "mostfree";
export type SmbExport = "-" | "e" | "eh";
export type SmbSecurity = "public" | "secure" | "private";

/** The validated subset of share settings these tools expose. */
export interface ShareSettings {
  comment?: string;
  allocator?: Allocator;
  useCache?: CacheMode;
  cachePool?: string;
  smbExport?: SmbExport;
  smbSecurity?: SmbSecurity;
}

/** Everything buildEditQuery needs. */
export interface EditQueryInput {
  name: string;
  nameOrig: string;
  current: Record<string, string>;
  changes: ShareSettings;
  command: "Add Share" | "Apply" | "Delete";
}

/** Settings → the cfg/form key they map to. */
export const SETTING_KEYS: Record<keyof ShareSettings, string> = {
  comment: "shareComment",
  allocator: "shareAllocator",
  useCache: "shareUseCache",
  cachePool: "shareCachePool",
  smbExport: "shareExport",
  smbSecurity: "shareSecurity",
};

/** Defaults emhttpd would otherwise leave blank on a brand-new share. */
const CREATE_DEFAULTS: Record<string, string> = {
  shareAllocator: "highwater",
  shareUseCache: "no",
  shareCOW: "auto",
  shareCaseSensitive: "auto",
  shareExport: "-",
  shareSecurity: "public",
};

/** ShareEdit.page form fields, in form order (validated against unraid/webgui 2026-09-17). */
const EDIT_FIELDS = [
  "shareComment",
  "shareAllocator",
  "shareFloor",
  "shareSplitLevel",
  "shareUseCache",
  "shareCachePool",
  "shareCachePool2",
  "shareCOW",
  "shareInclude",
  "shareExclude",
];

/** SecuritySMB.page form fields. */
const SMB_FIELDS = ["shareExport", "shareSecurity", "shareCaseSensitive", "shareVolsizelimit"];

/**
 * Parses a `/boot/config/shares/<name>.cfg` file (`key="value"` per line).
 *
 * @param text - Raw file contents.
 * @returns The key/value map; comments and blank lines are skipped.
 */
export function parseShareCfg(text: string): Record<string, string> {
  const cfg: Record<string, string> = {};
  for (const match of text.matchAll(/^([A-Za-z0-9_]+)="([^"]*)"/gm)) {
    cfg[match[1]] = match[2];
  }
  return cfg;
}

/** Changes as cfg keys, e.g. `{ shareComment: "x" }`. */
function changedFields(changes: ShareSettings): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [setting, key] of Object.entries(SETTING_KEYS) as Array<
    [keyof ShareSettings, string]
  >) {
    const value = changes[setting];
    if (value !== undefined) {
      fields[key] = value;
    }
  }
  return fields;
}

function encodePairs(pairs: Array<[string, string]>): string {
  return pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

/**
 * Builds the ShareEdit form body emhttpd expects: every field, with requested
 * changes overriding the current cfg, and Unraid defaults for a new share.
 *
 * @param input - Name, original name, current cfg, changes, and the submit command.
 * @returns A URL-encoded query string for {@link emcmdCommand}.
 */
export function buildEditQuery(input: EditQueryInput): string {
  const merged = { ...CREATE_DEFAULTS, ...input.current, ...changedFields(input.changes) };
  const pairs: Array<[string, string]> = [
    ["shareName", input.name],
    ["shareNameOrig", input.nameOrig],
  ];
  for (const field of EDIT_FIELDS) {
    pairs.push([field, merged[field] ?? ""]);
  }
  pairs.push(["cmdEditShare", input.command]);
  return encodePairs(pairs);
}

/**
 * Builds the SecuritySMB form body when export or security change; null otherwise.
 *
 * @param name - The share name.
 * @param current - The current cfg.
 * @param changes - Requested settings.
 * @returns A URL-encoded query string, or null when no SMB field is involved.
 */
export function buildSmbQuery(
  name: string,
  current: Record<string, string>,
  changes: ShareSettings,
): string | null {
  if (changes.smbExport === undefined && changes.smbSecurity === undefined) {
    return null;
  }
  const merged = { ...CREATE_DEFAULTS, ...current, ...changedFields(changes) };
  const pairs: Array<[string, string]> = [["shareName", name]];
  for (const field of SMB_FIELDS) {
    pairs.push([field, merged[field] ?? ""]);
  }
  pairs.push(["changeShareSecurity", "Apply"]);
  return encodePairs(pairs);
}

/** The shell command that hands a form body to emhttpd. */
export function emcmdCommand(query: string): string {
  return `${quoteForShell(EMCMD)} ${quoteForShell(query)}`;
}

/** Pool names = disks.ini sections whose type is Cache. */
export function parsePoolNames(disksIni: string): string[] {
  const pools: string[] = [];
  for (const match of disksIni.matchAll(/^\["([^"]+)"\]\n(?:(?!\[)[^\n]*\n)*?type="Cache"/gm)) {
    pools.push(match[1]);
  }
  return pools;
}

/** Every disks.ini section name (disk1, parity, cache, flash, …). */
export function parseDiskNames(disksIni: string): string[] {
  return [...disksIni.matchAll(/^\["([^"]+)"\]/gm)].map((match) => match[1]);
}

/** emhttpd's own reserved list from var.ini (`reservedNames="a,b,c"`). */
export function parseReservedNames(varIni: string): string[] {
  const match = varIni.match(/^reservedNames="([^"]*)"/m);
  return match?.[1]
    ? match[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
}

/** Case-insensitive reserved check against the built-in list plus host-provided names. */
export function isReservedName(name: string, extra: string[]): boolean {
  const lowered = name.toLowerCase();
  return [...RESERVED_SHARE_NAMES, ...extra].some((reserved) => reserved.toLowerCase() === lowered);
}

/**
 * Validates a share name the way ShareEdit.page does.
 *
 * @param name - The requested share name.
 * @returns A human reason when invalid, or null when acceptable.
 */
export function validateShareName(name: string): string | null {
  if (name.length === 0) {
    return "Share name is empty.";
  }
  if (name.length > MAX_SHARE_NAME_LENGTH) {
    return `Share name must be ${MAX_SHARE_NAME_LENGTH} characters or less.`;
  }
  if (name.startsWith(".")) {
    return "Share names must not start with a dot (hidden shares are not allowed).";
  }
  if (!SHARE_NAME_CHARACTERS.test(name)) {
    return "Share names may only contain letters, digits, dot, underscore, and hyphen.";
  }
  return null;
}

export function shareCfgPath(name: string): string {
  return `${SHARE_CFG_DIR}/${name}.cfg`;
}

/** Compares each requested setting with the cfg read back; lists the keys that differ. */
export function unverifiedKeys(changes: ShareSettings, cfgAfter: Record<string, string>): string[] {
  return Object.entries(changedFields(changes))
    .filter(([key, value]) => cfgAfter[key] !== value)
    .map(([key]) => key);
}
