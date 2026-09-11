import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ShareListQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createShareListHandler } from "./share-list.js";

const shares = {
  shares: [
    {
      name: "appdata",
      free: "10000000",
      used: "5000000",
      size: "15000000",
      cache: true,
      include: [],
      exclude: [],
      comment: null,
    },
    {
      name: "media",
      free: "1000000000",
      used: "9000000000",
      size: "10000000000",
      cache: false,
      include: [],
      exclude: [],
      comment: null,
    },
  ],
} satisfies ShareListQuery;

const unnamedShare = {
  shares: [
    {
      name: null,
      free: "1",
      used: "1",
      size: "1",
      cache: false,
      include: [],
      exclude: [],
      comment: null,
    },
  ],
} satisfies ShareListQuery;

function fakeExecutor(result: ShareListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("share_list handler", () => {
  it("summarizes each share with humanized used/total", async () => {
    const result = await createShareListHandler(fakeExecutor(shares))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/appdata/);
    expect(firstText(result)).toMatch(/media — 8\.4 TB used of 9\.3 TB \(953\.7 GB free\)/);
  });

  it("filters by name when provided", async () => {
    const result = await createShareListHandler(fakeExecutor(shares))({
      response_format: "concise",
      name: "media",
    });

    expect(firstText(result)).toMatch(/media/);
    expect(firstText(result)).not.toMatch(/appdata/);
  });

  it("handles no shares", async () => {
    const result = await createShareListHandler(fakeExecutor({ shares: [] }))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/No shares/);
  });

  it("returns the no-shares message when the name filter matches nothing", async () => {
    const result = await createShareListHandler(fakeExecutor(shares))({
      response_format: "concise",
      name: "nonexistent",
    });

    expect(firstText(result)).toMatch(/No shares/);
  });

  it("renders (unnamed) for a null share name", async () => {
    const result = await createShareListHandler(fakeExecutor(unnamedShare))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/\(unnamed\)/);
  });
});
