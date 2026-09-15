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

  it("passes an abort signal to the fetch implementation", async () => {
    let seenSignal: unknown;
    const fetchImpl = async (_url: string, init: Record<string, unknown>) => {
      seenSignal = init.signal;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ data: {} }),
      } as Response;
    };

    await executeGraphQL({ endpoint: "http://x/graphql", apiKey: "k", fetchImpl }, PingDoc);

    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("maps an abort rejection to a clean timeout error", async () => {
    const fetchImpl = async () => {
      const error = new Error("This operation was aborted");
      error.name = "TimeoutError";
      throw error;
    };

    await expect(
      executeGraphQL({ endpoint: "http://x/graphql", apiKey: "k", fetchImpl }, PingDoc),
    ).rejects.toThrow(/timed out after 30000 ms/);
  });
});
