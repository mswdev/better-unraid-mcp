import { describe, expect, it } from "vitest";
import {
  firstText,
  rejectingShell,
  sequencedShell,
  throwingShell,
} from "../_shared/test-support.js";
import { createDiskSmartReportHandler } from "./disk-smart-report.js";

const smartctlFound = { stdout: "/usr/sbin/smartctl\n", stderr: "", exitCode: 0 };

describe("disk_smart_report", () => {
  it("rejects invalid devices before any command", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createDiskSmartReportHandler(shell);

    const result = await handler({ device: "/etc/passwd" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("reports smartctl missing cleanly", async () => {
    const { shell } = sequencedShell([{ stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createDiskSmartReportHandler(shell);

    const result = await handler({ device: "/dev/sdb" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("smartctl is not available");
  });

  it("returns the report even with an informational non-zero exit", async () => {
    const { shell, calls } = sequencedShell([
      smartctlFound,
      {
        stdout: "SMART overall-health self-assessment test result: PASSED\nRaw_Read_Error_Rate 0",
        stderr: "",
        exitCode: 64,
      },
    ]);
    const handler = createDiskSmartReportHandler(shell);

    const result = await handler({ device: "/dev/sdb" });

    expect(result.isError).toBeUndefined();
    expect(calls[1].command).toBe("smartctl -a /dev/sdb");
    expect(firstText(result)).toContain("PASSED");
  });

  it("errors when smartctl produces no output", async () => {
    const { shell } = sequencedShell([
      smartctlFound,
      { stdout: "", stderr: "Permission denied", exitCode: 2 },
    ]);
    const handler = createDiskSmartReportHandler(shell);

    const result = await handler({ device: "/dev/nvme0n1" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Permission denied");
  });
});

describe("disk_smart_report failures", () => {
  it("reports SSH unavailable when no shell is configured", async () => {
    const handler = createDiskSmartReportHandler(null);

    const result = await handler({ device: "/dev/sda" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("maps an SSH failure to a clean error", async () => {
    const handler = createDiskSmartReportHandler(throwingShell("connection refused"));

    const result = await handler({ device: "/dev/sda" });

    expect(firstText(result)).toBe("Failed to read SMART report over SSH: connection refused");
  });

  it("reports a non-Error SSH rejection as text", async () => {
    const handler = createDiskSmartReportHandler(rejectingShell("channel closed"));

    const result = await handler({ device: "/dev/sda" });

    expect(firstText(result)).toBe("Failed to read SMART report over SSH: channel closed");
  });
});
