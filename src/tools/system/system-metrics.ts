import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  SystemMetricsDocument,
  type SystemMetricsQuery,
  type TemperatureUnit,
} from "../../types/unraid/graphql.js";
import { humanizeBytes, toNumber } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "system_metrics";

/** Decimal places used when rendering temperatures. */
const TEMPERATURE_DECIMALS = 1;

/** Decimal places used when rendering percentages. */
const PERCENT_DECIMALS = 0;

/** The operstate value reporting an operational network interface. */
const OPERSTATE_UP = "up";

/**
 * Display suffix per API temperature unit. Typed over the generated union so
 * a schema change that adds a unit fails compilation here instead of
 * rendering a wrong suffix.
 */
const UNIT_SUFFIXES: Record<TemperatureUnit, string> = {
  CELSIUS: "C",
  FAHRENHEIT: "F",
  KELVIN: "K",
  RANKINE: "R",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  include_temperature: z.boolean().default(false),
};

type Metrics = SystemMetricsQuery["metrics"];
type SystemTime = SystemMetricsQuery["systemTime"];

/** The validated handler input. */
interface SystemMetricsInput {
  response_format: ResponseFormat;
  include_temperature: boolean;
}

/** Renders the server-time header line. */
function timeLine(time: SystemTime): string {
  return `As of ${time.currentTime} (${time.timeZone}, NTP ${time.useNtp ? "on" : "off"}):`;
}

/** Renders total CPU load and the busiest thread. */
function cpuLine(cpu: Metrics["cpu"]): string {
  if (!cpu) {
    return "CPU: unavailable";
  }
  const threads = cpu.cpus.length;
  const busiest = threads > 0 ? Math.max(...cpu.cpus.map((core) => core.percentTotal)) : undefined;
  const busiestNote =
    busiest === undefined ? "" : ` (busiest ${busiest.toFixed(PERCENT_DECIMALS)}%)`;
  return `CPU: ${cpu.percentTotal.toFixed(PERCENT_DECIMALS)}% total, ${threads} threads${busiestNote}`;
}

/** Renders memory pressure; pairs percentTotal with available ('used' counts cache and contradicts it). */
function memoryLine(memory: Metrics["memory"]): string {
  if (!memory) {
    return "Memory: unavailable";
  }
  const available = humanizeBytes(toNumber(memory.available));
  const total = humanizeBytes(toNumber(memory.total));
  const swap = memory.percentSwapTotal.toFixed(PERCENT_DECIMALS);
  return `Memory: ${memory.percentTotal.toFixed(PERCENT_DECIMALS)}% used — ${available} available of ${total} (swap ${swap}%)`;
}

/** Renders the temperature line, or null when the section was not requested. */
function temperatureLine(metrics: Metrics, included: boolean): string | null {
  if (!included) {
    return null;
  }
  if (!metrics.temperature) {
    return "Temperature: unavailable (no sensors or collection disabled)";
  }
  const { summary } = metrics.temperature;
  const unit = UNIT_SUFFIXES[summary.hottest.current.unit];
  const value = summary.hottest.current.value.toFixed(TEMPERATURE_DECIMALS);
  const hottest = `${summary.hottest.name} ${value}°${unit}`;
  const average = summary.average.toFixed(TEMPERATURE_DECIMALS);
  return `Temperature: avg ${average}°${unit} — ${summary.warningCount} warning, ${summary.criticalCount} critical (hottest: ${hottest})`;
}

/** Summarizes one up interface: throughput and total error count. */
function interfaceSummary(iface: Metrics["network"][number]): string {
  const errors = toNumber(iface.receiveErrors) + toNumber(iface.transmitErrors);
  return `${iface.name} up — rx ${humanizeBytes(iface.rxSec)}/s, tx ${humanizeBytes(iface.txSec)}/s, ${errors} errors`;
}

/** Renders one entry per up interface, counting the rest. */
function networkLine(network: Metrics["network"]): string {
  if (network.length === 0) {
    return "Network: no interfaces reported";
  }
  const up = network.filter((iface) => iface.operstate === OPERSTATE_UP);
  if (up.length === 0) {
    return `Network: no interfaces up (${network.length} reported)`;
  }
  const others = network.length - up.length;
  const othersNote = others > 0 ? ` (${others} not up omitted)` : "";
  return `Network: ${up.map(interfaceSummary).join("; ")}${othersNote}`;
}

/** Builds the concise multi-line snapshot, omitting unrequested sections. */
function summarize(data: SystemMetricsQuery, includeTemperature: boolean): string {
  const lines = [
    timeLine(data.systemTime),
    cpuLine(data.metrics.cpu),
    memoryLine(data.metrics.memory),
    temperatureLine(data.metrics, includeTemperature),
    networkLine(data.metrics.network),
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
 * Creates the `system_metrics` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch the snapshot.
 * @returns An MCP handler returning a point-in-time system health snapshot.
 * @example
 * const handler = createSystemMetricsHandler(client);
 * await handler({ response_format: "concise", include_temperature: false });
 */
export function createSystemMetricsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    include_temperature,
  }: SystemMetricsInput): Promise<CallToolResult> => {
    try {
      const data = await client.execute(SystemMetricsDocument, {
        includeTemperature: include_temperature,
      });
      return formatResponse(response_format, summarize(data, include_temperature), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch system metrics: ${message}`);
    }
  };
}

/**
 * Registers the read-only `system_metrics` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerSystemMetrics(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get System Metrics",
      description:
        "Read-only. Point-in-time health snapshot: CPU load, memory pressure (percent + available bytes), per-interface network rates/errors, and server time (timezone, NTP). Set include_temperature=true to also probe temperature sensors — omitted by default because a cold probe can take seconds on multi-disk servers. Network rates read 0 right after the Unraid API restarts. Requires INFO+VARS read permission (any viewer-level key).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createSystemMetricsHandler(client),
  );
}
