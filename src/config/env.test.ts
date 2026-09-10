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

describe("loadEnv SSH configuration", () => {
  it("leaves SSH unset with defaults when no host is given", () => {
    const env = loadEnv(valid);

    expect(env.UNRAID_SSH_HOST).toBeUndefined();
    expect(env.UNRAID_SSH_PORT).toBe(22);
    expect(env.UNRAID_SSH_USER).toBe("root");
  });

  it("accepts a host with a password credential", () => {
    const env = loadEnv({ ...valid, UNRAID_SSH_HOST: "tower.local", UNRAID_SSH_PASSWORD: "pw" });

    expect(env.UNRAID_SSH_HOST).toBe("tower.local");
    expect(env.UNRAID_SSH_PASSWORD).toBe("pw");
  });

  it("accepts a host with a key path credential and custom port/user", () => {
    const env = loadEnv({
      ...valid,
      UNRAID_SSH_HOST: "tower.local",
      UNRAID_SSH_KEY_PATH: "/keys/id_ed25519",
      UNRAID_SSH_PORT: "2222",
      UNRAID_SSH_USER: "admin",
    });

    expect(env.UNRAID_SSH_KEY_PATH).toBe("/keys/id_ed25519");
    expect(env.UNRAID_SSH_PORT).toBe(2222);
    expect(env.UNRAID_SSH_USER).toBe("admin");
  });

  it("rejects a host without any credential", () => {
    expect(() => loadEnv({ ...valid, UNRAID_SSH_HOST: "tower.local" })).toThrow(
      /UNRAID_SSH_PASSWORD or UNRAID_SSH_KEY_PATH/,
    );
  });
});
