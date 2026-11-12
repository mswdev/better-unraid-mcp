import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { SystemMetricsDocument } from "../types/unraid/graphql.js";
import type { GraphQLExecutor } from "./client.js";
import { CachingExecutor, cacheAgeMs, SNAPSHOT_TTL_MS } from "./snapshot-cache.js";

const HotDoc = parse("query Hot { a }") as unknown as TypedDocumentNode<
  { a: number },
  { v?: string }
>;
const ColdDoc = parse("query Cold { b }") as unknown as TypedDocumentNode<{ b: number }, never>;

function countingInner() {
  let calls = 0;
  const inner: GraphQLExecutor = {
    execute: async () => {
      calls += 1;
      return { a: calls } as never;
    },
  };
  return { inner, callCount: () => calls };
}

function cacheWith(inner: GraphQLExecutor, now: () => number) {
  return new CachingExecutor(inner, { now, documents: new Set([HotDoc]) });
}

describe("CachingExecutor", () => {
  it("serves a second call within the TTL from cache", async () => {
    const { inner, callCount } = countingInner();
    let nowMs = 0;
    const executor = cacheWith(inner, () => nowMs);

    const first = await executor.execute(HotDoc);
    nowMs = 2_000;
    const second = await executor.execute(HotDoc);

    expect(callCount()).toBe(1);
    expect(second).toBe(first);
    expect(cacheAgeMs(second)).toBe(2_000);
  });

  it("refetches after the TTL expires", async () => {
    const { inner, callCount } = countingInner();
    let nowMs = 0;
    const executor = cacheWith(inner, () => nowMs);

    await executor.execute(HotDoc);
    nowMs = SNAPSHOT_TTL_MS + 1;
    await executor.execute(HotDoc);

    expect(callCount()).toBe(2);
  });

  it("never caches documents outside the allow-list", async () => {
    const { inner, callCount } = countingInner();
    const executor = cacheWith(inner, () => 0);

    await executor.execute(ColdDoc);
    await executor.execute(ColdDoc);

    expect(callCount()).toBe(2);
  });

  it("keys the cache by variables", async () => {
    const { inner, callCount } = countingInner();
    const executor = cacheWith(inner, () => 0);

    await executor.execute(HotDoc, { v: "one" });
    await executor.execute(HotDoc, { v: "two" });
    await executor.execute(HotDoc, { v: "one" });

    expect(callCount()).toBe(2);
  });

  it("reports zero age for freshly fetched data", async () => {
    const { inner } = countingInner();
    const executor = cacheWith(inner, () => 0);

    const data = await executor.execute(HotDoc);

    expect(cacheAgeMs(data)).toBe(0);
  });

  it("reports undefined age for data it never served", () => {
    expect(cacheAgeMs({ unrelated: true })).toBeUndefined();
  });
});

describe("CachingExecutor defaults and invalidation", () => {
  const ArchiveDoc = parse("mutation Archive { archiveAll }") as unknown as TypedDocumentNode<
    { archiveAll: boolean },
    never
  >;

  it("caches the default hot documents on the system clock when built without options", async () => {
    const { inner, callCount } = countingInner();
    const executor = new CachingExecutor(inner);

    await executor.execute(SystemMetricsDocument, { includeTemperature: false });
    await executor.execute(SystemMetricsDocument, { includeTemperature: false });

    expect(callCount()).toBe(1);
  });

  it("drops every snapshot after a mutation so the follow-up read is live", async () => {
    const { inner, callCount } = countingInner();
    const executor = cacheWith(inner, () => 0);

    await executor.execute(HotDoc);
    await executor.execute(ArchiveDoc);
    await executor.execute(HotDoc);

    expect(callCount()).toBe(3);
  });

  it("keeps snapshots across an uncached query", async () => {
    const { inner, callCount } = countingInner();
    const executor = cacheWith(inner, () => 0);

    await executor.execute(HotDoc);
    await executor.execute(ColdDoc);
    await executor.execute(HotDoc);

    expect(callCount()).toBe(2);
  });

  it("reports undefined age for non-object payloads", () => {
    expect(cacheAgeMs(42)).toBeUndefined();
    expect(cacheAgeMs(null)).toBeUndefined();
  });
});
