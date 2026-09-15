import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { createMoverActionHandler } from "./mover-action.js";

const okResult = { stdout: "", stderr: "", exitCode: 0 };

describe("mover_action", () => {
  it("refuses without SSH configured", async () => {
    const handler = createMoverActionHandler(null);

    const result = await handler({ response_format: "concise", action: "start", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("refuses without confirm and runs nothing", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createMoverActionHandler(shell);

    const result = await handler({ response_format: "concise", action: "start" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("starts the mover with the explicit start argument", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createMoverActionHandler(shell);

    const result = await handler({ response_format: "concise", action: "start", confirm: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/usr/local/sbin/mover start");
    expect(firstText(result)).toContain("start requested");
  });

  it("stops the mover and warns about partial files", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createMoverActionHandler(shell);

    const result = await handler({ response_format: "concise", action: "stop", confirm: true });

    expect(calls[0].command).toBe("/usr/local/sbin/mover stop");
    expect(firstText(result)).toContain("partial files");
  });

  it("reports a non-zero exit with the command output", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "mover: already running", exitCode: 1 });
    const handler = createMoverActionHandler(shell);

    const result = await handler({ response_format: "concise", action: "start", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("already running");
  });

  it("maps SSH failures to a clean error", async () => {
    const handler = createMoverActionHandler(throwingShell("connect ECONNREFUSED"));

    const result = await handler({ response_format: "concise", action: "start", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ECONNREFUSED");
  });
});
