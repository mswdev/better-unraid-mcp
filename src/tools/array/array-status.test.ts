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
      speed: "0",
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

const stopped = {
  array: {
    state: "STOPPED",
    capacity: { kilobytes: { free: "0", used: "0", total: "0" } },
    parityCheckStatus: {
      status: "NEVER_RUN",
      progress: null,
      errors: null,
      running: false,
      paused: false,
      speed: null,
    },
    parities: [],
    disks: [
      {
        name: "disk1",
        status: null,
        temp: null,
        fsFree: null,
        fsUsed: null,
        fsSize: null,
        numErrors: null,
        isSpinning: null,
        type: "DATA",
      },
    ],
    caches: [],
  },
} satisfies ArrayStatusQuery;

const checking = {
  array: {
    ...started.array,
    parityCheckStatus: {
      status: "RUNNING",
      progress: 37,
      errors: null,
      running: null,
      paused: null,
      speed: "98",
    },
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

  it("handles a stopped array with zero capacity and null disk fields", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(stopped))({
      response_format: "concise",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/STOPPED/);
    expect(firstText(result)).toMatch(/0%/);
    expect(firstText(result)).not.toMatch(/NaN/);
    expect(firstText(result)).toMatch(/Parity: NEVER_RUN/);
  });

  it("shows progress and speed while a check is active", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(checking))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/Parity check RUNNING: 37% at 98 MB\/s/);
  });

  it("defers error counts to parity_history instead of asserting 0 errors", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/Parity: COMPLETED \(errors: see parity_history\)/);
    expect(firstText(result)).not.toMatch(/0 errors/);
  });
});
