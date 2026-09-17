import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";

const TOOL_NAME = "gpu_metrics";

const PROBE_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 20_000;

/** One CSV line per GPU, no units — stable for parsing. */
const NVIDIA_QUERY =
  "nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits";

/** One bounded JSON sample; `timeout`'s exit code is expected and tolerated. */
const INTEL_SAMPLE = "timeout 3 intel_gpu_top -J 2>/dev/null";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Parsed nvidia-smi row. */
interface NvidiaGpu {
  name: string;
  utilizationPercent: number;
  memoryUsedMib: number;
  memoryTotalMib: number;
  temperatureCelsius: number;
  powerDrawWatts: number;
}

function parseNvidia(stdout: string): NvidiaGpu[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, util, memUsed, memTotal, temp, power] = line.split(",").map((v) => v.trim());
      return {
        name,
        utilizationPercent: Number(util),
        memoryUsedMib: Number(memUsed),
        memoryTotalMib: Number(memTotal),
        temperatureCelsius: Number(temp),
        powerDrawWatts: Number(power),
      };
    });
}

function summarizeNvidia(gpus: NvidiaGpu[]): string {
  const lines = gpus.map(
    (gpu) =>
      `- ${gpu.name}: ${gpu.utilizationPercent}% util, ${gpu.memoryUsedMib}/${gpu.memoryTotalMib} MiB VRAM, ${gpu.temperatureCelsius}°C, ${gpu.powerDrawWatts} W`,
  );
  return [`${gpus.length} NVIDIA GPU(s):`, ...lines].join("\n");
}

/** True when the binary exists on the host. */
async function hasCommand(shell: ShellExecutor, binary: string): Promise<boolean> {
  const probe = await shell.execute(`command -v ${binary}`, PROBE_TIMEOUT_MS);
  return probe.exitCode === 0;
}

/** The nvidia path: full per-GPU metrics. */
async function readNvidia(shell: ShellExecutor, format: ResponseFormat): Promise<CallToolResult> {
  const result = await shell.execute(NVIDIA_QUERY, QUERY_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return toolError(`nvidia-smi failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  const gpus = parseNvidia(result.stdout);
  return formatResponse(format, summarizeNvidia(gpus), { vendor: "nvidia", gpus });
}

/** The intel path: detection plus a bounded raw sample (best-effort). */
/** A parsed intel_gpu_top sample: the last complete period of the capture. */
export interface IntelSample {
  frequencyMhz: number | null;
  rc6Percent: number | null;
  engines: Array<{ name: string; busyPercent: number }>;
  clients: Array<{ name: string; pid: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `record[key].field` as a number, or null when absent/non-numeric. */
function nestedNumber(record: Record<string, unknown>, key: string, field: string): number | null {
  const inner = record[key];
  if (!isRecord(inner)) {
    return null;
  }
  const value = Number(inner[field]);
  return Number.isFinite(value) ? value : null;
}

/** intel_gpu_top -J is killed by `timeout`, so the array is usually unterminated. */
function parseIntelArray(raw: string): unknown[] | null {
  const trimmed = raw.trim().replace(/,\s*$/, "");
  for (const candidate of [trimmed, `${trimmed}]`]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function parseEngines(engines: unknown): IntelSample["engines"] {
  if (!isRecord(engines)) {
    return [];
  }
  return Object.entries(engines).map(([name, engine]) => ({
    name,
    busyPercent: isRecord(engine) ? Number(engine.busy) || 0 : 0,
  }));
}

function parseClients(clients: unknown): IntelSample["clients"] {
  if (!isRecord(clients)) {
    return [];
  }
  return Object.values(clients)
    .filter(isRecord)
    .map((client) => ({ name: String(client.name ?? "?"), pid: String(client.pid ?? "?") }));
}

/**
 * Parses the last complete period of an `intel_gpu_top -J` capture.
 *
 * @param raw - The tool's stdout (a JSON array, usually unterminated because `timeout` kills it).
 * @returns The last sample, or null when nothing parsable was captured.
 * @example
 * parseIntelSample('[{"frequency":{"actual":46.9},"engines":{"Video":{"busy":0.4}}}')?.frequencyMhz; // 46.9
 */
export function parseIntelSample(raw: string): IntelSample | null {
  const periods = parseIntelArray(raw);
  const last = periods?.at(-1);
  if (!isRecord(last)) {
    return null;
  }
  return {
    frequencyMhz: nestedNumber(last, "frequency", "actual"),
    rc6Percent: nestedNumber(last, "rc6", "value"),
    engines: parseEngines(last.engines),
    clients: parseClients(last.clients),
  };
}

/** One human line: frequency, idle share, engine load, and the processes using the GPU. */
function summarizeIntel(sample: IntelSample): string {
  const frequency =
    sample.frequencyMhz === null ? "? MHz" : `${Math.round(sample.frequencyMhz)} MHz`;
  const rc6 = sample.rc6Percent === null ? "" : `, rc6 ${Math.round(sample.rc6Percent)}% idle`;
  const engines = sample.engines
    .map((e) => `${e.name} ${e.busyPercent.toFixed(1)}% busy`)
    .join(", ");
  const clients = sample.clients.map((c) => `${c.name} (pid ${c.pid})`).join(", ") || "none";
  return `Intel GPU (intel_gpu_top): ${frequency} actual${rc6}; engines: ${engines || "none reported"}; clients: ${clients}`;
}

async function readIntel(shell: ShellExecutor, format: ResponseFormat): Promise<CallToolResult> {
  const result = await shell.execute(INTEL_SAMPLE, QUERY_TIMEOUT_MS);
  const rawSample = truncateOutput(result.stdout.trim());
  const sample = parseIntelSample(rawSample);
  if (sample) {
    return formatResponse(format, summarizeIntel(sample), { vendor: "intel", sample, rawSample });
  }
  const summary = rawSample
    ? `Intel GPU tooling detected (intel_gpu_top). Raw 3-second sample:\n${rawSample}`
    : "Intel GPU tooling detected (intel_gpu_top), but the sample returned no data (the tool may need a busier GPU or root).";
  return formatResponse(format, summary, {
    vendor: "intel",
    sample: null,
    rawSample: rawSample || null,
  });
}

export function createGpuMetricsHandler(shell: ShellExecutor | null) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      if (await hasCommand(shell, "nvidia-smi")) {
        return await readNvidia(shell, input.response_format);
      }
      if (await hasCommand(shell, "intel_gpu_top")) {
        return await readIntel(shell, input.response_format);
      }
      return toolError(
        "No GPU tooling found on this server: neither nvidia-smi nor intel_gpu_top is installed. Each ships with its vendor driver plugin (e.g. Nvidia-Driver / Intel-GPU-TOP from Community Applications).",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read GPU metrics over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `gpu_metrics` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerGpuMetrics(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "GPU Metrics",
      description:
        "Read-only. GPU utilization over SSH: full per-GPU metrics via nvidia-smi (utilization, VRAM, temperature, power) when the NVIDIA driver plugin is installed; a one-line summary (frequency, idle share, engine load, GPU clients) parsed from intel_gpu_top for Intel; a clear absence report otherwise.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createGpuMetricsHandler(shell),
  );
}
