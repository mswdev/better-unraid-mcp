/** emhttpd's live device map: every array, pool, and flash member has a `device="…"` line. */
export const DISKS_INI = "/var/local/emhttp/disks.ini";

/** JSON listing of whole disks with their partitions, mount points, and identity. */
export const LSBLK_COMMAND =
  "lsblk -J -o NAME,KNAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,LABEL,MODEL,SERIAL,TRAN";

/** The Unassigned Devices plugin's entry point (symlink into the plugin). */
export const UD_SCRIPT = "/usr/local/sbin/rc.unassigned";

/** UD mounts and unmounts PARTITIONS: /dev/sdX1, /dev/nvme0n1p1. */
export const PARTITION_PATTERN = /^\/dev\/(sd[a-z]+[0-9]+|nvme[0-9]+n[0-9]+p[0-9]+)$/;

export const PROBE_TIMEOUT_MS = 10_000;
export const LIST_TIMEOUT_MS = 30_000;
/** Mounting can spin a disk up and run a filesystem check. */
export const MOUNT_TIMEOUT_MS = 120_000;

/** One partition as lsblk reports it. */
export interface UnassignedPartition {
  device: string;
  fstype: string | null;
  mountpoint: string | null;
  label: string | null;
  size: string;
}

/** One whole disk that belongs to neither the array, a pool, nor the flash. */
export interface UnassignedDisk {
  device: string;
  model: string | null;
  serial: string | null;
  size: string;
  transport: string | null;
  partitions: UnassignedPartition[];
}

/** The subset of lsblk's JSON this module reads. */
interface LsblkNode {
  kname?: string;
  type?: string;
  size?: string;
  fstype?: string | null;
  mountpoint?: string | null;
  label?: string | null;
  model?: string | null;
  serial?: string | null;
  tran?: string | null;
  children?: LsblkNode[];
}

/**
 * Collects every `device="…"` value from disks.ini (array data/parity disks,
 * pool members, and the flash drive).
 *
 * @param disksIni - The raw file contents.
 * @returns Kernel device names such as `sdf`, `nvme0n1`.
 */
export function parseAssignedDevices(disksIni: string): Set<string> {
  const assigned = new Set<string>();
  for (const match of disksIni.matchAll(/^device="([^"]+)"/gm)) {
    assigned.add(match[1]);
  }
  return assigned;
}

function parseLsblk(json: string): LsblkNode[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const devices = (parsed as { blockdevices?: unknown }).blockdevices;
    return Array.isArray(devices) ? (devices as LsblkNode[]) : [];
  } catch {
    return [];
  }
}

function toPartition(node: LsblkNode): UnassignedPartition {
  return {
    device: `/dev/${node.kname ?? "?"}`,
    fstype: node.fstype ?? null,
    mountpoint: node.mountpoint ?? null,
    label: node.label ?? null,
    size: node.size ?? "?",
  };
}

function toDisk(node: LsblkNode): UnassignedDisk {
  return {
    device: `/dev/${node.kname ?? "?"}`,
    model: node.model ?? null,
    serial: node.serial ?? null,
    size: node.size ?? "?",
    transport: node.tran ?? null,
    partitions: (node.children ?? []).filter((c) => c.type === "part").map(toPartition),
  };
}

/**
 * Picks the whole disks (`type: "disk"`, so never loop/zram devices) whose
 * kernel name is not assigned to the array, a pool, or the flash.
 *
 * @param lsblkJson - Output of {@link LSBLK_COMMAND}.
 * @param assigned - From {@link parseAssignedDevices}.
 * @returns The unassigned disks with their partitions; empty on unparsable input.
 */
export function selectUnassigned(lsblkJson: string, assigned: Set<string>): UnassignedDisk[] {
  return parseLsblk(lsblkJson)
    .filter((node) => node.type === "disk" && node.kname !== undefined && !assigned.has(node.kname))
    .map(toDisk);
}

/**
 * The whole-disk kernel name behind a partition path: `/dev/sdz1` → `sdz`,
 * `/dev/nvme0n1p1` → `nvme0n1`.
 *
 * @param partition - A path accepted by {@link PARTITION_PATTERN}.
 * @returns The parent disk's kernel name.
 */
export function parentDiskOf(partition: string): string {
  const name = partition.replace(/^\/dev\//, "");
  return name.startsWith("nvme") ? name.replace(/p[0-9]+$/, "") : name.replace(/[0-9]+$/, "");
}
