import { describe, expect, it } from "vitest";
import { errorMessage } from "./error-message.js";

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("connection refused"))).toBe("connection refused");
  });

  it("uses the message of Error subclasses", () => {
    expect(errorMessage(new TypeError("fetch failed"))).toBe("fetch failed");
  });

  it("stringifies a non-Error rejection value", () => {
    expect(errorMessage("socket hang up")).toBe("socket hang up");
    expect(errorMessage(503)).toBe("503");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
