import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "./version.js";

describe("SERVER_VERSION", () => {
  it("matches the version declared in package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
