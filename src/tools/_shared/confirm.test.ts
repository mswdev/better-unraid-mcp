import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { requireConfirmation, requireRiskAcknowledgement } from "./confirm.js";
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
