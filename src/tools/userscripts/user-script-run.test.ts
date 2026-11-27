import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import type {
  ElicitationChannel,
  ElicitationOutcome,
  ElicitationPrompt,
} from "../_shared/elicitation.js";
import {
  captureToolConfig,
  firstText,
  recordingShell,
  throwingShell,
} from "../_shared/test-support.js";
import { MAX_OUTPUT_CHARS } from "../_shared/truncate-output.js";
import {
  MAX_SCRIPT_ARGUMENTS,
  MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH,
  scriptArgumentsSchema,
} from "./script-arguments.js";
import { createUserScriptRunHandler, registerUserScriptRun } from "./user-script-run.js";

const okResult = { stdout: "done\n", stderr: "", exitCode: 0 };
const bothFlags = { confirm: true, acknowledge_risk: true } as const;

/** The exact runner a no-args call sent before `args` existed; it must never change. */
const NO_ARGS_RUNNER =
  'S=\'/boot/config/plugins/user.scripts/scripts/clean cache/script\'; if [ ! -f "$S" ]; then echo "script not found: $S" >&2; exit 127; fi; T=$(mktemp); tr -d \'\\r\' < "$S" > "$T"; bash "$T"; RC=$?; rm -f "$T"; exit $RC';

/**
 * Linux caps one argv string at MAX_ARG_STRLEN (32 pages of 4 KiB), and sshd
 * hands the whole command to `$SHELL -c` as one such string.
 */
const LINUX_MAX_ARG_STRLEN_BYTES = 131_072;

/** Channel fake answering every prompt with one scripted outcome and recording each prompt. */
function recordingChannel(outcome: ElicitationOutcome) {
  const prompts: ElicitationPrompt[] = [];
  const channel: ElicitationChannel = {
    isAvailable: () => true,
    confirm: async (prompt) => {
      prompts.push(prompt);
      return outcome;
    },
  };
  return { channel, prompts };
}

describe("user_script_run", () => {
  it("rejects names with path separators before the gate", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      response_format: "concise",
      name: "../../etc/passwd",
      args: [],
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
      args: [],
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
      args: [],
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
      args: [],
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
      args: [],
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

    const result = await handler({ ...unconfirmed, args: [] });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('would run as the SSH user "scripts-bot" on your server');
    expect(firstText(result)).not.toContain("root");
    expect(calls).toHaveLength(0);
  });

  it("names root when root is the configured SSH user", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell, null, "root");

    const result = await handler({ ...unconfirmed, args: [] });

    expect(firstText(result)).toContain('would run as the SSH user "root" on your server');
  });

  it("falls back to neutral wording when the SSH user is not known", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({ ...unconfirmed, args: [] });

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
      args: [],
      timeout_seconds: 60,
      ...bothFlags,
    });
    const dotdot = await handler({
      response_format: "concise",
      name: "..",
      args: [],
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
      args: [],
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

    const result = await handler({ ...request, args: [] });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("prefixes SSH failures with the tool context", async () => {
    const handler = createUserScriptRunHandler(throwingShell("channel closed"));

    const result = await handler({ ...request, args: [] });

    expect(firstText(result)).toBe('Failed to run user script "backup" over SSH: channel closed');
  });
});

describe("user_script_run positional arguments", () => {
  const confirmedRequest = {
    response_format: "concise",
    name: "homeserver-maintenance",
    timeout_seconds: 120,
    ...bothFlags,
  } as const;

  it("sends exactly the pre-args runner when no arguments are given", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    await handler({ ...confirmedRequest, name: "clean cache", args: [] });

    expect(calls[0].command).toBe(NO_ARGS_RUNNER);
  });

  it("treats args left out by a direct (non-MCP) caller as no arguments", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({ ...confirmedRequest, name: "clean cache" });

    expect(result.isError).toBeUndefined();
    expect(calls[0].command).toBe(NO_ARGS_RUNNER);
  });

  it("appends each argument as its own quoted word, in order, after the script", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    await handler({ ...confirmedRequest, args: ["restart", "cloudflared", "--wait", "30"] });

    expect(calls[0].command).toContain(
      `bash "$T" 'restart' 'cloudflared' '--wait' '30'; RC=$?; rm -f "$T"; exit $RC`,
    );
  });

  it("keeps shell metacharacters inside their own quoted word", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    await handler({ ...confirmedRequest, args: ["it's", "a b", "$(id); rm -rf /"] });

    expect(calls[0].command).toContain(`bash "$T" 'it'\\''s' 'a b' '$(id); rm -rf /'; RC=$?`);
  });

  it("leaves the arguments out of the concise summary", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({ ...confirmedRequest, args: ["restart", "cloudflared"] });

    expect(firstText(result)).toContain("exit code 0");
    expect(firstText(result)).not.toContain("cloudflared");
  });

  it("leaves the arguments out of the detailed output", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({
      ...confirmedRequest,
      response_format: "detailed",
      args: ["restart", "cloudflared"],
    });
    const payload = JSON.parse(firstText(result)) as Record<string, unknown>;

    expect(Object.keys(payload)).not.toContain("args");
    expect(firstText(result)).not.toContain("cloudflared");
  });

  it("stays well under Linux MAX_ARG_STRLEN for the largest arguments the bounds allow", async () => {
    const perArgument = MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH / MAX_SCRIPT_ARGUMENTS;
    const worstCase = scriptArgumentsSchema.parse(
      Array.from({ length: MAX_SCRIPT_ARGUMENTS }, () => "'".repeat(perArgument)),
    );
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    await handler({ ...confirmedRequest, args: worstCase });
    const commandBytes = Buffer.byteLength(calls[0].command, "utf8");

    expect(commandBytes).toBeLessThan(LINUX_MAX_ARG_STRLEN_BYTES);
  });
});

describe("user_script_run gate with arguments", () => {
  const unconfirmedRequest = {
    response_format: "concise",
    name: "homeserver-maintenance",
    timeout_seconds: 120,
  } as const;

  it("names the exact arguments as a JSON array in the refusal", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({ ...unconfirmedRequest, args: ["restart", "cloudflared"] });

    expect(firstText(result)).toBe(
      'Refusing to run user script "homeserver-maintenance" with arguments ["restart","cloudflared"]: user scripts are arbitrary code, and this one would run as the SSH user on your server. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.',
    );
  });

  it.each([
    { label: "confirm alone", flags: { confirm: true } },
    { label: "acknowledge_risk alone", flags: { acknowledge_risk: true } },
  ])("still refuses with $label and runs nothing", async ({ flags }) => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    const result = await handler({ ...unconfirmedRequest, args: ["restart"], ...flags });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("shows invisible characters escaped in the refusal and the prompt", async () => {
    const disguised = ["safe\u202Ehs.exe", "re\u200Bstart"];
    const shown = '["safe\\u202ehs.exe","re\\u200bstart"]';
    const { shell, calls } = recordingShell(okResult);
    const { channel, prompts } = recordingChannel("unavailable");
    const handler = createUserScriptRunHandler(shell, channel);

    const result = await handler({ ...unconfirmedRequest, args: disguised });

    expect(prompts[0].message).toContain(`with arguments ${shown}:`);
    expect(firstText(result)).toContain(`with arguments ${shown}:`);
    expect(firstText(result)).not.toContain("\u202E");
    expect(calls).toHaveLength(0);
  });

  it("still runs the arguments literally, not their escaped display form", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createUserScriptRunHandler(shell);

    await handler({ ...unconfirmedRequest, ...bothFlags, args: ["re\u200Bstart"] });

    expect(calls[0].command).toContain(`bash "$T" 're\u200Bstart'; RC=$?`);
  });

  it("shows the human the exact arguments in the confirmation prompt", async () => {
    const { shell, calls } = recordingShell(okResult);
    const { channel, prompts } = recordingChannel("declined");
    const handler = createUserScriptRunHandler(shell, channel);

    const result = await handler({ ...unconfirmedRequest, args: ["restart", "cloudflared"] });

    expect(prompts[0].message).toContain(
      'user script "homeserver-maintenance" with arguments ["restart","cloudflared"]',
    );
    expect(prompts[0].requireRiskAcknowledgement).toBe(true);
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("user_script_run input schema", () => {
  const inputSchema = captureToolConfig((server) => registerUserScriptRun(server, null))
    .inputSchema as ZodType;

  it("defaults omitted args to an empty list", () => {
    const parsed = inputSchema.parse({ name: "backup" }) as { args: string[] };

    expect(parsed.args).toEqual([]);
  });

  it("rejects too many arguments before the handler runs", () => {
    const args = Array.from({ length: MAX_SCRIPT_ARGUMENTS + 1 }, () => "x");

    const parsed = inputSchema.safeParse({ name: "backup", args });

    expect(parsed.success).toBe(false);
  });
});
