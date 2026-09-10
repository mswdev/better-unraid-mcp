import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { createShellExecHandler } from "./shell-exec.js";

const ok = { stdout: "hello\n", stderr: "", exitCode: 0 };
const DEFAULT_TIMEOUT_MS = 30_000;

describe("shell_exec", () => {
  it("refuses with configuration guidance when SSH is not set up", async () => {
    const handler = createShellExecHandler(null);

    const result = await handler({
      response_format: "concise",
      command: "uptime",
      timeout_seconds: 30,
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("UNRAID_SSH_HOST");
  });

  it("refuses without confirm and never runs the command", async () => {
    const { shell, calls } = recordingShell(ok);
    const handler = createShellExecHandler(shell);

    const result = await handler({
      response_format: "concise",
      command: "reboot",
      timeout_seconds: 30,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('"confirm": true');
    expect(calls).toHaveLength(0);
  });

  it("runs the confirmed command with the default timeout in milliseconds", async () => {
    const { shell, calls } = recordingShell(ok);
    const handler = createShellExecHandler(shell);

    const result = await handler({
      response_format: "concise",
      command: "uptime",
      timeout_seconds: 30,
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(calls[0]).toEqual({ command: "uptime", timeoutMs: DEFAULT_TIMEOUT_MS });
    expect(firstText(result)).toContain("hello");
  });

  it("reports a non-zero exit code as a result, not an error", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "not found\n", exitCode: 127 });
    const handler = createShellExecHandler(shell);

    const result = await handler({
      response_format: "concise",
      command: "nope",
      timeout_seconds: 30,
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("Exit code 127");
    expect(firstText(result)).toContain("not found");
  });

  it("says so when the command produced no output", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 0 });
    const handler = createShellExecHandler(shell);

    const result = await handler({
      response_format: "concise",
      command: "true",
      timeout_seconds: 30,
      confirm: true,
    });

    expect(firstText(result)).toContain("(no output)");
  });

  it("returns structured JSON in detailed format", async () => {
    const { shell } = recordingShell(ok);
    const handler = createShellExecHandler(shell);

    const result = await handler({
      response_format: "detailed",
      command: "uptime",
      timeout_seconds: 45,
      confirm: true,
    });

    const payload = JSON.parse(firstText(result));
    expect(payload).toMatchObject({ command: "uptime", exit_code: 0, stdout: "hello\n" });
  });

  it("maps transport failures to a tool error", async () => {
    const handler = createShellExecHandler(throwingShell("Timed out after 30000 ms"));

    const result = await handler({
      response_format: "concise",
      command: "sleep 999",
      timeout_seconds: 30,
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Timed out");
  });
});
