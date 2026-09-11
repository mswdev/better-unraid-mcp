import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ParityHistoryQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createParityHistoryHandler } from "./parity-history.js";

const history = {
  parityHistory: [
    {
      date: "2026-05-30T00:00:00Z",
      duration: 3600,
      speed: "180",
      status: "COMPLETED",
      errors: 0,
      correcting: true,
    },
    {
      date: "2026-04-30T00:00:00Z",
      duration: 3700,
      speed: "175",
      status: "COMPLETED",
      errors: 2,
      correcting: true,
    },
  ],
} satisfies ParityHistoryQuery;

const oldestFirst = {
  parityHistory: [
    {
      date: "2026-04-30T00:00:00Z",
      duration: 3700,
      speed: "175",
      status: "COMPLETED",
      errors: 9,
      correcting: true,
    },
    {
      date: "2026-05-30T00:00:00Z",
      duration: 3600,
      speed: "180",
      status: "COMPLETED",
      errors: 0,
      correcting: true,
    },
  ],
} satisfies ParityHistoryQuery;

const nullFields = {
  parityHistory: [
    {
      date: null,
      duration: null,
      speed: null,
      status: "NEVER_RUN",
      errors: null,
      correcting: null,
    },
  ],
} satisfies ParityHistoryQuery;

function fakeExecutor(result: ParityHistoryQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("parity_history handler", () => {
  it("summarizes the most recent check", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(history))({
      response_format: "concise",
      limit: 5,
    });

    expect(firstText(result)).toMatch(/COMPLETED/);
    expect(firstText(result)).toMatch(/0 errors/);
  });

  it("limits the detailed list", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(history))({
      response_format: "detailed",
      limit: 1,
    });

    const parsed = JSON.parse(firstText(result));
    expect(parsed).toHaveLength(1);
  });

  it("handles an empty history", async () => {
    const result = await createParityHistoryHandler(fakeExecutor({ parityHistory: [] }))({
      response_format: "concise",
      limit: 5,
    });

    expect(firstText(result)).toMatch(/No parity checks/);
  });

  it("reports the newest check regardless of input order", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(oldestFirst))({
      response_format: "concise",
      limit: 5,
    });

    expect(firstText(result)).toMatch(/2026-05-30/);
    expect(firstText(result)).toMatch(/0 errors/);
  });

  it("uses fallbacks for null date, speed and errors", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(nullFields))({
      response_format: "concise",
      limit: 5,
    });

    expect(firstText(result)).toMatch(/unknown/);
    expect(firstText(result)).toMatch(/0 errors/);
    expect(firstText(result)).toMatch(/unknown speed/);
  });
});

describe("parity_history speed rendering", () => {
  const preFormatted = {
    parityHistory: [
      { date: "2026-09-10T18:24:28.000Z", status: "CANCELLED", errors: 0, speed: "48.2 GB/s" },
      { date: "2026-09-09T01:00:00.000Z", status: "COMPLETED", errors: 0, speed: "180" },
    ],
  };

  it("renders pre-formatted speeds verbatim and appends MB/s only to bare numbers", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(preFormatted as never))({
      response_format: "concise",
      limit: 5,
    });

    const text = firstText(result);
    expect(text).toMatch(/48\.2 GB\/s(?! MB\/s)/);
    expect(text).toMatch(/180 MB\/s/);
  });

  it("lists every returned check in concise mode, not just the latest", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(preFormatted as never))({
      response_format: "concise",
      limit: 5,
    });

    const text = firstText(result);
    expect(text).toMatch(/Recent parity checks \(2\)/);
    expect(text).toMatch(/CANCELLED/);
    expect(text).toMatch(/COMPLETED/);
  });
});
