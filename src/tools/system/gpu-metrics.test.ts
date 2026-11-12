import { describe, expect, it } from "vitest";
import {
  firstText,
  rejectingShell,
  sequencedShell,
  throwingShell,
} from "../_shared/test-support.js";
import { createGpuMetricsHandler, parseIntelSample } from "./gpu-metrics.js";

/** intel_gpu_top -J output as killed by `timeout`: an unterminated JSON array. */
const INTEL_RAW = `[
{"period":{"duration":60,"unit":"ms"},"frequency":{"actual":192.1,"unit":"MHz"},"rc6":{"value":60.7,"unit":"%"},"engines":{"Render/3D":{"busy":0,"unit":"%"},"Video":{"busy":2.5,"unit":"%"}},"clients":{"1":{"name":"Plex Transcoder","pid":"621914"}}},
{"period":{"duration":1043,"unit":"ms"},"frequency":{"actual":46.9,"unit":"MHz"},"rc6":{"value":67.4,"unit":"%"},"engines":{"Render/3D":{"busy":0,"unit":"%"},"Video":{"busy":0.38,"unit":"%"}},"clients":{"1":{"name":"Plex Transcoder","pid":"621914"}}}`;

const found = { stdout: "/usr/bin/x\n", stderr: "", exitCode: 0 };
const missing = { stdout: "", stderr: "", exitCode: 1 };

describe("gpu_metrics", () => {
  it("parses nvidia-smi metrics when available", async () => {
    const { shell, calls } = sequencedShell([
      found,
      { stdout: "NVIDIA GeForce RTX 3060, 17, 2048, 12288, 54, 41.3\n", stderr: "", exitCode: 0 },
    ]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });
    const text = firstText(result);

    expect(calls[0].command).toBe("command -v nvidia-smi");
    expect(text).toContain("RTX 3060");
    expect(text).toContain("17% util");
    expect(text).toContain("54°C");
  });

  it("summarizes the intel sample in one line", async () => {
    const { shell, calls } = sequencedShell([
      missing,
      found,
      { stdout: INTEL_RAW, stderr: "", exitCode: 124 },
    ]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });
    const text = firstText(result);

    expect(calls[1].command).toBe("command -v intel_gpu_top");
    expect(text).toContain("Intel GPU");
    expect(text).toContain("Video 0.4% busy");
    expect(text).toContain("Plex Transcoder (pid 621914)");
    expect(text).toContain("47 MHz");
  });

  it("falls back to the raw intel sample when it cannot be parsed", async () => {
    const { shell } = sequencedShell([
      missing,
      found,
      { stdout: "not json at all", stderr: "", exitCode: 124 },
    ]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("Intel GPU tooling detected");
    expect(firstText(result)).toContain("not json at all");
  });

  it("reports a clear absence when no tooling exists", async () => {
    const { shell } = sequencedShell([missing, missing]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("No GPU tooling found");
  });
});

/** The format actually observed on Unraid 7.3.2: tab-indented objects with NO separating commas, last one cut mid-way. */
const INTEL_RAW_DEVICE = `[

{
\t"period": {
\t\t"duration": 56.4,
\t\t"unit": "ms"
\t},
\t"frequency": {
\t\t"requested": 0.0,
\t\t"actual": 0.0,
\t\t"unit": "MHz"
\t},
\t"rc6": {
\t\t"value": 0.0,
\t\t"unit": "%"
\t},
\t"engines": {
\t\t"Video": {
\t\t\t"busy": 0.0,
\t\t\t"unit": "%"
\t\t}
\t},
\t"clients": {

\t}
}
{
\t"period": {
\t\t"duration": 1041.4,
\t\t"unit": "ms"
\t},
\t"frequency": {
\t\t"requested": 2454.2,
\t\t"actual": 46.9,
\t\t"unit": "MHz"
\t},
\t"rc6": {
\t\t"value": 60.7,
\t\t"unit": "%"
\t},
\t"engines": {
\t\t"Video": {
\t\t\t"busy": 0.39,
\t\t\t"unit": "%"
\t\t}
\t},
\t"clients": {
\t\t"4294345382": {
\t\t\t"name": "Plex Transcoder",
\t\t\t"pid": "621914"
\t\t}
\t}
}
{
\t"period": {
\t\t"duration": 10`;

describe("parseIntelSample", () => {
  it("parses the last COMPLETE object of the newline-separated device format", () => {
    const sample = parseIntelSample(INTEL_RAW_DEVICE);

    expect(sample?.frequencyMhz).toBeCloseTo(46.9);
    expect(sample?.engines).toEqual([{ name: "Video", busyPercent: 0.39 }]);
    expect(sample?.clients).toEqual([{ name: "Plex Transcoder", pid: "621914" }]);
  });

  it("parses the LAST object of an unterminated intel_gpu_top -J array", () => {
    const sample = parseIntelSample(INTEL_RAW);

    expect(sample?.frequencyMhz).toBeCloseTo(46.9);
    expect(sample?.rc6Percent).toBeCloseTo(67.4);
    expect(sample?.engines).toEqual([
      { name: "Render/3D", busyPercent: 0 },
      { name: "Video", busyPercent: 0.38 },
    ]);
    expect(sample?.clients).toEqual([{ name: "Plex Transcoder", pid: "621914" }]);
  });

  it("parses a properly terminated array too", () => {
    const sample = parseIntelSample(`${INTEL_RAW}\n]`);

    expect(sample?.frequencyMhz).toBeCloseTo(46.9);
  });

  it("returns null for unparsable output", () => {
    expect(parseIntelSample("garbage")).toBeNull();
    expect(parseIntelSample("")).toBeNull();
  });
});

describe("parseIntelSample malformed fields", () => {
  it("reads non-object or non-numeric frequency and rc6 as unknown", () => {
    const sample = parseIntelSample('{"frequency":5,"rc6":{"value":"n/a"}}');

    expect(sample?.frequencyMhz).toBeNull();
    expect(sample?.rc6Percent).toBeNull();
  });

  it("reads non-object engine and client maps as empty", () => {
    const sample = parseIntelSample('{"engines":["Video"],"clients":"none"}');

    expect(sample?.engines).toEqual([]);
    expect(sample?.clients).toEqual([]);
  });

  it("treats a non-object engine as idle and fills in unnamed clients", () => {
    const sample = parseIntelSample('{"engines":{"Video":5},"clients":{"1":{},"2":7}}');

    expect(sample?.engines).toEqual([{ name: "Video", busyPercent: 0 }]);
    expect(sample?.clients).toEqual([{ name: "?", pid: "?" }]);
  });

  it("ignores a brace-balanced fragment that is not valid JSON", () => {
    const sample = parseIntelSample('{"frequency":{"actual":300}}\n{not json}');

    expect(sample?.frequencyMhz).toBe(300);
  });
});

describe("gpu_metrics intel edge cases and failures", () => {
  it("renders placeholders for an intel sample with no readings", async () => {
    const { shell } = sequencedShell([
      missing,
      found,
      { stdout: '[{"period":{}}', stderr: "", exitCode: 124 },
    ]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe(
      "Intel GPU (intel_gpu_top): ? MHz actual; engines: none reported; clients: none",
    );
  });

  it("says the intel sample was empty and records no raw sample", async () => {
    const { shell } = sequencedShell([missing, found, { stdout: "  ", stderr: "", exitCode: 124 }]);
    const handler = createGpuMetricsHandler(shell);

    const concise = await handler({ response_format: "concise" });
    const { shell: detailedShell } = sequencedShell([
      missing,
      found,
      { stdout: "", stderr: "", exitCode: 1 },
    ]);
    const detailed = await createGpuMetricsHandler(detailedShell)({ response_format: "detailed" });

    expect(firstText(concise)).toContain("but the sample returned no data");
    expect(JSON.parse(firstText(detailed))).toEqual({
      vendor: "intel",
      sample: null,
      rawSample: null,
    });
  });

  it("surfaces an nvidia-smi failure with its stderr", async () => {
    const { shell } = sequencedShell([
      found,
      { stdout: "", stderr: "NVML: driver not loaded\n", exitCode: 9 },
    ]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("nvidia-smi failed (exit 9): NVML: driver not loaded");
  });

  it("reports SSH unavailable without a shell", async () => {
    const handler = createGpuMetricsHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("maps an SSH failure to a clean error", async () => {
    const handler = createGpuMetricsHandler(throwingShell("connection refused"));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to read GPU metrics over SSH: connection refused");
  });

  it("reports a non-Error SSH rejection as text", async () => {
    const handler = createGpuMetricsHandler(rejectingShell("channel closed"));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to read GPU metrics over SSH: channel closed");
  });
});
