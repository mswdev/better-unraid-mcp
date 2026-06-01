import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { GetSystemInfoQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createGetSystemInfoHandler } from "./get-system-info.js";

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
} satisfies GetSystemInfoQuery;

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
} satisfies GetSystemInfoQuery;

function fakeExecutor(result: GetSystemInfoQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

function throwingExecutor(message: string): GraphQLExecutor {
  return {
    execute: async () => {
      throw new Error(message);
    },
  };
}

function rejectingExecutor(reason: unknown): GraphQLExecutor {
  return { execute: () => Promise.reject(reason) };
}

describe("get_system_info handler", () => {
  it("returns a concise summary mentioning the distro and CPU", async () => {
    const handler = createGetSystemInfoHandler(fakeExecutor(sample));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Unraid/);
    expect(firstText(result)).toMatch(/Ryzen 9 5950X/);
  });

  it("returns full JSON for the detailed format", async () => {
    const handler = createGetSystemInfoHandler(fakeExecutor(sample));

    const result = await handler({ response_format: "detailed" });

    expect(firstText(result)).toContain('"kernel": "6.6.0"');
  });

  it("uses fallbacks when os and cpu fields are null", async () => {
    const handler = createGetSystemInfoHandler(fakeExecutor(allNull));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Unraid/);
    expect(firstText(result)).toMatch(/\?C\/\?T/);
  });

  it("returns an error result when the client throws", async () => {
    const handler = createGetSystemInfoHandler(throwingExecutor("unauthorized"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/unauthorized/);
  });

  it("coerces a non-Error rejection into the error message", async () => {
    const handler = createGetSystemInfoHandler(rejectingExecutor("boom-string"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom-string/);
  });
});
