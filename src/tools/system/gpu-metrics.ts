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
async function readIntel(shell: ShellExecutor, format: ResponseFormat): Promise<CallToolResult> {
  const result = await shell.execute(INTEL_SAMPLE, QUERY_TIMEOUT_MS);
  const sample = truncateOutput(result.stdout.trim());
  const summary = sample
    ? `Intel GPU tooling detected (intel_gpu_top). Raw 3-second sample:\n${sample}`
    : "Intel GPU tooling detected (intel_gpu_top), but the sample returned no data (the tool may need a busier GPU or root).";
  return formatResponse(format, summary, { vendor: "intel", rawSample: sample || null });
}

/**
 * Creates the `gpu_metrics` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler reporting GPU utilization where tooling exists.
 */
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
        "Read-only. GPU utilization over SSH: full per-GPU metrics via nvidia-smi (utilization, VRAM, temperature, power) when the NVIDIA driver plugin is installed; a bounded raw sample via intel_gpu_top for Intel; a clear absence report otherwise.",
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
