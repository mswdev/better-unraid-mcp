import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { SystemHealthDocument, type SystemHealthQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "system_health";

type Severity = "ok" | "warning" | "critical";

/** Ranks severities so the overall verdict is the worst subsystem's. */
const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warning: 1, critical: 2 };

/** Array usage percentages: sane defaults for a NAS filling up. */
const CAPACITY_WARNING_PERCENT = 90;
const CAPACITY_CRITICAL_PERCENT = 95;

/** Spinner temperatures: defaults matching common Unraid warning practice. */
const DISK_TEMP_WARNING_CELSIUS = 50;
const DISK_TEMP_CRITICAL_CELSIUS = 60;

/** Array-disk statuses that are not faults (NP = slot not populated). */
const HEALTHY_DISK_STATUSES = new Set(["DISK_OK", "DISK_NP"]);

/** apcupsd status meaning mains power is present. */
const UPS_ONLINE_STATUS = "ONLINE";

/** One subsystem's verdict. */
interface SubsystemHealth {
  subsystem: string;
  severity: Severity;
  detail: string;
}

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type HealthData = SystemHealthQuery;
type HealthArray = HealthData["array"];

/** Parses the API's stringly numbers; NaN-safe. */
function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function checkArrayState(array: HealthArray): SubsystemHealth {
  if (array.state === "STARTED") {
    return { subsystem: "array", severity: "ok", detail: "Array is started." };
  }
  return {
    subsystem: "array",
    severity: "warning",
    detail: `Array state is ${array.state} — shares, containers, and VMs are offline while stopped.`,
  };
}

function checkCapacity(array: HealthArray): SubsystemHealth {
  const total = toNumber(array.capacity.kilobytes.total);
  const used = toNumber(array.capacity.kilobytes.used);
  if (total <= 0) {
    return { subsystem: "capacity", severity: "ok", detail: "Capacity not reported." };
  }
  const percent = Math.round((used / total) * 100);
  if (percent >= CAPACITY_CRITICAL_PERCENT) {
    return { subsystem: "capacity", severity: "critical", detail: `Array is ${percent}% full.` };
  }
  if (percent >= CAPACITY_WARNING_PERCENT) {
    return { subsystem: "capacity", severity: "warning", detail: `Array is ${percent}% full.` };
  }
  return { subsystem: "capacity", severity: "ok", detail: `Array is ${percent}% full.` };
}

/** One disk's severity: fault status → critical; hot → warning/critical. */
function diskSeverity(disk: { status: string | null; temp: number | null }): Severity {
  // A null status reads like an unpopulated slot, not a fault.
  const status = disk.status ?? "DISK_NP";
  if (!HEALTHY_DISK_STATUSES.has(status)) {
    return "critical";
  }
  const temp = disk.temp ?? 0;
  if (temp >= DISK_TEMP_CRITICAL_CELSIUS) {
    return "critical";
  }
  return temp >= DISK_TEMP_WARNING_CELSIUS ? "warning" : "ok";
}

function checkDisks(array: HealthArray): SubsystemHealth {
  const all = [...array.parities, ...array.disks, ...array.caches];
  const problems = all
    .map((disk) => ({ name: disk.name ?? "(unnamed)", severity: diskSeverity(disk) }))
    .filter((entry) => entry.severity !== "ok");
  if (problems.length === 0) {
    return { subsystem: "disks", severity: "ok", detail: `${all.length} disks healthy.` };
  }
  const worst = problems.some((p) => p.severity === "critical") ? "critical" : "warning";
  const names = problems.map((p) => `${p.name} (${p.severity})`).join(", ");
  return { subsystem: "disks", severity: worst, detail: `Disk problems: ${names}.` };
}

function checkParity(array: HealthArray): SubsystemHealth {
  const errors = toNumber(array.parityCheckStatus.errors);
  if (errors > 0) {
    return {
      subsystem: "parity",
      severity: "warning",
      detail: `Last parity check reported ${errors} error(s).`,
    };
  }
  const running = array.parityCheckStatus.running ? " A parity check is running." : "";
  return { subsystem: "parity", severity: "ok", detail: `No parity errors reported.${running}` };
}

function checkNotifications(data: HealthData): SubsystemHealth {
  const unread = data.notifications.overview.unread;
  if (toNumber(unread.alert) > 0) {
    return {
      subsystem: "notifications",
      severity: "critical",
      detail: `${unread.alert} unread alert(s) — read notification_alerts.`,
    };
  }
  if (toNumber(unread.warning) > 0) {
    return {
      subsystem: "notifications",
      severity: "warning",
      detail: `${unread.warning} unread warning(s).`,
    };
  }
  return { subsystem: "notifications", severity: "ok", detail: "No unread warnings or alerts." };
}

function checkUps(data: HealthData): SubsystemHealth {
  const devices = data.upsDevices ?? [];
  if (devices.length === 0) {
    return { subsystem: "ups", severity: "ok", detail: "No UPS configured." };
  }
  const offline = devices.filter((ups) => ups.status !== UPS_ONLINE_STATUS);
  if (offline.length === 0) {
    return { subsystem: "ups", severity: "ok", detail: "UPS online." };
  }
  const detail = offline.map((ups) => `${ups.name}: ${ups.status}`).join(", ");
  const onBattery = offline.some((ups) => ups.status === "ONBATT");
  return { subsystem: "ups", severity: onBattery ? "critical" : "warning", detail };
}

function checkDockerUpdates(data: HealthData): SubsystemHealth {
  const pending = data.docker.containers.filter((c) => c.isUpdateAvailable === true).length;
  if (pending === 0) {
    return { subsystem: "docker", severity: "ok", detail: "All container images current." };
  }
  return {
    subsystem: "docker",
    severity: "warning",
    detail: `${pending} container update(s) available (docker_container_update).`,
  };
}

function worstSeverity(reports: SubsystemHealth[]): Severity {
  return reports.reduce<Severity>(
    (worst, report) =>
      SEVERITY_RANK[report.severity] > SEVERITY_RANK[worst] ? report.severity : worst,
    "ok",
  );
}

function summarize(overall: Severity, reports: SubsystemHealth[]): string {
  const lines = reports.map(
    (report) => `${report.severity === "ok" ? "✓" : "⚠"} ${report.subsystem}: ${report.detail}`,
  );
  return [`OVERALL: ${overall.toUpperCase()}`, ...lines].join("\n");
}

/**
 * Creates the `system_health` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used for the combined health read.
 * @returns An MCP handler producing a severity-scored health rollup.
 * @example
 * const handler = createSystemHealthHandler(client);
 * await handler({ response_format: "concise" });
 */
/** The severity-scored rollup, reused by the tool and the unraid://health resource. */
export interface SystemHealthReport {
  overall: Severity;
  subsystems: SubsystemHealth[];
}

/**
 * Computes the severity-scored health rollup from one combined GraphQL read.
 *
 * @param client - The GraphQL executor used for the combined health read.
 * @returns The overall verdict plus per-subsystem reports.
 * @throws Error when the health query fails.
 */
export async function runSystemHealth(client: GraphQLExecutor): Promise<SystemHealthReport> {
  const data = await client.execute(SystemHealthDocument);
  const subsystems = [
    checkArrayState(data.array),
    checkCapacity(data.array),
    checkDisks(data.array),
    checkParity(data.array),
    checkNotifications(data),
    checkUps(data),
    checkDockerUpdates(data),
  ];
  return { overall: worstSeverity(subsystems), subsystems };
}

export function createSystemHealthHandler(client: GraphQLExecutor) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const report = await runSystemHealth(client);
      const summary = summarize(report.overall, report.subsystems);
      return formatResponse(input.response_format, summary, report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to compute system health: ${message}`);
    }
  };
}

/**
 * Registers the read-only `system_health` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerSystemHealth(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "System Health Rollup",
      description:
        "Read-only. One severity-scored health report (OK / WARNING / CRITICAL) across array state, capacity, disk status and temperatures, parity errors, unread notifications, UPS, and pending container updates — start here instead of assembling health from separate reads. Thresholds: capacity warns at 90% and goes critical at 95%; disk temps warn at 50°C and go critical at 60°C. Follow up with array_status, disk_list, or notification_alerts for depth.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createSystemHealthHandler(client),
  );
}
