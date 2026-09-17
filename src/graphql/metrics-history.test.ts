import { describe, expect, it } from "vitest";
import {
  BUCKET_CAPACITY,
  BUCKET_MS,
  MetricRingBuffer,
  MetricsHistoryRecorder,
  RETENTION_MS,
} from "./metrics-history.js";
import type { FeedHandlers } from "./subscription-feed.js";

const T0 = 1_760_000_000_000;

function bufferAt(nowMs: { value: number }): MetricRingBuffer {
  return new MetricRingBuffer(() => nowMs.value);
}

describe("MetricRingBuffer", () => {
  it("has 24 hours of 30-second buckets", () => {
    expect(BUCKET_MS).toBe(30_000);
    expect(RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    expect(BUCKET_CAPACITY).toBe(2880);
  });

  it("folds samples in the same bucket into min/avg/max/count", () => {
    const now = { value: T0 };
    const buffer = bufferAt(now);

    buffer.add({ percent: 10 });
    now.value = T0 + 5_000;
    buffer.add({ percent: 30 });

    const [point] = buffer.window(T0 - 1);
    expect(point.series.percent).toEqual({ min: 10, max: 30, avg: 20, count: 2 });
    expect(buffer.size()).toBe(1);
  });

  it("starts a new point every 30 seconds and orders them oldest first", () => {
    const now = { value: T0 };
    const buffer = bufferAt(now);

    buffer.add({ percent: 1 });
    now.value = T0 + BUCKET_MS;
    buffer.add({ percent: 2 });

    const points = buffer.window(T0 - 1);
    expect(points).toHaveLength(2);
    expect(points[0].bucketStartMs).toBeLessThan(points[1].bucketStartMs);
    expect(points[1].series.percent.avg).toBe(2);
  });

  it("overwrites a slot after the retention period", () => {
    const now = { value: T0 };
    const buffer = bufferAt(now);

    buffer.add({ percent: 1 });
    now.value = T0 + RETENTION_MS;
    buffer.add({ percent: 2 });

    const points = buffer.window(0);
    expect(points).toHaveLength(1);
    expect(points[0].series.percent.avg).toBe(2);
  });

  it("excludes buckets older than the requested window", () => {
    const now = { value: T0 };
    const buffer = bufferAt(now);

    buffer.add({ percent: 1 });
    now.value = T0 + 10 * BUCKET_MS;
    buffer.add({ percent: 2 });

    expect(buffer.window(T0 + 5 * BUCKET_MS)).toHaveLength(1);
  });
});

interface FakeFeed {
  subscribe: (
    query: string,
    variables: Record<string, unknown> | undefined,
    handlers: FeedHandlers,
  ) => () => void;
  handlers: Map<string, FeedHandlers>;
  unsubscribed: string[];
}

function fakeFeed(): FakeFeed {
  const handlers = new Map<string, FeedHandlers>();
  const unsubscribed: string[] = [];
  return {
    handlers,
    unsubscribed,
    subscribe: (query, _variables, feedHandlers) => {
      handlers.set(query, feedHandlers);
      return () => unsubscribed.push(query);
    },
  };
}

describe("MetricsHistoryRecorder", () => {
  it("subscribes the three metric feeds only when started", () => {
    const feed = fakeFeed();
    const recorder = new MetricsHistoryRecorder({ feed, now: () => T0 });

    expect(feed.handlers.size).toBe(0);
    expect(recorder.isRunning()).toBe(false);
    recorder.start();

    expect(feed.handlers.size).toBe(3);
    expect(recorder.isRunning()).toBe(true);
    expect(recorder.startedAtMs()).toBe(T0);
  });

  it("records a pumped cpu sample into the cpu window", () => {
    const feed = fakeFeed();
    const now = { value: T0 };
    const recorder = new MetricsHistoryRecorder({ feed, now: () => now.value });
    recorder.start();

    const cpuQuery = [...feed.handlers.keys()].find((q) => q.includes("systemMetricsCpu")) ?? "";
    feed.handlers.get(cpuQuery)?.onData({ systemMetricsCpu: { percentTotal: 42 } });
    feed.handlers.get(cpuQuery)?.onData({ systemMetricsCpu: { percentTotal: "junk" } });

    const result = recorder.window("cpu", 60);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].series.percent.avg).toBe(42);
    expect(result.expectedBuckets).toBe(1);
    expect(result.gaps).toBe(0);
    expect(recorder.window("memory", 60).points).toHaveLength(0);
  });

  it("caps the window at the time the recorder started", () => {
    const feed = fakeFeed();
    const now = { value: T0 };
    const recorder = new MetricsHistoryRecorder({ feed, now: () => now.value });
    recorder.start();
    now.value = T0 + 2 * BUCKET_MS;

    const result = recorder.window("cpu", 1440);

    expect(result.expectedBuckets).toBe(2);
  });

  it("unsubscribes everything on dispose", () => {
    const feed = fakeFeed();
    const recorder = new MetricsHistoryRecorder({ feed, now: () => T0 });
    recorder.start();

    recorder.dispose();

    expect(feed.unsubscribed).toHaveLength(3);
    expect(recorder.isRunning()).toBe(false);
  });
});
