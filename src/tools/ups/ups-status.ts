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

/**
 * Identity the upstream resolver emits when apcaccess reports no device MODEL:
 * name = MODEL || 'My UPS', model = MODEL || 'APC Back-UPS Pro 1500'. Both
 * literals can co-occur ONLY when MODEL was absent (a real "APC Back-UPS Pro
 * 1500" sets name to that string too, never "My UPS"), so the pair is a
 * source-airtight marker of fabricated placeholder data, not a real UPS.
 */
const PLACEHOLDER_NAME = "My UPS";
const PLACEHOLDER_MODEL = "APC Back-UPS Pro 1500";

/**
 * The title-case default the resolver substitutes for an absent STATUS
 * (status = STATUS || 'Online'). Real apcaccess STATUS is uppercase ('ONLINE'),
 * so this exact value marks the default — suppression is gated on it so a real
 * alert status (e.g. 'ONBATT') on a MODEL-absent record is never hidden.
 */
const DEFAULT_STATUS = "Online";

/** Returned when the device is fabricated placeholder data rather than a real UPS. */
const NO_DATA_NOTE =
  "No live UPS data — apcupsd may be stopped or no UPS is attached (the Unraid API returned placeholder values).";

/** Appended when device identity is placeholder but the status is a real, non-default reading. */
const NO_IDENTITY_CAVEAT =
  "⚠ apcaccess reported no device identity; model/name and unchanged battery/power values may be upstream defaults — verify the UPS connection.";

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
function renderWattsNote(power: UpsDevice["power"]): string {
  if (power.nominalPower === null || power.currentPower === null) {
    return "";
  }
  return ` (${power.currentPower}W / ${power.nominalPower}W)`;
}

/** Renders one device as a single concise line. */
function renderDeviceLine(device: UpsDevice): string {
  const { battery, power } = device;
  const runtime = humanizeRuntime(battery.estimatedRuntime);
  return `${device.name} (${device.model}) — ${device.status} · battery ${battery.chargeLevel}% · ~${runtime} left · load ${power.loadPercentage}%${renderWattsNote(power)}`;
}

/** Builds the concise summary across all reported devices. */
function summarize(devices: UpsDevice[]): string {
  return devices.map(renderDeviceLine).join("\n");
}

/** True when the device carries the MODEL-absent placeholder identity (fabricated data). */
function hasPlaceholderIdentity(device: UpsDevice): boolean {
  return device.name === PLACEHOLDER_NAME && device.model === PLACEHOLDER_MODEL;
}

/**
 * Renders the UPS status result. Suppresses fabricated placeholder data, but
 * only when the status is the safe default — so a real alert status is never
 * hidden.
 */
function renderStatus(format: ResponseFormat, data: UpsStatusQuery): CallToolResult {
  const devices = data.upsDevices;
  if (devices.length === 0) {
    return formatResponse(format, "No UPS devices reported.", data);
  }
  const device = devices[0];
  if (hasPlaceholderIdentity(device) && device.status === DEFAULT_STATUS) {
    return formatResponse(format, NO_DATA_NOTE, {
      upsDetected: false,
      note: NO_DATA_NOTE,
      placeholderPayload: data,
    });
  }
  const concise = hasPlaceholderIdentity(device)
    ? `${renderDeviceLine(device)}\n${NO_IDENTITY_CAVEAT}`
    : summarize(devices);
  return formatResponse(format, concise, data);
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

/**
 * Registers the read-only `ups_status` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerUpsStatus(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get UPS Status",
      description:
        "Read-only. Live UPS telemetry from apcupsd: operational status (passed through verbatim from apcaccess — e.g. ONLINE, ONBATT, LOWBATT, COMMLOST), battery charge and estimated runtime, and power load/voltage. An error usually means no UPS is attached or the apcupsd service is not running — not a server failure. When apcupsd reports no device, the Unraid API may return placeholder values; this tool reports that as 'no live UPS data' rather than a healthy UPS, and battery/power values may be upstream defaults when apcaccess data is incomplete. Reachable by any authenticated key (no special permission).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createUpsStatusHandler(client),
  );
}
