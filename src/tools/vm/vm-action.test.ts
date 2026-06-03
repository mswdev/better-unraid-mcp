import { describe, expect, it } from "vitest";
import { stripServerPrefix } from "./vm-action.js";

describe("stripServerPrefix", () => {
  it("strips a server-id prefix when there are exactly two colon parts", () => {
    expect(stripServerPrefix("srv:4dea22b3")).toBe("4dea22b3");
  });

  it("returns a bare id (no colon) unchanged", () => {
    expect(stripServerPrefix("4dea22b3")).toBe("4dea22b3");
  });

  it("recovers the id even when the server id is empty", () => {
    expect(stripServerPrefix(":4dea22b3")).toBe("4dea22b3");
  });

  it("leaves a value with more than two parts unchanged", () => {
    expect(stripServerPrefix("a:b:c")).toBe("a:b:c");
  });
});
