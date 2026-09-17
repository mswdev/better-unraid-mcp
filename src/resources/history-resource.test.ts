import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
