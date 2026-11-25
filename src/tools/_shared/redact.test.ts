import { afterEach, describe, expect, it } from "vitest";
import {
  clearSecretValues,
  redactSecrets,
  registerSecretValues,
  stringifyRedacted,
} from "./redact.js";

afterEach(() => {
  clearSecretValues();
});

/** Long enough that a quadratic pattern takes about a minute (it took 1.4 s at 30k). */
const LONG_RUN_CHARS = 200_000;

/** Generous ceiling for a linear pass over LONG_RUN_CHARS, so the test is not flaky. */
const MAX_LINEAR_REDACTION_MS = 1_000;

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

describe("redactSecrets idempotence", () => {
  it("changes nothing on a second pass, even when a secret is part of the marker", () => {
    registerSecretValues(["red", "acted"]);

    const once = redactSecrets("red acted TOKEN=red");

    expect(once).toBe('[redacted] [redacted] TOKEN="[redacted]"');
    expect(redactSecrets(once)).toBe(once);
  });

  it("still redacts a JWT after a space, a quote or an equals sign", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P";

    const result = redactSecrets(`Bearer ${jwt} "${jwt}" jwt=${jwt}`);

    expect(result).not.toContain(jwt);
  });
});

describe("redactSecrets performance", () => {
  it("stays linear on a long unbroken run of word characters", () => {
    const run = "o".repeat(LONG_RUN_CHARS);

    const started = performance.now();
    const result = redactSecrets(run);

    expect(result).toBe(run);
    expect(performance.now() - started).toBeLessThan(MAX_LINEAR_REDACTION_MS);
  });

  it("stays linear on a long run of eyJ- fragments", () => {
    const run = "eyJ-".repeat(LONG_RUN_CHARS / "eyJ-".length);

    const started = performance.now();
    redactSecrets(run);

    expect(performance.now() - started).toBeLessThan(MAX_LINEAR_REDACTION_MS);
  });

  it("still finds a credential key at the end of a long run", () => {
    const text = `${"o".repeat(LONG_RUN_CHARS)}_PASSWORD=hunter2`;

    expect(redactSecrets(text)).not.toContain("hunter2");
  });
});

describe("stringifyRedacted", () => {
  it("redacts an env-style secret inside a string value and stays valid JSON", () => {
    const serialized = stringifyRedacted({ stdout: 'PASSWORD="hunter2"\nnext line\n' });

    const parsed = JSON.parse(serialized) as { stdout: string };
    expect(serialized).not.toContain("hunter2");
    expect(parsed.stdout).toBe('PASSWORD="[redacted]"\nnext line\n');
  });

  it("redacts a JSON credential member embedded in a string value", () => {
    const serialized = stringifyRedacted({ stdout: '{"token":"abc123"}' });

    expect(serialized).not.toContain("abc123");
    expect(JSON.parse(serialized)).toEqual({ stdout: '{"token":"[redacted]"}' });
  });

  it("replaces every scalar under a credential-named key and keeps other fields", () => {
    const value = { token: "abc", count: 3, nested: { password: 42, apiKey: true } };

    const parsed = JSON.parse(stringifyRedacted(value));

    expect(parsed).toEqual({
      token: "[redacted]",
      count: 3,
      nested: { password: "[redacted]", apiKey: "[redacted]" },
    });
  });

  it("keeps null under a credential-named key, since it carries no secret", () => {
    expect(JSON.parse(stringifyRedacted({ token: null }))).toEqual({ token: null });
  });

  it("omits an undefined credential field the way JSON.stringify does", () => {
    expect(stringifyRedacted({ token: undefined, ok: true })).toBe('{"ok":true}');
  });

  it("walks into an object or array under a credential-named key instead of breaking it", () => {
    registerSecretValues(["s3cr3t-api-key"]);
    const value = { secret: { note: "s3cr3t-api-key" }, token: ["s3cr3t-api-key"] };

    const parsed = JSON.parse(stringifyRedacted(value));

    expect(parsed).toEqual({ secret: { note: "[redacted]" }, token: ["[redacted]"] });
  });

  it("redacts credential keys that contain dots, spaces or colons", () => {
    const value = {
      "x.password": "hunter2",
      "Admin Password": "hunter2",
      "db:token": "hunter2",
      labels: { "com.example.api-key": "hunter2" },
    };

    expect(stringifyRedacted(value)).not.toContain("hunter2");
  });

  it("redacts a registered secret used as an object key", () => {
    registerSecretValues(["s3cr3t-api-key"]);

    const serialized = stringifyRedacted({ keys: { "s3cr3t-api-key": { name: "mcp" } } });

    expect(serialized).not.toContain("s3cr3t-api-key");
    expect(JSON.parse(serialized)).toEqual({ keys: { "[redacted]": { name: "mcp" } } });
  });

  it("indents like JSON.stringify when given an indent", () => {
    expect(stringifyRedacted({ a: 1 }, 2)).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
});
