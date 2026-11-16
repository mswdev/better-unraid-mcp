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

describe("system_power response_format", () => {
  const confirmed = { confirm: true, acknowledge_risk: true } as const;
  const droppedMidCommand = "Timed out after 15000 ms trying to run the command over SSH.";

  it("keeps the concise initiated text for a command that exits 0", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell);

    const result = await handler({ ...confirmed, response_format: "concise", action: "shutdown" });

    expect(firstText(result)).toBe(
      "Shutdown initiated — the server is going down now and this connection will drop. Unraid stops the array cleanly on the way down.",
    );
  });

  it("returns detailed JSON with the outcome for a command that exits 0", async () => {
    const { shell } = recordingShell(okResult);
    const handler = createSystemPowerHandler(shell);

    const result = await handler({ ...confirmed, response_format: "detailed", action: "reboot" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({
      requested: "reboot",
      command: "/sbin/reboot",
      outcome: "initiated",
    });
  });

  it("keeps the concise issued text when the connection drops mid-command", async () => {
    const handler = createSystemPowerHandler(throwingShell(droppedMidCommand));

    const result = await handler({ ...confirmed, response_format: "concise", action: "reboot" });

    expect(firstText(result)).toBe(
      "The reboot command was issued, then the SSH connection dropped — expected while the server goes down. Verify with connection_doctor once the server should be back.",
    );
  });

  it("returns detailed JSON marked issued-unverified when the connection drops", async () => {
    const handler = createSystemPowerHandler(throwingShell(droppedMidCommand));

    const result = await handler({ ...confirmed, response_format: "detailed", action: "shutdown" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({
      requested: "shutdown",
      command: "/sbin/poweroff",
      outcome: "issued-unverified",
      sshMessage: droppedMidCommand,
    });
  });

  it("keeps a never-sent failure as error text in detailed mode", async () => {
    const handler = createSystemPowerHandler(throwingShell("handshake failed"));

    const result = await handler({ ...confirmed, response_format: "detailed", action: "reboot" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      "Failed to reboot: the command was never sent — SSH failed first: handshake failed",
    );
  });
});

describe("system_power command failures", () => {
  const confirmed = { response_format: "concise", confirm: true, acknowledge_risk: true } as const;

  it("surfaces a non-zero exit with its stderr", async () => {
    const { shell } = recordingShell({
      stdout: "",
      stderr: "reboot: must be superuser\n",
      exitCode: 1,
    });
    const handler = createSystemPowerHandler(shell);

    const result = await handler({ ...confirmed, action: "reboot" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("reboot failed (exit 1): reboot: must be superuser");
  });

  it("says so when a failed power command produced no error output", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 1 });
    const handler = createSystemPowerHandler(shell);

    const result = await handler({ ...confirmed, action: "shutdown" });

    expect(firstText(result)).toBe("shutdown failed (exit 1): (no error output)");
  });

  it("reports an SSH failure before sending as a command that was never sent", async () => {
    const handler = createSystemPowerHandler(throwingShell("handshake failed"));

    const result = await handler({ ...confirmed, action: "reboot" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      "Failed to reboot: the command was never sent — SSH failed first: handshake failed",
    );
  });
});
