import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import {
  requireConfirmation,
  requireConfirmationInteractive,
  requireRiskAcknowledgement,
  requireRiskAcknowledgementInteractive,
} from "./confirm.js";
import type { ElicitationChannel, ElicitationOutcome } from "./elicitation.js";
import { firstText } from "./test-support.js";

describe("requireConfirmation", () => {
  it("returns null when confirm is true", () => {
    expect(requireConfirmation(true, "stop the array")).toBeNull();
  });

  it("returns an error result when confirm is not true", () => {
    const result = requireConfirmation(undefined, "stop the array");

    expect(result).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by the assertion above.
    expect(result!.isError).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: guarded by the assertion above.
    expect(firstText(result!)).toMatch(/requires confirmation/i);
  });
});

describe("requireRiskAcknowledgement", () => {
  it("returns null when both flags are true", () => {
    const refusal = requireRiskAcknowledgement(
      { confirm: true, acknowledge_risk: true },
      "Refusing to do the risky thing.",
    );

    expect(refusal).toBeNull();
  });

  it("refuses with the given message when confirm is missing", () => {
    const refusal = requireRiskAcknowledgement(
      { acknowledge_risk: true },
      "Refusing to do the risky thing.",
    );

    expect(refusal?.isError).toBe(true);
    expect(firstText(refusal as CallToolResult)).toBe("Refusing to do the risky thing.");
  });

  it("refuses when acknowledge_risk is missing", () => {
    const refusal = requireRiskAcknowledgement({ confirm: true }, "Refusing.");

    expect(refusal?.isError).toBe(true);
  });

  it("refuses when both flags are false", () => {
    const refusal = requireRiskAcknowledgement(
      { confirm: false, acknowledge_risk: false },
      "Refusing.",
    );

    expect(refusal?.isError).toBe(true);
  });
});

/** Channel fake with a scripted outcome, recording each prompt. */
function fakeChannel(outcome: ElicitationOutcome | "absent") {
  const prompts: Array<{ message: string; requireRiskAcknowledgement: boolean }> = [];
  const channel: ElicitationChannel = {
    isAvailable: () => outcome !== "absent",
    confirm: async (prompt) => {
      prompts.push(prompt);
      return outcome === "absent" ? "unavailable" : outcome;
    },
  };
  return { channel, prompts };
}

describe("requireConfirmationInteractive", () => {
  it("passes on an explicit confirm argument without asking", async () => {
    const { channel, prompts } = fakeChannel("accepted");

    const refusal = await requireConfirmationInteractive({
      confirm: true,
      actionDescription: "restart container plex",
      channel,
    });

    expect(refusal).toBeNull();
    expect(prompts).toHaveLength(0);
  });

  it("passes when the human accepts the prompt", async () => {
    const { channel, prompts } = fakeChannel("accepted");

    const refusal = await requireConfirmationInteractive({
      actionDescription: "restart container plex",
      channel,
    });

    expect(refusal).toBeNull();
    expect(prompts[0].message).toContain("restart container plex");
    expect(prompts[0].requireRiskAcknowledgement).toBe(false);
  });

  it("refuses when the human declines", async () => {
    const { channel } = fakeChannel("declined");

    const refusal = await requireConfirmationInteractive({
      actionDescription: "restart container plex",
      channel,
    });

    expect(refusal?.isError).toBe(true);
    expect(firstText(refusal as CallToolResult)).toContain("declined");
  });

  it("falls back to the argument refusal when elicitation fails mid-flight", async () => {
    const { channel } = fakeChannel("unavailable");

    const refusal = await requireConfirmationInteractive({
      actionDescription: "restart container plex",
      channel,
    });

    expect(refusal?.isError).toBe(true);
    expect(firstText(refusal as CallToolResult)).toMatch(/requires confirmation/i);
  });

  it("falls back to the argument refusal without a channel", async () => {
    const refusal = await requireConfirmationInteractive({
      actionDescription: "restart container plex",
      channel: null,
    });

    expect(firstText(refusal as CallToolResult)).toMatch(/requires confirmation/i);
  });
});

describe("requireRiskAcknowledgementInteractive", () => {
  const refusalMessage = 'Refusing to reboot. Re-call with "confirm": true. No changes were made.';

  it("passes on explicit flags without asking", async () => {
    const { channel, prompts } = fakeChannel("accepted");

    const refusal = await requireRiskAcknowledgementInteractive({
      flags: { confirm: true, acknowledge_risk: true },
      refusalMessage,
      channel,
    });

    expect(refusal).toBeNull();
    expect(prompts).toHaveLength(0);
  });

  it("passes a two-checkbox prompt carrying the blast-radius copy", async () => {
    const { channel, prompts } = fakeChannel("accepted");

    const refusal = await requireRiskAcknowledgementInteractive({
      flags: {},
      refusalMessage,
      channel,
    });

    expect(refusal).toBeNull();
    expect(prompts[0].message).toBe(refusalMessage);
    expect(prompts[0].requireRiskAcknowledgement).toBe(true);
  });

  it("refuses when the human declines", async () => {
    const { channel } = fakeChannel("declined");

    const refusal = await requireRiskAcknowledgementInteractive({
      flags: {},
      refusalMessage,
      channel,
    });

    expect(firstText(refusal as CallToolResult)).toContain("declined");
  });

  it("falls back to the exact argument refusal copy when unavailable", async () => {
    const { channel } = fakeChannel("unavailable");

    const refusal = await requireRiskAcknowledgementInteractive({
      flags: {},
      refusalMessage,
      channel,
    });

    expect(firstText(refusal as CallToolResult)).toBe(refusalMessage);
  });
});
