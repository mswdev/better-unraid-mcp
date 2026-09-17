import { describe, expect, it } from "vitest";
import { METRIC_SUBSCRIPTIONS, extractSeries } from "./metric-subscriptions.js";

describe("METRIC_SUBSCRIPTIONS", () => {
  it("names the three system-metric feed topics", () => {
    expect(METRIC_SUBSCRIPTIONS.cpu.feedTopic).toBe("systemMetricsCpu");
    expect(METRIC_SUBSCRIPTIONS.memory.feedTopic).toBe("systemMetricsMemory");
    expect(METRIC_SUBSCRIPTIONS.network.feedTopic).toBe("systemMetricsNetwork");
    expect(METRIC_SUBSCRIPTIONS.network.query).toContain("subscription { systemMetricsNetwork");
  });
});

describe("extractSeries", () => {
  it("reads the cpu percent", () => {
    expect(extractSeries("cpu", { systemMetricsCpu: { percentTotal: 12.5, cpus: [] } })).toEqual({
      percent: 12.5,
    });
  });

  it("reads memory percent and used bytes", () => {
    const sample = {
      systemMetricsMemory: { total: 100, used: 40, free: 60, available: 60, percentTotal: 40 },
    };

    expect(extractSeries("memory", sample)).toEqual({ percent: 40, usedBytes: 40 });
  });

  it("sums network throughput across interfaces, excluding loopback", () => {
    const sample = {
      systemMetricsNetwork: [
        { name: "lo", rxSec: 999, txSec: 999 },
        { name: "br0", rxSec: 100, txSec: 10 },
        { name: "eth1", rxSec: 5, txSec: 2.5 },
      ],
    };

    expect(extractSeries("network", sample)).toEqual({ rxBytesPerSec: 105, txBytesPerSec: 12.5 });
  });

  it("returns null for samples without usable numbers", () => {
    expect(extractSeries("cpu", { systemMetricsCpu: { percentTotal: "n/a" } })).toBeNull();
    expect(extractSeries("memory", null)).toBeNull();
    expect(extractSeries("network", { systemMetricsNetwork: "nope" })).toBeNull();
  });
});
