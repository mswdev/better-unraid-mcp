import { describe, expect, it } from "vitest";
import { firstText, sequencedShell, throwingShell } from "../_shared/test-support.js";
import { createZfsStatusHandler } from "./zfs-status.js";

const probeOk = { stdout: "/usr/sbin/zpool\n", stderr: "", exitCode: 0 };
const probeMissing = { stdout: "", stderr: "", exitCode: 1 };

const poolList = {
  stdout: "tank\t10.9T\t4.2T\t6.7T\t38%\tONLINE\nscratch\t1.8T\t1.6T\t200G\t88%\tDEGRADED\n",
  stderr: "",
  exitCode: 0,
};

const arcstats = {
  stdout: [
    "name                            type data",
    "hits                            4    123",
    "size                            4    4294967296",
    "c_max                           4    8589934592",
  ].join("\n"),
  stderr: "",
  exitCode: 0,
};

describe("zfs_status", () => {
  it("refuses without SSH configured", async () => {
    const handler = createZfsStatusHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
  });

  it("reports ZFS unavailable when zpool is missing", async () => {
    const { shell, calls } = sequencedShell([probeMissing]);
    const handler = createZfsStatusHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not available");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("command -v zpool");
  });

  it("reports pools with health and ARC usage", async () => {
    const { shell } = sequencedShell([probeOk, poolList, arcstats]);
    const handler = createZfsStatusHandler(shell);

    const result = await handler({ response_format: "concise" });
    const text = firstText(result);

    expect(text).toContain("tank: ONLINE");
    expect(text).toContain("scratch: DEGRADED");
    expect(text).toContain("ARC: 4.0 GiB of 8.0 GiB max (50%)");
  });

  it("degrades gracefully when arcstats are unreadable", async () => {
    const { shell } = sequencedShell([probeOk, poolList, { stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createZfsStatusHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("ARC stats unavailable");
  });

  it("maps SSH failures to a clean error", async () => {
    const handler = createZfsStatusHandler(throwingShell("connect refused"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
  });
});
