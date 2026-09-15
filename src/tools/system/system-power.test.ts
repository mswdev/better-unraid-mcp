import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { createSystemPowerHandler } from "./system-power.js";

const okResult = { stdout: "", stderr: "", exitCode: 0 };

describe("system_power", () => {
  it("refuses without SSH configured", async () => {
    const handler = createSystemPowerHandler(null);

    const result = await handler({
      response_format: "concise",
      action: "reboot",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
  });

  it("refuses without both gate flags and runs nothing", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell);

    const result = await handler({ response_format: "concise", action: "reboot", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("reboots with /sbin/reboot", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell);

    const result = await handler({
      response_format: "concise",
      action: "reboot",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(calls[0].command).toBe("/sbin/reboot");
    expect(firstText(result)).toContain("going down");
  });

  it("shuts down with /sbin/poweroff", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell);

    await handler({
      response_format: "concise",
      action: "shutdown",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(calls[0].command).toBe("/sbin/poweroff");
  });

  it("treats a dropped connection after issuing as expected", async () => {
    const handler = createSystemPowerHandler(
      throwingShell("Timed out after 15000 ms trying to run the command over SSH."),
    );

    const result = await handler({
      response_format: "concise",
      action: "shutdown",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("expected");
  });

  it("reports a connect failure as a real error", async () => {
    const handler = createSystemPowerHandler(
      throwingShell("Timed out after 15000 ms trying to connect over SSH."),
    );

    const result = await handler({
      response_format: "concise",
      action: "reboot",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
  });
});

describe("system_power elicitation", () => {
  function scriptedChannel(outcome: "accepted" | "declined") {
    return {
      isAvailable: () => true,
      confirm: async () => outcome,
    };
  }

  it("issues the command when the human accepts the two-checkbox prompt", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell, scriptedChannel("accepted"));

    const result = await handler({ response_format: "concise", action: "reboot" });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("issues nothing when the human declines", async () => {
    const { shell, calls } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell, scriptedChannel("declined"));

    const result = await handler({ response_format: "concise", action: "reboot" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("system_power SSH failure classification", () => {
  it("reports an auth failure as a real error, never as issued", async () => {
    const handler = createSystemPowerHandler(
      throwingShell("All configured authentication methods failed"),
    );

    const result = await handler({
      response_format: "concise",
      action: "reboot",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("never sent");
  });

  it("reports a DNS failure as a real error", async () => {
    const handler = createSystemPowerHandler(throwingShell("getaddrinfo ENOTFOUND tower"));

    const result = await handler({
      response_format: "concise",
      action: "shutdown",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
  });
});
