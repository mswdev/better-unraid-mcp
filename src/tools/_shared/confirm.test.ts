import { describe, expect, it } from "vitest";
import { requireConfirmation } from "./confirm.js";
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
    expect(firstText(result!)).toMatch(/destructive/i);
  });
});
