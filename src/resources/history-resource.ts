import type { McpServer } from "@modelcontextprotocol/server";
import { BUCKET_MS, type MetricsHistoryRecorder } from "../graphql/metrics-history.js";
import { DEFAULT_WINDOW_MINUTES, HISTORY_OFF_TEXT } from "../tools/metrics/metrics-history.js";

export const HISTORY_URI = "unraid://live/history";

const JSON_INDENT_SPACES = 2;
const TOPICS = ["cpu", "memory", "network"] as const;

function renderHistory(history: MetricsHistoryRecorder | null): string {
  if (!history) {
    return JSON.stringify({ enabled: false, hint: HISTORY_OFF_TEXT }, null, JSON_INDENT_SPACES);
  }
  const topics: Record<string, unknown> = {};
  for (const topic of TOPICS) {
    const { points, gaps } = history.window(topic, DEFAULT_WINDOW_MINUTES);
    topics[topic] = {
      points: points.map((p) => ({
        time: new Date(p.bucketStartMs).toISOString(),
        series: p.series,
      })),
      gaps,
    };
  }
  const since = history.startedAtMs();
  const body = {
    enabled: true,
    window_minutes: DEFAULT_WINDOW_MINUTES,
    bucket_ms: BUCKET_MS,
    recording_since: since === null ? null : new Date(since).toISOString(),
    topics,
  };
  return JSON.stringify(body, null, JSON_INDENT_SPACES);
}

/**
 * Registers `unraid://live/history`: the last hour of every recorded topic
 * (mirrors the `metrics_history` tool), or the enable hint when recording is off.
 *
 * @param server - The MCP server to register the resource on.
 * @param history - The recorder, or null when MCP_METRICS_HISTORY is off.
 * @returns Nothing; registers the resource as a side effect.
 */
export function registerHistoryResource(
  server: McpServer,
  history: MetricsHistoryRecorder | null,
): void {
  server.registerResource(
    "unraid-live-history",
    HISTORY_URI,
    {
      title: "Metric History",
      description:
        "Last hour of CPU/memory/network history from the opt-in in-memory recorder (MCP_METRICS_HISTORY=true), 30-second min/avg/max buckets.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [{ uri: HISTORY_URI, mimeType: "application/json", text: renderHistory(history) }],
    }),
  );
}
