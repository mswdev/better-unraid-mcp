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
});
