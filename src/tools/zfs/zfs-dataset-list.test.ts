import { describe, expect, it } from "vitest";
import { firstText, rejectingShell, sequencedShell } from "../_shared/test-support.js";
import { createZfsDatasetListHandler } from "./zfs-dataset-list.js";

const probeOk = { stdout: "/usr/sbin/zpool\n", stderr: "", exitCode: 0 };

const listing = {
  stdout: "tank/media\t1073741824000\t2147483648000\t1073741824\t/mnt/tank/media\n",
  stderr: "",
  exitCode: 0,
};

describe("zfs_dataset_list", () => {
  it("rejects an invalid pool name before any command", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createZfsDatasetListHandler(shell);

    const result = await handler({ response_format: "concise", pool: "bad;name" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("lists datasets with sizes and mountpoints", async () => {
    const { shell, calls } = sequencedShell([probeOk, listing]);
    const handler = createZfsDatasetListHandler(shell);

    const result = await handler({ response_format: "concise", pool: "tank" });

    expect(firstText(result)).toContain("tank/media");
    expect(firstText(result)).toContain("/mnt/tank/media");
    expect(calls[1].command).toContain("-r 'tank'");
  });

  it("reports an empty listing", async () => {
    const { shell } = sequencedShell([probeOk, { stdout: "", stderr: "", exitCode: 0 }]);
    const handler = createZfsDatasetListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("No ZFS datasets");
  });
});

describe("zfs_dataset_list failure paths", () => {
  const probeMissing = { stdout: "", stderr: "", exitCode: 1 };

  it("reports SSH unavailable without a shell", async () => {
    const handler = createZfsDatasetListHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("stops when zpool is missing", async () => {
    const { shell, calls } = sequencedShell([probeMissing]);
    const handler = createZfsDatasetListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("ZFS is not available on this server");
    expect(calls).toHaveLength(1);
  });

  it("surfaces a zfs list failure with its stderr", async () => {
    const failed = {
      stdout: "",
      stderr: "cannot open 'nope': dataset does not exist\n",
      exitCode: 1,
    };
    const { shell } = sequencedShell([probeOk, failed]);
    const handler = createZfsDatasetListHandler(shell);

    const result = await handler({ response_format: "concise", pool: "nope" });

    expect(firstText(result)).toBe(
      "zfs list failed (exit 1): cannot open 'nope': dataset does not exist",
    );
  });

  it("maps an SSH failure to a clean error", async () => {
    const { shell } = sequencedShell([new Error("connection refused")]);
    const handler = createZfsDatasetListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to list ZFS datasets over SSH: connection refused");
  });

  it("reports a non-Error SSH rejection as text", async () => {
    const handler = createZfsDatasetListHandler(rejectingShell("channel closed"));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to list ZFS datasets over SSH: channel closed");
  });
});
