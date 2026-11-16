import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ParityHistoryDocument,
  SystemHealthDocument,
  type SystemHealthQuery,
  UpsStatusDocument,
  type UpsStatusQuery,
} from "../../types/unraid/graphql.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import { DOCKER_UNAVAILABLE } from "../_shared/errors/require-service.js";
import { type ParityChecks, sortNewestFirst } from "../_shared/parity/sort-newest-first.js";
import {
  formatStructuredResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";

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

/** Live parity statuses meaning a check is in progress right now. */
const ACTIVE_PARITY_STATUSES: ReadonlySet<string> = new Set(["RUNNING", "PAUSED"]);

/** The history outcome for a check that exited with an error (not a cancel). */
const FAILED_PARITY_STATUS = "FAILED";

/** One subsystem's verdict. */
interface SubsystemHealth {
  subsystem: string;
  severity: Severity;
  detail: string;
}

const inputSchema = z.object({
  response_format: responseFormatSchema,
});

/** Shape of the structuredContent payload. */
const outputSchema = z.object({
  overall: z.enum(["ok", "warning", "critical"]),
  subsystems: z.array(
    z.object({ subsystem: z.string(), severity: z.string(), detail: z.string() }),
  ),
});

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

/** Parity-check history, or the failure message when the API could not read its log. */
type ParityReading = { checks: ParityChecks } | { failure: string };

/**
 * Reads parity-check history separately so a failed read cannot sink the
 * whole rollup. The API throws "Parity history file not found" when
 * /boot/config/parity-checks.log is absent, which is normal on a server that
 * has never run a check.
 */
async function readParityHistory(client: GraphQLExecutor): Promise<ParityReading> {
  try {
    const data = await client.execute(ParityHistoryDocument);
    return { checks: data.parityHistory };
  } catch (error) {
    return { failure: errorMessage(error) };
  }
}

/** Names a check in progress (" A parity check is running (37% done).") or returns "". */
function activeCheckClause(live: HealthArray["parityCheckStatus"]): string {
  if (!ACTIVE_PARITY_STATUSES.has(live.status)) {
    return "";
  }
  return ` A parity check is ${live.status.toLowerCase()} (${live.progress ?? 0}% done).`;
}

/** Scores the newest recorded check: any errors, or a FAILED outcome, is a warning. */
function scoreLastCheck(check: ParityChecks[number]): Pick<SubsystemHealth, "severity" | "detail"> {
  const errors = check.errors ?? 0;
  const isProblem = errors > 0 || check.status === FAILED_PARITY_STATUS;
  return {
    severity: isProblem ? "warning" : "ok",
    detail: `Last parity check (${check.date ?? "date unknown"}): ${check.status}, ${errors} error(s).`,
  };
}

/**
 * Scores parity from the newest parity-history entry, plus any check the live
 * array status shows in progress. The live `parityCheckStatus` cannot carry
 * the error count: the API fills only its status, speed, date, duration and
 * progress (upstream getParityCheckStatus at unraid/api v4.37.11), so
 * `errors` and `running` there are always null. No readable history is not a
 * fault, so it scores ok.
 */
function checkParity(
  live: HealthArray["parityCheckStatus"],
  reading: ParityReading,
): SubsystemHealth {
  const active = activeCheckClause(live);
  if ("failure" in reading) {
    const detail = `No parity-check history could be read (${reading.failure}).${active}`;
    return { subsystem: "parity", severity: "ok", detail };
  }
  const [latest] = sortNewestFirst(reading.checks);
  if (latest === undefined) {
    return { subsystem: "parity", severity: "ok", detail: `No parity checks recorded.${active}` };
  }
  const scored = scoreLastCheck(latest);
  return { subsystem: "parity", severity: scored.severity, detail: `${scored.detail}${active}` };
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

/** UPS devices, or the failure message when the API could not read apcaccess. */
type UpsReading = { devices: UpsStatusQuery["upsDevices"] } | { failure: string };

/**
 * Absence of UPS data is not an outage: the Unraid API shells out to apcaccess
 * and throws when it prints nothing (apcupsd stopped, no UPS, or a NUT-managed
 * UPS — observed live on a NUT server), so the rollup reports it as ok.
 */
const UPS_UNAVAILABLE_DETAIL =
  "UPS data unavailable — the Unraid API reads apcupsd only; NUT-managed or absent UPSes report nothing here";

/** Reads UPS data separately so an apcaccess failure cannot sink the whole rollup. */
async function readUps(client: GraphQLExecutor): Promise<UpsReading> {
  try {
    const data = await client.execute(UpsStatusDocument);
    return { devices: data.upsDevices };
  } catch (error) {
    return { failure: errorMessage(error) };
  }
}

/** Splits a free-form apcupsd status into upper-cased tokens ("ONLINE SLAVE" → two). */
function statusTokens(status: string): string[] {
  return status.trim().toUpperCase().split(/\s+/);
}

/**
 * apcupsd statuses are free-form, possibly multi-token ("ONLINE SLAVE"), and
 * the API returns a phantom no-status device instead of an empty list when
 * no UPS is configured — so tokens are matched, and status-less devices are
 * treated as absence, never as an outage.
 */
function checkUps(reading: UpsReading): SubsystemHealth {
  if ("failure" in reading) {
    const detail = `${UPS_UNAVAILABLE_DETAIL} (${reading.failure}).`;
    return { subsystem: "ups", severity: "ok", detail };
  }
  const reporting = reading.devices.filter((ups) => ups.status.trim().length > 0);
  if (reporting.length === 0) {
    return { subsystem: "ups", severity: "ok", detail: "No UPS reporting live data." };
  }
  const offline = reporting.filter((ups) => !statusTokens(ups.status).includes(UPS_ONLINE_STATUS));
  const onBattery = reporting.some((ups) => statusTokens(ups.status).includes("ONBATT"));
  if (onBattery) {
    const detail = reporting.map((ups) => `${ups.name}: ${ups.status}`).join(", ");
    return { subsystem: "ups", severity: "critical", detail };
  }
  if (offline.length === 0) {
    return { subsystem: "ups", severity: "ok", detail: "UPS online." };
  }
  const detail = offline.map((ups) => `${ups.name}: ${ups.status}`).join(", ");
  return { subsystem: "ups", severity: "warning", detail };
}

function checkDockerUpdates(data: HealthData): SubsystemHealth {
  if (data.docker === null) {
    return {
      subsystem: "docker",
      severity: "warning",
      detail: `Docker status unknown: ${DOCKER_UNAVAILABLE}.`,
    };
  }
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

/** The severity-scored rollup, reused by the tool and the unraid://health resource. */
export interface SystemHealthReport {
  overall: Severity;
  subsystems: SubsystemHealth[];
}

/**
 * Computes the severity-scored health rollup from one combined GraphQL read,
 * plus separate UPS and parity-history reads that degrade on failure.
 *
 * @param client - The GraphQL executor used for the health reads.
 * @returns The overall verdict plus per-subsystem reports.
 * @throws Error when the combined health query fails (a failed UPS or
 *   parity-history read degrades instead).
 */
export async function runSystemHealth(client: GraphQLExecutor): Promise<SystemHealthReport> {
  const [data, ups, parity] = await Promise.all([
    client.execute(SystemHealthDocument),
    readUps(client),
    readParityHistory(client),
  ]);
  const subsystems = [
    checkArrayState(data.array),
    checkCapacity(data.array),
    checkDisks(data.array),
    checkParity(data.array.parityCheckStatus, parity),
    checkNotifications(data),
    checkUps(ups),
    checkDockerUpdates(data),
  ];
  return { overall: worstSeverity(subsystems), subsystems };
}

/**
 * Creates the `system_health` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used for the health reads.
 * @returns An MCP handler producing a severity-scored health rollup.
 * @example
 * const handler = createSystemHealthHandler(client);
 * await handler({ response_format: "concise" });
 */
export function createSystemHealthHandler(client: GraphQLExecutor) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const report = await runSystemHealth(client);
      const summary = summarize(report.overall, report.subsystems);
      return formatStructuredResponse(input.response_format, summary, report);
    } catch (error) {
      const message = errorMessage(error);
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
        "Read-only. One severity-scored health report (OK / WARNING / CRITICAL) across array state, capacity, disk status and temperatures, parity (the last recorded check's outcome and error count, plus any check in progress), unread notifications, UPS, and pending container updates — start here instead of assembling health from separate reads. Thresholds: capacity warns at 90% and goes critical at 95%; disk temps warn at 50°C and go critical at 60°C; a last parity check with errors or a FAILED outcome warns. Follow up with array_status, disk_list, parity_history, or notification_alerts for depth.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createSystemHealthHandler(client),
  );
}
