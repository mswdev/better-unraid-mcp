import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
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
