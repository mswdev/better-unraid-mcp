import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { MAX_OUTPUT_CHARS } from "../_shared/truncate-output.js";
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

describe("user_script_run refusal names the SSH user", () => {
  const unconfirmed = {
    response_format: "concise",
    name: "backup",
    timeout_seconds: 60,
    confirm: true,
  } as const;

  it("names the configured SSH user instead of assuming root", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell, null, "scripts-bot");

    const result = await handler(unconfirmed);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('would run as the SSH user "scripts-bot" on your server');
    expect(firstText(result)).not.toContain("root");
    expect(calls).toHaveLength(0);
  });

  it("names root when root is the configured SSH user", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell, null, "root");

    const result = await handler(unconfirmed);

    expect(firstText(result)).toContain('would run as the SSH user "root" on your server');
  });

  it("falls back to neutral wording when the SSH user is not known", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler(unconfirmed);

    expect(firstText(result)).toBe(
      'Refusing to run user script "backup": user scripts are arbitrary code, and this one would run as the SSH user on your server. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.',
    );
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

describe("user_script_run oversized output", () => {
  it("keeps the newest output lines in detailed mode and stays parseable", async () => {
    const stdout = `${Array.from({ length: 4_000 }, (_, index) => `step ${index + 1}`).join("\n")}\n`;
    const { shell } = recordingShell({ stdout, stderr: "", exitCode: 0 });
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      response_format: "detailed",
      name: "backup",
      timeout_seconds: 60,
      ...bothFlags,
    });
    const text = firstText(result);
    const payload = JSON.parse(text) as { name: string; stdout: string; truncated: boolean };

    expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(payload.name).toBe("backup");
    expect(payload.stdout.endsWith("step 4000\n")).toBe(true);
    expect(payload.truncated).toBe(true);
  });
});

describe("user_script_run failure paths", () => {
  const request = {
    response_format: "concise",
    name: "backup",
    timeout_seconds: 60,
    ...bothFlags,
  } as const;

  it("reports SSH unavailable without a shell", async () => {
    const handler = createUserScriptRunHandler(null);

    const result = await handler(request);

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("prefixes SSH failures with the tool context", async () => {
    const handler = createUserScriptRunHandler(throwingShell("channel closed"));

    const result = await handler(request);

    expect(firstText(result)).toBe('Failed to run user script "backup" over SSH: channel closed');
  });
});
