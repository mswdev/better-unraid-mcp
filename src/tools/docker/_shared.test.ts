import { describe, expect, it } from "vitest";
import { stripLeadingSlash } from "./_shared.js";

describe("stripLeadingSlash", () => {
  it("removes a single leading slash", () => {
    expect(stripLeadingSlash("/plex")).toBe("plex");
  });

  it("leaves an unprefixed name unchanged", () => {
    expect(stripLeadingSlash("plex")).toBe("plex");
  });

  it("strips only the first slash", () => {
    expect(stripLeadingSlash("//weird")).toBe("/weird");
  });

  it("returns the fallback for undefined", () => {
    expect(stripLeadingSlash(undefined, "(unnamed)")).toBe("(unnamed)");
  });
});
