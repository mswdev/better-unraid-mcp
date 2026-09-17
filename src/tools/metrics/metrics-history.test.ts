import { describe, expect, it } from "vitest";
import { BUCKET_MS, MetricsHistoryRecorder } from "../../graphql/metrics-history.js";
import type { FeedHandlers } from "../../graphql/subscription-feed.js";
import { firstText } from "../_shared/test-support.js";
import { createMetricsHistoryHandler } from "./metrics-history.js";

const T0 = 1_760_000_000_000;

function recorderWithSamples(count: number, spacingMs = BUCKET_MS): MetricsHistoryRecorder {
  const now = { value: T0 };
  const handlers = new Map<string, FeedHandlers>();
  const recorder = new MetricsHistoryRecorder({
    feed: {
      subscribe: (query, _v, h) => {
        handlers.set(query, h);
        return () => {};
      },
    },
    now: () => now.value,
  });
  recorder.start();
  const cpu = [...handlers.entries()].find(([q]) => q.includes("systemMetricsCpu"))?.[1];
  for (let i = 0; i < count; i += 1) {
    now.value = T0 + i * spacingMs;
    cpu?.onData({ systemMetricsCpu: { percentTotal: 10 + i } });
  }
  return recorder;
}

describe("metrics_history", () => {
  it("explains how to enable recording when the recorder is off", async () => {
    const handler = createMetricsHistoryHandler(null);

    const result = await handler({ topic: "cpu", window_minutes: 60, response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("MCP_METRICS_HISTORY=true");
    expect(firstText(result)).toContain("24 hours");
  });

  it("says when no samples have arrived yet", async () => {
    const recorder = recorderWithSamples(0);
    const handler = createMetricsHistoryHandler(recorder);

    const result = await handler({
      topic: "memory",
      window_minutes: 60,
      response_format: "concise",
    });

    expect(firstText(result)).toContain("no memory samples yet");
    expect(firstText(result)).toContain("Recording since");
  });

  it("renders a compact min/avg/max table for the window", async () => {
    const recorder = recorderWithSamples(3);
    const handler = createMetricsHistoryHandler(recorder);

    const result = await handler({ topic: "cpu", window_minutes: 60, response_format: "concise" });
    const text = firstText(result);

    expect(text).toContain("cpu — last 60 min: 3 points");
    expect(text).toContain("30 s buckets");
    expect(text).toMatch(/percent 10\.0\/10\.0\/10\.0/);
    expect(text).toMatch(/percent 12\.0\/12\.0\/12\.0/);
  });

  it("never renders more than 24 rows for a long window", async () => {
    const recorder = recorderWithSamples(2_000);
    const handler = createMetricsHistoryHandler(recorder);

    const result = await handler({
      topic: "cpu",
      window_minutes: 1440,
      response_format: "concise",
    });
    const rows = firstText(result)
      .split("\n")
      .filter((line) => /^\d\d:\d\d/.test(line));

    expect(rows.length).toBeLessThanOrEqual(24);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns the full point list in detailed mode", async () => {
    const recorder = recorderWithSamples(2);
    const handler = createMetricsHistoryHandler(recorder);

    const result = await handler({ topic: "cpu", window_minutes: 60, response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as {
      topic: string;
      bucket_ms: number;
      points: Array<{ time: string; series: Record<string, { avg: number }> }>;
      gaps: number;
      recording_since: string;
    };

    expect(parsed.topic).toBe("cpu");
    expect(parsed.bucket_ms).toBe(30_000);
    expect(parsed.points).toHaveLength(2);
    expect(parsed.points[0].time).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(parsed.points[1].series.percent.avg).toBe(11);
    expect(parsed.recording_since).toMatch(/^\d{4}/);
  });
});
