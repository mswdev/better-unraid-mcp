import { afterEach, describe, expect, it } from "vitest";
import { clearSecretValues, redactSecrets, registerSecretValues } from "./redact.js";

afterEach(() => {
  clearSecretValues();
});

describe("redactSecrets", () => {
  it("returns text without secrets unchanged", () => {
    expect(redactSecrets("array is healthy, 3 disks spinning")).toBe(
      "array is healthy, 3 disks spinning",
    );
  });

  it("removes registered secret values wherever they appear", () => {
    registerSecretValues(["s3cr3t-api-key"]);

    const result = redactSecrets("header x-api-key: s3cr3t-api-key was sent");

    expect(result).not.toContain("s3cr3t-api-key");
    expect(result).toContain("[redacted]");
  });

  it("ignores undefined and empty registered values", () => {
    registerSecretValues([undefined, ""]);

    expect(redactSecrets("nothing to hide")).toBe("nothing to hide");
  });

  it("masks key-value shapes for sensitive key names", () => {
    const result = redactSecrets('{"apiKey": "abc123", "password": "hunter2"}');

    expect(result).not.toContain("abc123");
    expect(result).not.toContain("hunter2");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("masks env-style assignments", () => {
    const result = redactSecrets("UNRAID_SSH_PASSWORD=hunter2 exported");

    expect(result).not.toContain("hunter2");
  });

  it("masks JWT-shaped strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P";

    expect(redactSecrets(`token was ${jwt}`)).not.toContain(jwt);
  });
});
