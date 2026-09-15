import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { createDockerStatsHandler } from "./docker-stats.js";

const twoContainers = {
  stdout: [
    '{"Name":"idle","CPUPerc":"0.05%","MemUsage":"50MiB / 16GiB","MemPerc":"0.30%","NetIO":"1kB / 2kB","BlockIO":"0B / 0B","PIDs":"3"}',
    '{"Name":"hog","CPUPerc":"92.10%","MemUsage":"4GiB / 16GiB","MemPerc":"25.00%","NetIO":"1MB / 2MB","BlockIO":"5MB / 1MB","PIDs":"40"}',
  ].join("\n"),
  stderr: "",
  exitCode: 0,
};

describe("docker_stats", () => {
  it("refuses with configuration guidance when SSH is not set up", async () => {
    const handler = createDockerStatsHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("UNRAID_SSH_HOST");
  });

  it("runs the fixed docker stats command", async () => {
    const { shell, calls } = recordingShell(twoContainers);
    const handler = createDockerStatsHandler(shell);

    await handler({ response_format: "concise" });

    expect(calls[0]?.command).toBe("docker stats --no-stream --format '{{json .}}'");
  });

  it("sorts containers by CPU usage, hungriest first", async () => {
    const { shell } = recordingShell(twoContainers);
    const handler = createDockerStatsHandler(shell);

    const result = await handler({ response_format: "concise" });

    const text = firstText(result);
    expect(text.indexOf("hog")).toBeLessThan(text.indexOf("idle"));
    expect(text).toContain("CPU 92.10%");
  });

  it("reports zero running containers explicitly", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 0 });
    const handler = createDockerStatsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("No running containers");
  });

  it("skips non-JSON noise lines instead of failing", async () => {
    const { shell } = recordingShell({
      stdout: `WARNING: something\n{"Name":"ok","CPUPerc":"1.00%"}\n`,
      stderr: "",
      exitCode: 0,
    });
    const handler = createDockerStatsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("ok");
  });

  it("surfaces a docker failure as a tool error with stderr", async () => {
    const { shell } = recordingShell({
      stdout: "",
      stderr: "Cannot connect to the Docker daemon",
      exitCode: 1,
    });
    const handler = createDockerStatsHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Docker daemon");
  });

  it("returns the parsed rows in detailed format", async () => {
    const { shell } = recordingShell(twoContainers);
    const handler = createDockerStatsHandler(shell);

    const result = await handler({ response_format: "detailed" });

    const payload = JSON.parse(firstText(result));
    expect(payload.source).toBe("ssh");
    expect(payload.containers).toHaveLength(2);
    expect(payload.containers[0]).toMatchObject({ Name: "hog" });
  });

  it("maps transport failures to a tool error", async () => {
    const handler = createDockerStatsHandler(throwingShell("connect ETIMEDOUT"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ETIMEDOUT");
  });
});

describe("docker_stats live subscription preference", () => {
  const liveSample = {
    containers: {
      "c-1": {
        id: "c-1",
        cpuPercent: 42.5,
        memUsage: "1GiB / 8GiB",
        memPercent: 12.5,
        netIO: "1MB / 2MB",
        blockIO: "0B / 0B",
      },
    },
  };

  function storeWith(ageMs: number) {
    return {
      get: (topic: string) =>
        topic === "dockerContainerStats" ? { data: liveSample, ageMs } : null,
    } as never;
  }

  it("serves a fresh live sample without touching the shell", async () => {
    const { shell, calls } = recordingShell(twoContainers);
    const handler = createDockerStatsHandler(shell, storeWith(2_000));

    const result = await handler({ response_format: "concise" });

    expect(calls).toHaveLength(0);
    expect(firstText(result)).toContain("source: live subscription");
    expect(firstText(result)).toContain("c-1");
  });

  it("falls back to SSH when the live sample is stale and says so", async () => {
    const { shell, calls } = recordingShell(twoContainers);
    const handler = createDockerStatsHandler(shell, storeWith(60_000));

    const result = await handler({ response_format: "concise" });

    expect(calls).toHaveLength(1);
    expect(firstText(result)).toContain("(source: ssh)");
  });
});
