import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createVmSnapshotListHandler } from "./vm-snapshot-list.js";

const virshFound = { stdout: "/usr/sbin/virsh\n", stderr: "", exitCode: 0 };

describe("vm_snapshot_list", () => {
  it("reports virsh unavailable when the VM service is disabled", async () => {
    const { shell } = sequencedShell([{ stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createVmSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise", vm: "Home-VM" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("VM service");
  });

  it("lists snapshot names for the quoted VM", async () => {
    const { shell, calls } = sequencedShell([
      virshFound,
      { stdout: "pre-update\nnightly\n", stderr: "", exitCode: 0 },
    ]);
    const handler = createVmSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise", vm: "Home VM" });

    expect(calls[1].command).toBe("virsh snapshot-list 'Home VM' --name");
    expect(firstText(result)).toContain("pre-update");
  });

  it("reports zero snapshots cleanly", async () => {
    const { shell } = sequencedShell([virshFound, { stdout: "\n", stderr: "", exitCode: 0 }]);
    const handler = createVmSnapshotListHandler(shell);

    const result = await handler({ response_format: "concise", vm: "Home-VM" });

    expect(firstText(result)).toContain("no snapshots");
  });
});
