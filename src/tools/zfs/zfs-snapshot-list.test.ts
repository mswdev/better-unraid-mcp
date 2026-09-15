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
