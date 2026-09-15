import { describe, expect, it } from "vitest";
import { firstText, recordingShell } from "../_shared/test-support.js";
import { createDiskSpinHandler } from "./disk-spin.js";

const okResult = { stdout: "", stderr: "", exitCode: 0 };

describe("disk_spin", () => {
  it("requires exactly one target", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createDiskSpinHandler(shell);

    const both = await handler({
      action: "down",
      disk: "disk1",
      device: "/dev/sdb",
      confirm: true,
    });
    const neither = await handler({ action: "down", confirm: true });

    expect(both.isError).toBe(true);
    expect(neither.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects nvme devices (they do not spin)", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createDiskSpinHandler(shell);

    const result = await handler({ action: "down", device: "/dev/nvme0n1", confirm: true });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses without confirm and runs nothing", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createDiskSpinHandler(shell);

    const result = await handler({ action: "down", disk: "disk1" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("spins an array slot through emcmd", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createDiskSpinHandler(shell);

    const result = await handler({ action: "down", disk: "disk1", confirm: true });

    expect(result.isError).toBeUndefined();
    expect(calls[0].command).toBe("/usr/local/sbin/emcmd cmdSpindown=disk1");
    expect(firstText(result)).toContain("disk_list");
  });

  it("spins an unassigned device through sdspin", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createDiskSpinHandler(shell);

    await handler({ action: "up", device: "/dev/sdb", confirm: true });

    expect(calls[0].command).toBe("/usr/local/sbin/sdspin /dev/sdb up");
  });
});
