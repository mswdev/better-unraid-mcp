import { describe, expect, it } from "vitest";
import { firstText, rejectingShell, sequencedShell } from "../_shared/test-support.js";
import { createZfsSnapshotActionHandler } from "./zfs-snapshot-action.js";

const probeOk = { stdout: "/usr/sbin/zpool\n", stderr: "", exitCode: 0 };
const okResult = { stdout: "", stderr: "", exitCode: 0 };
const bothFlags = { confirm: true, acknowledge_risk: true } as const;

describe("zfs_snapshot_action", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler({
      action: "destroy",
      dataset: "tank/media",
      snapshot: "nightly",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid names before the gate", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler({
      action: "create",
      dataset: "tank/media",
      snapshot: "bad name;rm",
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("creates a snapshot with the quoted dataset@name target", async () => {
    const { shell, calls } = sequencedShell([probeOk, okResult]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler({
      action: "create",
      dataset: "tank/media",
      snapshot: "pre-update",
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls[1].command).toBe("zfs snapshot 'tank/media@pre-update'");
  });

  it("destroys only @-qualified targets", async () => {
    const { shell, calls } = sequencedShell([probeOk, okResult]);
    const handler = createZfsSnapshotActionHandler(shell);

    await handler({ action: "destroy", dataset: "tank/media", snapshot: "old", ...bothFlags });

    expect(calls[1].command).toBe("zfs destroy 'tank/media@old'");
  });

  it("surfaces the zfs error on a failed rollback", async () => {
    const { shell } = sequencedShell([
      probeOk,
      {
        stdout: "",
        stderr: "cannot rollback to 'tank/media@old': more recent snapshots exist",
        exitCode: 1,
      },
    ]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler({
      action: "rollback",
      dataset: "tank/media",
      snapshot: "old",
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("more recent snapshots exist");
  });
});

describe("zfs_snapshot_action failure paths", () => {
  const request = {
    action: "create",
    dataset: "tank/media",
    snapshot: "nightly",
    ...bothFlags,
  } as const;

  it("reports SSH unavailable without a shell", async () => {
    const handler = createZfsSnapshotActionHandler(null);

    const result = await handler(request);

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("stops when zpool is missing", async () => {
    const { shell, calls } = sequencedShell([{ stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler(request);

    expect(firstText(result)).toContain("ZFS is not available on this server");
    expect(calls).toHaveLength(1);
  });

  it("says so when a failed zfs command printed nothing", async () => {
    const { shell } = sequencedShell([probeOk, { stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler(request);

    expect(firstText(result)).toBe("zfs create failed (exit 1): (no output)");
  });

  it("maps an SSH failure to a clean error", async () => {
    const { shell } = sequencedShell([new Error("connection refused")]);
    const handler = createZfsSnapshotActionHandler(shell);

    const result = await handler(request);

    expect(firstText(result)).toBe("Failed to create ZFS snapshot over SSH: connection refused");
  });

  it("reports a non-Error SSH rejection as text", async () => {
    const handler = createZfsSnapshotActionHandler(rejectingShell("channel closed"));

    const result = await handler(request);

    expect(firstText(result)).toBe("Failed to create ZFS snapshot over SSH: channel closed");
  });
});
