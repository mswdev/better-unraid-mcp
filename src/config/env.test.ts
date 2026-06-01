import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const valid = {
  UNRAID_API_URL: "https://tower.local/graphql",
  UNRAID_API_KEY: "secret-key",
};

describe("loadEnv", () => {
  it("parses a valid environment with defaults applied", () => {
    const env = loadEnv(valid);

    expect(env.UNRAID_API_URL).toBe("https://tower.local/graphql");
    expect(env.MCP_TRANSPORT).toBe("stdio");
    expect(env.MCP_HTTP_PORT).toBe(3000);
    expect(env.UNRAID_ALLOW_SELF_SIGNED).toBe(false);
  });

  it("coerces UNRAID_ALLOW_SELF_SIGNED to a boolean", () => {
    const env = loadEnv({ ...valid, UNRAID_ALLOW_SELF_SIGNED: "true" });

    expect(env.UNRAID_ALLOW_SELF_SIGNED).toBe(true);
  });

  it("throws a descriptive error when the API key is missing", () => {
    expect(() => loadEnv({ UNRAID_API_URL: valid.UNRAID_API_URL })).toThrow(/UNRAID_API_KEY/);
  });

  it("throws when the URL is not a valid URL", () => {
    expect(() => loadEnv({ ...valid, UNRAID_API_URL: "tower.local" })).toThrow(/UNRAID_API_URL/);
  });
});
