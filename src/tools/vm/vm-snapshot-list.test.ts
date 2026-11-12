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

describe("vm_snapshot_list failure paths", () => {
  const request = { response_format: "concise", vm: "Windows 11" } as const;

  it("reports SSH unavailable without a shell", async () => {
    const handler = createVmSnapshotListHandler(null);

    const result = await handler(request);

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("surfaces a virsh snapshot-list failure with its stderr", async () => {
    const failed = {
      stdout: "",
      stderr: "error: failed to get domain 'Windows 11'\n",
      exitCode: 1,
    };
    const { shell } = sequencedShell([virshFound, failed]);
    const handler = createVmSnapshotListHandler(shell);

    const result = await handler(request);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      "virsh snapshot-list failed for Windows 11 (exit 1): error: failed to get domain 'Windows 11'",
    );
  });

  it("maps an SSH failure to a clean error", async () => {
    const { shell } = sequencedShell([new Error("connection refused")]);
    const handler = createVmSnapshotListHandler(shell);

    const result = await handler(request);

    expect(firstText(result)).toBe("Failed to list VM snapshots over SSH: connection refused");
  });
});
