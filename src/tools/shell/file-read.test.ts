import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { buildReadCommand, createFileReadHandler } from "./file-read.js";

const ok = { stdout: "line one\nline two\n", stderr: "", exitCode: 0 };

describe("buildReadCommand", () => {
  it("builds a quoted tail for a plain read", () => {
    const command = buildReadCommand({
      response_format: "concise",
      path: "/boot/logs/syslog-previous",
      lines: 200,
    });

    expect(command).toBe("tail -n 200 -- '/boot/logs/syslog-previous'");
  });

  it("escapes single quotes in the path so metacharacters are inert", () => {
    const command = buildReadCommand({
      response_format: "concise",
      path: "/tmp/it's; rm -rf /",
      lines: 10,
    });

    expect(command).toBe(`tail -n 10 -- '/tmp/it'\\''s; rm -rf /'`);
  });

  it("pipes grep into tail under pipefail when a pattern is given", () => {
    const command = buildReadCommand({
      response_format: "concise",
      path: "/var/log/syslog",
      lines: 50,
      pattern: "oops|BUG",
    });

    expect(command).toBe(
      "set -o pipefail; grep -E -e 'oops|BUG' -- '/var/log/syslog' | tail -n 50",
    );
  });
});

describe("file_read", () => {
  it("refuses with configuration guidance when SSH is not set up", async () => {
    const handler = createFileReadHandler(null);

    const result = await handler({ response_format: "concise", path: "/etc/hosts", lines: 10 });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("UNRAID_SSH_HOST");
  });

  it("rejects relative paths before running anything", async () => {
    const { shell, calls } = recordingShell(ok);
    const handler = createFileReadHandler(shell);

    const result = await handler({ response_format: "concise", path: "etc/hosts", lines: 10 });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("returns the file tail with a header on success", async () => {
    const { shell, calls } = recordingShell(ok);
    const handler = createFileReadHandler(shell);

    const result = await handler({ response_format: "concise", path: "/etc/hosts", lines: 10 });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("line one\nline two");
    expect(calls[0]?.command).toBe("tail -n 10 -- '/etc/hosts'");
  });

  it("reports grep exit 1 as no matches, not an error", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 1 });
    const handler = createFileReadHandler(shell);

    const result = await handler({
      response_format: "concise",
      path: "/var/log/syslog",
      lines: 10,
      pattern: "nomatch",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("No lines");
  });

  it("surfaces non-zero exits with stderr as a tool error", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "tail: cannot open", exitCode: 2 });
    const handler = createFileReadHandler(shell);

    const result = await handler({ response_format: "concise", path: "/nope", lines: 10 });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("tail: cannot open");
  });

  it("describes an empty file explicitly", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 0 });
    const handler = createFileReadHandler(shell);

    const result = await handler({ response_format: "concise", path: "/empty", lines: 10 });

    expect(firstText(result)).toContain("is empty");
  });

  it("returns structured JSON in detailed format", async () => {
    const { shell } = recordingShell(ok);
    const handler = createFileReadHandler(shell);

    const result = await handler({ response_format: "detailed", path: "/etc/hosts", lines: 10 });

    const payload = JSON.parse(firstText(result));
    expect(payload).toMatchObject({ path: "/etc/hosts", exit_code: 0 });
  });

  it("maps transport failures to a tool error", async () => {
    const handler = createFileReadHandler(throwingShell("connect ECONNREFUSED"));

    const result = await handler({ response_format: "concise", path: "/etc/hosts", lines: 10 });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ECONNREFUSED");
  });
});
