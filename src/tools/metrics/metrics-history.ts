import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { MetricTopic } from "../../graphql/metric-subscriptions.js";
import {
  BUCKET_MS,
  type HistoryPoint,
  type MetricsHistoryRecorder,
} from "../../graphql/metrics-history.js";
import { type ResponseFormat, formatResponse, toolText } from "../_shared/respond.js";

const TOOL_NAME = "metrics_history";

export const DEFAULT_WINDOW_MINUTES = 60;
/** 24 hours — the recorder's retention. */
export const MAX_WINDOW_MINUTES = 1440;
/** Concise output folds the window into at most this many rows. */
const CONCISE_ROWS = 24;
const ONE_DECIMAL = 1;
const MS_PER_SECOND = 1000;

/** Shown by the tool and the resource whenever recording is off. */
export const HISTORY_OFF_TEXT =
  "Metric history is off. Start the server with MCP_METRICS_HISTORY=true to record CPU, memory, and network at 30-second resolution for 24 hours (in memory only; cleared on restart).";

const inputSchema = z.object({
  topic: z.enum(["cpu", "memory", "network"]),
  window_minutes: z
    .number()
    .int()
    .positive()
    .max(MAX_WINDOW_MINUTES)
    .default(DEFAULT_WINDOW_MINUTES),
  response_format: z.enum(["concise", "detailed"]).default("concise"),
});

/** The validated handler input. */
export interface MetricsHistoryInput {
  topic: MetricTopic;
  window_minutes: number;
  response_format: ResponseFormat;
}

function hhmmss(epochMs: number): string {
  return new Date(epochMs).toISOString().slice("YYYY-MM-DDT".length, "YYYY-MM-DDTHH:MM:SS".length);
}

/** Merges consecutive points into one row (min of mins, max of maxes, count-weighted avg). */
function mergePoints(points: HistoryPoint[]): HistoryPoint {
  const series: Record<string, { min: number; max: number; sum: number; count: number }> = {};
  for (const point of points) {
    for (const [name, stats] of Object.entries(point.series)) {
      const acc = series[name] ?? { min: stats.min, max: stats.max, sum: 0, count: 0 };
      series[name] = {
        min: Math.min(acc.min, stats.min),
        max: Math.max(acc.max, stats.max),
        sum: acc.sum + stats.avg * stats.count,
        count: acc.count + stats.count,
      };
    }
  }
  const merged: HistoryPoint["series"] = {};
  for (const [name, acc] of Object.entries(series)) {
    merged[name] = { min: acc.min, max: acc.max, avg: acc.sum / acc.count, count: acc.count };
  }
  return { bucketStartMs: points[0].bucketStartMs, series: merged };
}

/** Groups the points into at most CONCISE_ROWS rows of consecutive buckets. */
function foldRows(points: HistoryPoint[]): HistoryPoint[] {
  const perRow = Math.max(1, Math.ceil(points.length / CONCISE_ROWS));
  const rows: HistoryPoint[] = [];
  for (let start = 0; start < points.length; start += perRow) {
    rows.push(mergePoints(points.slice(start, start + perRow)));
  }
  return rows;
}

function renderRow(point: HistoryPoint): string {
  const cells = Object.entries(point.series).map(
    ([name, s]) =>
      `${name} ${s.min.toFixed(ONE_DECIMAL)}/${s.avg.toFixed(ONE_DECIMAL)}/${s.max.toFixed(ONE_DECIMAL)}`,
  );
  return `${hhmmss(point.bucketStartMs)}  ${cells.join("  ")}`;
}

function renderConcise(input: MetricsHistoryInput, points: HistoryPoint[], gaps: number): string {
  const header = `${input.topic} — last ${input.window_minutes} min: ${points.length} points, ${gaps} gaps (${BUCKET_MS / MS_PER_SECOND} s buckets; columns are min/avg/max, times UTC)`;
  return [header, ...foldRows(points).map(renderRow)].join("\n");
}

/**
 * Creates the `metrics_history` handler.
 *
 * @param history - The recorder, or null when MCP_METRICS_HISTORY is off.
 * @returns An MCP handler returning a downsampled metric series.
 */
export function createMetricsHistoryHandler(history: MetricsHistoryRecorder | null) {
  return async (input: MetricsHistoryInput): Promise<CallToolResult> => {
    if (!history) {
      return toolText(HISTORY_OFF_TEXT);
    }
    const since = new Date(history.startedAtMs() ?? Date.now()).toISOString();
    const { points, gaps } = history.window(input.topic, input.window_minutes);
    if (points.length === 0) {
      return toolText(
        `Recording since ${since}; no ${input.topic} samples yet (the WebSocket feed delivers the first sample within a few seconds).`,
      );
    }
    const detailed = {
      topic: input.topic,
      window_minutes: input.window_minutes,
      bucket_ms: BUCKET_MS,
      points: points.map((p) => ({
        time: new Date(p.bucketStartMs).toISOString(),
        series: p.series,
      })),
      gaps,
      recording_since: since,
    };
    return formatResponse(input.response_format, renderConcise(input, points, gaps), detailed);
  };
}

/**
 * Registers the read-only `metrics_history` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param history - The recorder, or null when recording is off.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerMetricsHistory(
  server: McpServer,
  history: MetricsHistoryRecorder | null,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Metric History",
      description:
        "Read-only. Recent CPU / memory / network history from this server's in-memory recorder (opt-in: MCP_METRICS_HISTORY=true): 30-second buckets with min/avg/max for up to 24 hours, honest about gaps. `topic` = cpu (percent), memory (percent, usedBytes), network (rx/tx bytes per second summed over interfaces); `window_minutes` defaults to 60, max 1440. Nothing is persisted to disk — history starts when the server starts. When recording is off the tool says how to enable it.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createMetricsHistoryHandler(history),
  );
}
