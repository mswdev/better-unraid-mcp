import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ArrayStatusQuery } from "../../types/unraid/graphql.js";
import { captureToolConfig, firstText } from "../_shared/test-support.js";
import { createArrayStatusHandler, registerArrayStatus } from "./array-status.js";

// Array disk ids as the API returns them: server prefix + the emhttp disk id.
const PARITY_ID = "srv:WDC_WD80EFZZ-68BTXN0_WD-CA1PARITY";
const DISK1_ID = "srv:WDC_WD40EFRX-68N32N0_WD-WCC7K0DISK1";
const DISK2_ID = "srv:ST4000VN008-2DR166_ZDH0DISK2";
const CACHE_ID = "srv:Samsung_SSD_970_EVO_Plus_1TB_S4EWNX0CACHE";

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
    parities: [{ id: PARITY_ID, name: "parity", status: "DISK_OK", temp: 35, type: "PARITY" }],
    disks: [
      {
        id: DISK1_ID,
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
        id: DISK2_ID,
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
      {
        id: CACHE_ID,
        name: "cache",
        status: "DISK_OK",
        temp: 40,
        fsFree: "1",
        fsUsed: "2",
        type: "CACHE",
      },
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
        id: DISK1_ID,
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

const startingCheck = {
  array: {
    ...started.array,
    parityCheckStatus: {
      status: "RUNNING",
      progress: null,
      errors: null,
      running: true,
      paused: false,
      speed: null,
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

  it("returns detailed JSON with data_age_ms when asked", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({
      response_format: "detailed",
    });

    expect(firstText(result)).toContain('"state": "STARTED"');
    expect(JSON.parse(firstText(result)).data_age_ms).toBe(0);
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

  it("shows 0% at an unknown speed while a just-started check has no progress yet", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(startingCheck))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/Parity check RUNNING: 0% at \? MB\/s/);
  });

  it("prefixes executor failures with the tool context", async () => {
    const result = await createArrayStatusHandler(throwingExecutor("socket hang up"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to fetch array status: socket hang up");
  });
});

/** The ids of one kind of disk row, in order. */
function rowIds(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id);
}

/** The output schema array_status declares when it registers. */
function declaredOutputSchema(): z.ZodType {
  const config = captureToolConfig((server) => registerArrayStatus(server, fakeExecutor(started)));
  return config.outputSchema as z.ZodType;
}

describe("array_status disk ids", () => {
  it("includes every parity, data and cache disk id in detailed output", async () => {
    const handler = createArrayStatusHandler(fakeExecutor(started));

    const result = await handler({ response_format: "detailed" });

    const parsed = JSON.parse(firstText(result)) as ArrayStatusQuery["array"];
    expect(rowIds(parsed.parities)).toEqual([PARITY_ID]);
    expect(rowIds(parsed.disks)).toEqual([DISK1_ID, DISK2_ID]);
    expect(rowIds(parsed.caches)).toEqual([CACHE_ID]);
  });

  it("carries the disk ids in structuredContent in concise mode too", async () => {
    const handler = createArrayStatusHandler(fakeExecutor(started));

    const result = await handler({ response_format: "concise" });

    const structured = result.structuredContent as ArrayStatusQuery["array"];
    expect(rowIds(structured.parities)).toEqual([PARITY_ID]);
    expect(rowIds(structured.disks)).toEqual([DISK1_ID, DISK2_ID]);
    expect(rowIds(structured.caches)).toEqual([CACHE_ID]);
  });

  it("returns structuredContent that satisfies the declared outputSchema", async () => {
    const outputSchema = declaredOutputSchema();
    const handler = createArrayStatusHandler(fakeExecutor(started));

    const result = await handler({ response_format: "concise" });

    expect(outputSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  it("declares an outputSchema that requires an id on every disk row", () => {
    const outputSchema = declaredOutputSchema();
    const { id: _dropped, ...diskWithoutId } = started.array.disks[0];

    const parsed = outputSchema.safeParse({
      ...started.array,
      disks: [diskWithoutId],
      data_age_ms: 0,
    });

    expect(parsed.success).toBe(false);
  });
});
