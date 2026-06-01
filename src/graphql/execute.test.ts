import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { executeGraphQL } from "./execute.js";

// Minimal typed document for the test (no extra deps — build it with `parse`).
const PingDoc = parse("query Ping { online }") as unknown as TypedDocumentNode<
  { online: boolean },
  never
>;

function fakeFetch(status: number, body: unknown) {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "x",
      json: async () => body,
    }) as Response;
}

describe("executeGraphQL", () => {
  it("returns parsed data on a 200 response", async () => {
    const res = await executeGraphQL(
      {
        endpoint: "http://x/graphql",
        apiKey: "k",
        fetchImpl: fakeFetch(200, { data: { online: true } }),
      },
      PingDoc,
    );

    expect(res.data?.online).toBe(true);
  });

  it("throws on a non-2xx response", async () => {
    await expect(
      executeGraphQL(
        { endpoint: "http://x/graphql", apiKey: "k", fetchImpl: fakeFetch(401, {}) },
        PingDoc,
      ),
    ).rejects.toThrow(/401/);
  });
});
