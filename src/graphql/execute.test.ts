import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { Agent } from "undici";
import { describe, expect, it } from "vitest";
import { DispatcherPool, KEEP_ALIVE_TIMEOUT_MS } from "./dispatcher-pool.js";
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

describe("executeGraphQL connection pools", () => {
  /** Records the options of each pool and the dispatcher each request was sent through. */
  function capturePools() {
    const built: Agent.Options[] = [];
    const dispatchers = new DispatcherPool((options) => {
      built.push(options);
      return new Agent(options);
    });
    const sentThrough: unknown[] = [];
    const fetchImpl = async (_url: string, init: Record<string, unknown>) => {
      sentThrough.push(init.dispatcher);
      return fakeFetch(200, { data: { online: true } })();
    };
    return { built, dispatchers, sentThrough, fetchImpl };
  }

  it("sends requests through the verifying pool by default", async () => {
    const { built, dispatchers, sentThrough, fetchImpl } = capturePools();

    await executeGraphQL(
      { endpoint: "https://x/graphql", apiKey: "k", fetchImpl, dispatchers },
      PingDoc,
    );

    expect(built).toEqual([{ keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS }]);
    expect(sentThrough).toEqual([dispatchers.for(false)]);
  });

  it("sends requests through the non-verifying pool only when allowSelfSigned is true", async () => {
    const { built, dispatchers, sentThrough, fetchImpl } = capturePools();

    await executeGraphQL(
      { endpoint: "https://x/graphql", apiKey: "k", fetchImpl, dispatchers, allowSelfSigned: true },
      PingDoc,
    );

    expect(built).toEqual([
      { keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS, connect: { rejectUnauthorized: false } },
    ]);
    expect(sentThrough).toEqual([dispatchers.for(true)]);
  });

  it("falls back to undici fetch and propagates its non-timeout failures unchanged", async () => {
    const pending = executeGraphQL({ endpoint: "not a url", apiKey: "k" }, PingDoc);

    await expect(pending).rejects.toThrow(TypeError);
    await expect(pending).rejects.not.toThrow(/timed out/);
  });
});

describe("executeGraphQL abort mapping", () => {
  it("maps an AbortError rejection to the same clean timeout error", async () => {
    const fetchImpl = async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    };

    await expect(
      executeGraphQL(
        { endpoint: "http://x/graphql", apiKey: "k", fetchImpl, timeoutMs: 5 },
        PingDoc,
      ),
    ).rejects.toThrow("Unraid API request timed out after 5 ms");
  });
});
