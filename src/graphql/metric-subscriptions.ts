/** The three system-metric feeds the history recorder and the live resource share. */
export type MetricTopic = "cpu" | "memory" | "network";

/** One graphql-ws subscription: the feed topic (root field) and its document. */
export interface MetricSubscription {
  topic: MetricTopic;
  feedTopic: string;
  query: string;
}

export const METRIC_SUBSCRIPTIONS: Record<MetricTopic, MetricSubscription> = {
  cpu: {
    topic: "cpu",
    feedTopic: "systemMetricsCpu",
    query: "subscription { systemMetricsCpu { percentTotal cpus { percentTotal } } }",
  },
  memory: {
    topic: "memory",
    feedTopic: "systemMetricsMemory",
    query: "subscription { systemMetricsMemory { total used free available percentTotal } }",
  },
  network: {
    topic: "network",
    feedTopic: "systemMetricsNetwork",
    query:
      "subscription { systemMetricsNetwork { name operstate rxSec txSec utilizationPercent } }",
  },
};

/** The loopback interface only echoes local traffic; it would double-count throughput. */
const LOOPBACK_INTERFACE = "lo";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cpuSeries(payload: unknown): Record<string, number> | null {
  const percent = isRecord(payload) ? finiteNumber(payload.percentTotal) : null;
  return percent === null ? null : { percent };
}

function memorySeries(payload: unknown): Record<string, number> | null {
  if (!isRecord(payload)) {
    return null;
  }
  const percent = finiteNumber(payload.percentTotal);
  const usedBytes = finiteNumber(payload.used);
  return percent === null || usedBytes === null ? null : { percent, usedBytes };
}

function networkSeries(payload: unknown): Record<string, number> | null {
  if (!Array.isArray(payload)) {
    return null;
  }
  let rxBytesPerSec = 0;
  let txBytesPerSec = 0;
  for (const entry of payload) {
    if (!isRecord(entry) || entry.name === LOOPBACK_INTERFACE) {
      continue;
    }
    rxBytesPerSec += finiteNumber(entry.rxSec) ?? 0;
    txBytesPerSec += finiteNumber(entry.txSec) ?? 0;
  }
  return { rxBytesPerSec, txBytesPerSec };
}

/**
 * Extracts the scalar series the history recorder keeps from one feed sample.
 *
 * @param topic - Which metric feed the sample came from.
 * @param sample - The raw `data` object delivered by the subscription.
 * @returns Named numeric series, or null when the sample carries no usable numbers.
 * @example
 * extractSeries("cpu", { systemMetricsCpu: { percentTotal: 12.5 } }); // { percent: 12.5 }
 */
export function extractSeries(topic: MetricTopic, sample: unknown): Record<string, number> | null {
  const payload = isRecord(sample) ? sample[METRIC_SUBSCRIPTIONS[topic].feedTopic] : null;
  switch (topic) {
    case "cpu":
      return cpuSeries(payload);
    case "memory":
      return memorySeries(payload);
    case "network":
      return networkSeries(payload);
  }
}
