import { describe, expect, it } from "vitest";
import type { ShellResult } from "../../shell/executor.js";
import { firstText, sequencedShell, throwingShell } from "../_shared/test-support.js";
import { createUnassignedActionHandler } from "./unassigned-action.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const pluginPresent = ok();
const pluginMissing: ShellResult = { stdout: "", stderr: "", exitCode: 1 };
const disksIni = ok('["disk1"]\ndevice="sdf"\n["flash"]\ndevice="sdae"\n');
const mounted = ok(
  JSON.stringify({ blockdevices: [{ kname: "sdz1", mountpoint: "/mnt/disks/Backup" }] }),
);
const unmounted = ok(JSON.stringify({ blockdevices: [{ kname: "sdz1", mountpoint: null }] }));

describe("unassigned_action gates", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("rejects anything that is not a partition path before the gate", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createUnassignedActionHandler(shell);

    for (const device of ["/dev/sdz", "sdz1", "/dev/sdz1; rm -rf /", "/mnt/disks/x"]) {
      const result = await handler({ action: "mount", device, ...bothFlags });
      expect(result.isError).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses when the Unassigned Devices plugin is missing (no raw mount fallback)", async () => {
    const { shell, calls } = sequencedShell([pluginMissing]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Unassigned Devices");
    expect(calls).toHaveLength(1);
  });

  it("refuses to touch a partition of an array, pool, or flash disk", async () => {
    const { shell, calls } = sequencedShell([pluginPresent, disksIni]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdf1", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("assigned");
    expect(calls).toHaveLength(2);
  });
});

describe("unassigned_action execution", () => {
  it("mounts through rc.unassigned and verifies the mountpoint", async () => {
    const { shell, calls } = sequencedShell([pluginPresent, disksIni, ok("mounted\n"), mounted]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });
    const text = firstText(result);

    expect(result.isError).toBeUndefined();
    expect(calls[2].command).toBe("'/usr/local/sbin/rc.unassigned' mount '/dev/sdz1'");
    expect(calls[3].command).toBe("lsblk -J -o KNAME,MOUNTPOINT '/dev/sdz1'");
    expect(text).toContain("/mnt/disks/Backup");
    expect(text).toContain("verified");
  });

  it("reports an unverified mount when lsblk still shows no mountpoint", async () => {
    const { shell } = sequencedShell([pluginPresent, disksIni, ok(), unmounted]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not mounted");
  });

  it("unmounts and verifies the mountpoint is gone", async () => {
    const { shell, calls } = sequencedShell([pluginPresent, disksIni, ok(), unmounted]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "unmount", device: "/dev/sdz1", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[2].command).toBe("'/usr/local/sbin/rc.unassigned' umount '/dev/sdz1'");
    expect(firstText(result)).toContain("unmounted");
  });

  it("surfaces an rc.unassigned failure", async () => {
    const { shell } = sequencedShell([
      pluginPresent,
      disksIni,
      { stdout: "", stderr: "Fail: device not defined.", exitCode: 1 },
    ]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("device not defined");
  });
});

describe("unassigned_action verification and failures", () => {
  it("refuses an NVMe partition whose parent disk is a pool member", async () => {
    const poolIni = ok('["cache"]\ndevice="nvme0n1"\n');
    const { shell, calls } = sequencedShell([pluginPresent, poolIni]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/nvme0n1p1", ...bothFlags });

    expect(firstText(result)).toContain("/dev/nvme0n1p1 belongs to an assigned disk");
    expect(calls).toHaveLength(2);
  });

  it("reports an unverified unmount when lsblk still shows a mountpoint", async () => {
    const { shell } = sequencedShell([pluginPresent, disksIni, ok(), mounted]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "unmount", device: "/dev/sdz1", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain(
      "lsblk shows the partition still mounted at /mnt/disks/Backup",
    );
  });

  it("treats an unreadable lsblk read-back as not mounted", async () => {
    const { shell } = sequencedShell([
      pluginPresent,
      disksIni,
      ok(),
      ok("lsblk: not a block device"),
    ]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("lsblk shows the partition not mounted");
  });

  it("falls back to stdout when rc.unassigned fails without stderr", async () => {
    const failed = { stdout: "Partition is busy.", stderr: "", exitCode: 1 };
    const { shell } = sequencedShell([pluginPresent, disksIni, failed]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "unmount", device: "/dev/sdz1", ...bothFlags });

    expect(firstText(result)).toBe("rc.unassigned umount failed (exit 1): Partition is busy.");
  });

  it("reports SSH unavailable without a shell", async () => {
    const handler = createUnassignedActionHandler(null);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("maps an SSH failure to a clean error", async () => {
    const { shell } = sequencedShell([new Error("connection refused")]);
    const handler = createUnassignedActionHandler(shell);

    const result = await handler({ action: "mount", device: "/dev/sdz1", ...bothFlags });

    expect(firstText(result)).toBe("Failed to mount /dev/sdz1 over SSH: connection refused");
  });

  it("prefixes SSH failures with the tool context", async () => {
    const handler = createUnassignedActionHandler(throwingShell("channel closed"));

    const result = await handler({ action: "unmount", device: "/dev/sdz1", ...bothFlags });

    expect(firstText(result)).toBe("Failed to unmount /dev/sdz1 over SSH: channel closed");
  });
});
