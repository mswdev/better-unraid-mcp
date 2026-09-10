import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { UnraidClient } from "./client.js";
import { UnraidApiError } from "./errors.js";

const PingDoc = parse("query Ping { online }") as unknown as TypedDocumentNode<
  { online: boolean },
  never
>;

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
