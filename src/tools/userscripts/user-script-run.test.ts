import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { createUserScriptRunHandler } from "./user-script-run.js";

const okResult = { stdout: "done\n", stderr: "", exitCode: 0 };
const bothFlags = { confirm: true, acknowledge_risk: true } as const;

describe("user_script_run", () => {
  it("rejects names with path separators before the gate", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      response_format: "concise",
      name: "../../etc/passwd",
      timeout_seconds: 60,
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      response_format: "concise",
      name: "backup",
      timeout_seconds: 60,
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("runs the noexec-safe composed runner and reports the exit code", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      response_format: "concise",
      name: "clean cache",
      timeout_seconds: 60,
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls[0].command).toContain(
      "'/boot/config/plugins/user.scripts/scripts/clean cache/script'",
    );
    expect(calls[0].command).toContain("tr -d '\\r'");
    expect(calls[0].command).toContain('bash "$T"');
    expect(calls[0].timeoutMs).toBe(60_000);
    expect(firstText(result)).toContain("exit code 0");
  });

  it("reports a non-zero script exit faithfully, not as a tool error", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "disk full", exitCode: 3 });
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      response_format: "concise",
      name: "backup",
      timeout_seconds: 60,
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("exit code 3");
    expect(firstText(result)).toContain("disk full");
  });

  it("maps SSH failures to a clean error", async () => {
    const handler = createUserScriptRunHandler(throwingShell("Timed out"));

    const result = await handler({
      response_format: "concise",
      name: "backup",
      timeout_seconds: 60,
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
  });
});

describe("user_script_run dot-name confinement", () => {
  it('rejects "." and ".." names before the gate', async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const dot = await handler({
      response_format: "concise",
      name: ".",
      timeout_seconds: 60,
      ...bothFlags,
    });
    const dotdot = await handler({
      response_format: "concise",
      name: "..",
      timeout_seconds: 60,
      ...bothFlags,
    });

    expect(dot.isError).toBe(true);
    expect(dotdot.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
