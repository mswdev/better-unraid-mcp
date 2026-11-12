import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { MetricsHistoryRecorder } from "../graphql/metrics-history.js";
import { HISTORY_URI, registerHistoryResource } from "./history-resource.js";

type Reader = () => Promise<{ contents: Array<{ text: string }> }>;

function captureResource(): { server: McpServer; readers: Record<string, Reader> } {
  const readers: Record<string, Reader> = {};
  const server = {
    registerResource: (_name: string, uri: string, _meta: unknown, reader: Reader) => {
      readers[uri] = reader;
    },
  } as unknown as McpServer;
  return { server, readers };
}

describe("unraid://live/history", () => {
  it("reports disabled with the enable hint when no recorder exists", async () => {
    const { server, readers } = captureResource();
    registerHistoryResource(server, null);

    const body = JSON.parse((await readers[HISTORY_URI]()).contents[0].text) as {
      enabled: boolean;
      hint: string;
    };

    expect(body.enabled).toBe(false);
    expect(body.hint).toContain("MCP_METRICS_HISTORY=true");
  });

  it("mirrors the last hour of every topic when recording", async () => {
    const { server, readers } = captureResource();
    const recorder = new MetricsHistoryRecorder({
      feed: { subscribe: () => () => {} },
      now: () => 1_760_000_000_000,
    });
    recorder.start();
    registerHistoryResource(server, recorder);

    const body = JSON.parse((await readers[HISTORY_URI]()).contents[0].text) as {
      enabled: boolean;
      window_minutes: number;
      topics: Record<string, { points: unknown[]; gaps: number }>;
    };

    expect(body.enabled).toBe(true);
    expect(body.window_minutes).toBe(60);
    expect(Object.keys(body.topics).sort()).toEqual(["cpu", "memory", "network"]);
    expect(body.topics.cpu.points).toEqual([]);
  });
});

describe("unraid://live/history recorder states", () => {
  const T0 = 1_760_000_000_000;

  it("reports no recording start for a recorder that has not started", async () => {
    const { server, readers } = captureResource();
    const recorder = new MetricsHistoryRecorder({
      feed: { subscribe: () => () => {} },
      now: () => T0,
    });
    registerHistoryResource(server, recorder);

    const body = JSON.parse((await readers[HISTORY_URI]()).contents[0].text) as {
      recording_since: string | null;
    };

    expect(body.recording_since).toBeNull();
  });

  it("renders recorded points with ISO bucket times", async () => {
    const { server, readers } = captureResource();
    let cpu: ((data: unknown) => void) | undefined;
    const recorder = new MetricsHistoryRecorder({
      feed: {
        subscribe: (query, _variables, handlers) => {
          if (query.includes("systemMetricsCpu")) {
            cpu = handlers.onData;
          }
          return () => {};
        },
      },
      now: () => T0,
    });
    recorder.start();
    cpu?.({ systemMetricsCpu: { percentTotal: 25 } });
    registerHistoryResource(server, recorder);

    const body = JSON.parse((await readers[HISTORY_URI]()).contents[0].text) as {
      recording_since: string;
      topics: { cpu: { points: Array<{ time: string; series: { percent: { avg: number } } }> } };
    };

    expect(body.recording_since).toBe(new Date(T0).toISOString());
    expect(body.topics.cpu.points[0].series.percent.avg).toBe(25);
    expect(Date.parse(body.topics.cpu.points[0].time)).toBeLessThanOrEqual(T0);
  });
});
