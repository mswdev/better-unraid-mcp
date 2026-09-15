import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createVmSnapshotCreateHandler } from "./vm-snapshot-create.js";

const virshFound = { stdout: "/usr/sbin/virsh\n", stderr: "", exitCode: 0 };
const okResult = { stdout: "Domain snapshot pre-update created\n", stderr: "", exitCode: 0 };
const bothFlags = { confirm: true, acknowledge_risk: true } as const;

describe("vm_snapshot_create", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createVmSnapshotCreateHandler(shell);

    const result = await handler({ vm: "Home-VM", name: "pre-update", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("rejects unsafe snapshot names before the gate", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createVmSnapshotCreateHandler(shell);

    const result = await handler({ vm: "Home-VM", name: "bad;name", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("creates an external atomic disk-only snapshot", async () => {
    const { shell, calls } = sequencedShell([virshFound, okResult]);
    const handler = createVmSnapshotCreateHandler(shell);

    const result = await handler({ vm: "Home VM", name: "pre-update", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[1].command).toBe(
      "virsh snapshot-create-as 'Home VM' 'pre-update' --atomic --disk-only",
    );
    expect(firstText(result)).toContain("vm_snapshot_list");
  });

  it("surfaces virsh failures", async () => {
    const { shell } = sequencedShell([
      virshFound,
      { stdout: "", stderr: "error: domain not found", exitCode: 1 },
    ]);
    const handler = createVmSnapshotCreateHandler(shell);

    const result = await handler({ vm: "ghost", name: "x", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("domain not found");
  });
});
