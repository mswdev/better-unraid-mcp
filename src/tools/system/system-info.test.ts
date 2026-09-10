import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { SystemInfoQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createSystemInfoHandler } from "./system-info.js";

const sample = {
  info: {
    time: "2026-05-31T00:00:00Z",
    os: {
      platform: "linux",
      distro: "Unraid",
      release: "7.2.0",
      kernel: "6.6.0",
      uptime: "2026-05-20T00:00:00Z",
      hostname: "tower",
    },
    cpu: { manufacturer: "AMD", brand: "Ryzen 9 5950X", cores: 16, threads: 32 },
  },
} satisfies SystemInfoQuery;

const allNull = {
  info: {
    time: "2026-05-31T00:00:00Z",
    os: {
      platform: null,
      distro: null,
      release: null,
      kernel: null,
      uptime: null,
      hostname: null,
    },
    cpu: { manufacturer: null, brand: null, cores: null, threads: null },
  },
} satisfies SystemInfoQuery;

function fakeExecutor(result: SystemInfoQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("system_info handler", () => {
  it("returns a concise summary mentioning the distro and CPU", async () => {
    const handler = createSystemInfoHandler(fakeExecutor(sample));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Unraid/);
    expect(firstText(result)).toMatch(/Ryzen 9 5950X/);
  });

  it("returns full JSON for the detailed format", async () => {
    const handler = createSystemInfoHandler(fakeExecutor(sample));

    const result = await handler({ response_format: "detailed" });

    expect(firstText(result)).toContain('"kernel": "6.6.0"');
  });

  it("uses fallbacks when os and cpu fields are null", async () => {
    const handler = createSystemInfoHandler(fakeExecutor(allNull));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Unraid/);
    expect(firstText(result)).toMatch(/\?C\/\?T/);
  });

  it("returns an error result when the client throws", async () => {
    const handler = createSystemInfoHandler(throwingExecutor("unauthorized"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/unauthorized/);
  });

  it("coerces a non-Error rejection into the error message", async () => {
    const handler = createSystemInfoHandler(rejectingExecutor("boom-string"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom-string/);
  });
});
