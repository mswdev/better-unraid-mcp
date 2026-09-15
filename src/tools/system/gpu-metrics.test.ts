import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createGpuMetricsHandler } from "./gpu-metrics.js";

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

  it("falls back to intel detection with a bounded sample", async () => {
    const { shell, calls } = sequencedShell([
      missing,
      found,
      { stdout: '{"engines": {}}', stderr: "", exitCode: 124 },
    ]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(calls[1].command).toBe("command -v intel_gpu_top");
    expect(firstText(result)).toContain("Intel GPU tooling detected");
  });

  it("reports a clear absence when no tooling exists", async () => {
    const { shell } = sequencedShell([missing, missing]);
    const handler = createGpuMetricsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("No GPU tooling found");
  });
});
