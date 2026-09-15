import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { UnraidClient } from "./client.js";
import { UnraidApiError } from "./errors.js";
import type { TokenBucket } from "./rate-limit.js";

const PingDoc = parse("query Ping { online }") as unknown as TypedDocumentNode<
  { online: boolean },
  never
>;

const ArchiveDoc = parse(
  "mutation Archive { archiveAll { total } }",
) as unknown as TypedDocumentNode<{ archiveAll: { total: number } }, never>;

const serverError = { ok: false, status: 500, statusText: "Server Error" } as Response;

const okOnline = {
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => ({ data: { online: true } }),
} as unknown as Response;

function clientWith(body: unknown) {
  return new UnraidClient({
    endpoint: "http://x/graphql",
    apiKey: "k",
    allowSelfSigned: false,
    fetchImpl: async () =>
      ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response,
  });
}

describe("UnraidClient.execute", () => {
  it("returns data when the response has no errors", async () => {
    const data = await clientWith({ data: { online: true } }).execute(PingDoc);

    expect(data.online).toBe(true);
  });

  it("throws UnraidApiError when the response contains GraphQL errors", async () => {
    const client = clientWith({ errors: [{ message: "forbidden" }] });

    await expect(client.execute(PingDoc)).rejects.toThrow(UnraidApiError);
  });

  it("throws UnraidApiError when the response data is null", async () => {
    const client = clientWith({ data: null });

    await expect(client.execute(PingDoc)).rejects.toThrow(/no data/);
  });
});

describe("UnraidClient rate limiting and retry", () => {
  it("retries once after HTTP 429 and succeeds", async () => {
    const responses = [
      { ok: false, status: 429, statusText: "Too Many Requests" } as Response,
      {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ data: { online: true } }),
      } as unknown as Response,
    ];
    const client = new UnraidClient({
      endpoint: "http://x/graphql",
      apiKey: "k",
      allowSelfSigned: false,
      fetchImpl: async () => responses.shift() as Response,
      sleep: async () => {},
    });

    const data = await client.execute(PingDoc);

    expect(data).toEqual({ online: true });
  });

  it("retries a query after a 500 and succeeds", async () => {
    const responses = [serverError, okOnline];
    const client = new UnraidClient({
      endpoint: "http://x/graphql",
      apiKey: "k",
      allowSelfSigned: false,
      fetchImpl: async () => responses.shift() as Response,
      sleep: async () => {},
    });

    const data = await client.execute(PingDoc);

    expect(data).toEqual({ online: true });
  });

  it("does not retry a mutation after a 500", async () => {
    let callCount = 0;
    const client = new UnraidClient({
      endpoint: "http://x/graphql",
      apiKey: "k",
      allowSelfSigned: false,
      fetchImpl: async () => {
        callCount += 1;
        return serverError;
      },
      sleep: async () => {},
    });

    await expect(client.execute(ArchiveDoc)).rejects.toThrow(/HTTP 500/);
    expect(callCount).toBe(1);
  });

  it("does not retry a query on a GraphQL-level error", async () => {
    let callCount = 0;
    const client = new UnraidClient({
      endpoint: "http://x/graphql",
      apiKey: "k",
      allowSelfSigned: false,
      fetchImpl: async () => {
        callCount += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ errors: [{ message: "forbidden" }] }),
        } as unknown as Response;
      },
      sleep: async () => {},
    });

    await expect(client.execute(PingDoc)).rejects.toThrow(/forbidden/);
    expect(callCount).toBe(1);
  });

  it("bounds query retries at three total attempts", async () => {
    let callCount = 0;
    const client = new UnraidClient({
      endpoint: "http://x/graphql",
      apiKey: "k",
      allowSelfSigned: false,
      fetchImpl: async () => {
        callCount += 1;
        return serverError;
      },
      sleep: async () => {},
    });

    await expect(client.execute(PingDoc)).rejects.toThrow(/HTTP 500/);
    expect(callCount).toBe(3);
  });

  it("acquires a rate-limit token before each request", async () => {
    let acquires = 0;
    const fakeLimiter = {
      acquire: async () => {
        acquires += 1;
      },
    } as unknown as TokenBucket;
    const client = new UnraidClient({
      endpoint: "http://x/graphql",
      apiKey: "k",
      allowSelfSigned: false,
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ data: {} }),
        }) as unknown as Response,
      rateLimiter: fakeLimiter,
    });

    await client.execute(PingDoc);

    expect(acquires).toBe(1);
  });
});
