import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { UpsStatusDocument, type UpsStatusQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "ups_status";

/** Seconds per minute, for humanizing estimatedRuntime (which is reported in seconds). */
const SECONDS_PER_MINUTE = 60;

/** Minutes per hour, for the hour/minute split in humanized runtimes. */
const MINUTES_PER_HOUR = 60;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** The validated handler input. */
interface UpsStatusInput {
  response_format: ResponseFormat;
}

type UpsDevice = UpsStatusQuery["upsDevices"][number];

/** Humanizes a runtime in seconds to a compact "Xm" / "Xh Ym" string. */
function humanizeRuntime(seconds: number): string {
  const totalMinutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return `${hours}h ${minutes}m`;
}

/** Renders the optional watts note, omitted when the UPS does not report wattage. */
function wattsNote(power: UpsDevice["power"]): string {
  if (power.nominalPower === null || power.currentPower === null) {
    return "";
  }
  return ` (${power.currentPower}W / ${power.nominalPower}W)`;
}

/** Renders one device as a single concise line. */
function deviceLine(device: UpsDevice): string {
  const { battery, power } = device;
  const runtime = humanizeRuntime(battery.estimatedRuntime);
  return `${device.name} (${device.model}) — ${device.status} · battery ${battery.chargeLevel}% · ~${runtime} left · load ${power.loadPercentage}%${wattsNote(power)}`;
}

/** Builds the concise summary across all reported devices. */
function summarize(devices: UpsDevice[]): string {
  return devices.map(deviceLine).join("\n");
}

/** Renders the UPS status result (placeholder handling added in Task 3). */
function renderStatus(format: ResponseFormat, data: UpsStatusQuery): CallToolResult {
  const devices = data.upsDevices;
  if (devices.length === 0) {
    return formatResponse(format, "No UPS devices reported.", data);
  }
  return formatResponse(format, summarize(devices), data);
}

/**
 * Creates the `ups_status` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch the UPS snapshot.
 * @returns An MCP handler returning live UPS telemetry, or an error result.
 * @example
 * const handler = createUpsStatusHandler(client);
 * await handler({ response_format: "concise" });
 */
export function createUpsStatusHandler(client: GraphQLExecutor) {
  return async ({ response_format }: UpsStatusInput): Promise<CallToolResult> => {
    try {
      const data = await client.execute(UpsStatusDocument);
      return renderStatus(response_format, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch UPS status: ${message}`);
    }
  };
}
