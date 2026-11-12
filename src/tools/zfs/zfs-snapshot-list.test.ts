import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createZfsSnapshotListHandler } from "./zfs-snapshot-list.js";

const probeOk = { stdout: "/usr/sbin/zpool\n", stderr: "", exitCode: 0 };

describe("zfs_snapshot_list", () => {
  it("lists snapshots with usage and creation time", async () => {
    const { shell, calls } = sequencedShell([
      probeOk,
      {
        stdout: "tank/media@nightly\t1.2M\tSun Sep 14  3:00 2026\n",
        stderr: "",
        exitCode: 0,
      },
    ]);
    const handler = createZfsSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise", dataset: "tank/media" });

    expect(firstText(result)).toContain("tank/media@nightly");
    expect(calls[1].command).toContain("-t snapshot");
    expect(calls[1].command).toContain("'tank/media'");
  });

  it("reports when no snapshots exist", async () => {
    const { shell } = sequencedShell([probeOk, { stdout: "", stderr: "", exitCode: 0 }]);
    const handler = createZfsSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("No ZFS snapshots");
  });
});

describe("zfs_snapshot_list failure paths", () => {
  it("reports SSH unavailable without a shell", async () => {
    const handler = createZfsSnapshotListHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("rejects an invalid dataset name before any command", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createZfsSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise", dataset: "tank;rm" });

    expect(firstText(result)).toBe("Invalid dataset name: tank;rm");
    expect(calls).toHaveLength(0);
  });

  it("stops when zpool is missing", async () => {
    const { shell, calls } = sequencedShell([{ stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createZfsSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("ZFS is not available on this server");
    expect(calls).toHaveLength(1);
  });

  it("surfaces a zfs snapshot listing failure with its stderr", async () => {
    const failed = { stdout: "", stderr: "permission denied\n", exitCode: 1 };
    const { shell } = sequencedShell([probeOk, failed]);
    const handler = createZfsSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("zfs snapshot list failed (exit 1): permission denied");
  });

  it("maps an SSH failure to a clean error", async () => {
    const { shell } = sequencedShell([new Error("connection refused")]);
    const handler = createZfsSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to list ZFS snapshots over SSH: connection refused");
  });
});
