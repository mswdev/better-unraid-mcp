import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ArrayStatusQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createArrayStatusHandler } from "./array-status.js";

const started = {
  array: {
    state: "STARTED",
    capacity: { kilobytes: { free: "40000000000", used: "60000000000", total: "100000000000" } },
    parityCheckStatus: {
      status: "COMPLETED",
      progress: 100,
      errors: 0,
      running: false,
      paused: false,
    },
    parities: [{ name: "parity", status: "DISK_OK", temp: 35, type: "PARITY" }],
    disks: [
      {
        name: "disk1",
        status: "DISK_OK",
        temp: 33,
        fsFree: "1",
        fsUsed: "2",
        fsSize: "3",
        numErrors: "0",
        isSpinning: true,
        type: "DATA",
      },
      {
        name: "disk2",
        status: "DISK_DSBL",
        temp: null,
        fsFree: "1",
        fsUsed: "2",
        fsSize: "3",
        numErrors: "5",
        isSpinning: false,
        type: "DATA",
      },
    ],
    caches: [
      { name: "cache", status: "DISK_OK", temp: 40, fsFree: "1", fsUsed: "2", type: "CACHE" },
    ],
  },
} satisfies ArrayStatusQuery;

function fakeExecutor(result: ArrayStatusQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

function throwingExecutor(message: string): GraphQLExecutor {
  return { execute: () => Promise.reject(new Error(message)) };
}

describe("array_status handler", () => {
  it("summarizes state, capacity %, parity and disk counts", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({
      response_format: "concise",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/STARTED/);
    expect(firstText(result)).toMatch(/60%/);
    expect(firstText(result)).toMatch(/1\/2 data OK/);
  });

  it("returns detailed JSON when asked", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({
      response_format: "detailed",
    });

    expect(firstText(result)).toContain('"state": "STARTED"');
  });

  it("returns an error result when the client throws", async () => {
    const result = await createArrayStatusHandler(throwingExecutor("denied"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/denied/);
  });
});
