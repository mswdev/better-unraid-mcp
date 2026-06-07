import { describe, expect, it } from "vitest";
import type { SystemMetricsQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createSystemMetricsHandler } from "./system-metrics.js";

const eth0 = {
  name: "eth0",
  operstate: "up",
  rxSec: 1258291.2,
  txSec: 348160,
  utilizationPercent: 1.2,
  bytesReceived: "1234567890",
  bytesSent: "987654321",
  receiveErrors: "0",
  transmitErrors: "0",
  receiveDropped: "0",
  transmitDropped: "0",
  lastUpdated: "2026-06-06T12:00:08.000Z",
};

const full = {
  metrics: {
    cpu: { percentTotal: 12.3, cpus: [{ percentTotal: 5.1 }, { percentTotal: 45.2 }] },
    memory: {
      total: "33715179520",
      used: "30000000000",
      free: "1000000000",
      available: "18253611008",
      percentTotal: 45.9,
      swapTotal: "2147483648",
      swapUsed: "0",
      percentSwapTotal: 0,
    },
    temperature: {
      sensors: [
        {
          name: "CPU Package",
          type: "CPU_PACKAGE",
          current: { value: 55.5, unit: "CELSIUS", status: "NORMAL" },
          warning: 85,
          critical: 95,
        },
      ],
      summary: {
        average: 42.1,
        warningCount: 0,
        criticalCount: 0,
        hottest: { name: "CPU Package", current: { value: 55.5, unit: "CELSIUS" } },
      },
    },
    network: [eth0, { ...eth0, name: "lo", operstate: "unknown" }],
  },
  systemTime: {
    currentTime: "2026-06-06T16:00:08.000Z",
    timeZone: "America/New_York",
    useNtp: true,
  },
} satisfies SystemMetricsQuery;

describe("system_metrics handler", () => {
  it("omits temperature by default and passes includeTemperature=false", async () => {
    const { executor, calls } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(calls[0]?.variables).toMatchObject({ includeTemperature: false });
    const text = firstText(result);
    expect(text).toMatch(/As of 2026-06-06T16:00:08\.000Z \(America\/New_York, NTP on\):/);
    expect(text).toMatch(/CPU: 12% total, 2 threads \(busiest 45%\)/);
    expect(text).not.toMatch(/Temperature/);
  });

  it("pairs memory percent with available bytes, never the cache-inclusive used figure", async () => {
    const { executor } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(
      /Memory: 46% used — 17\.0 GB available of 31\.4 GB \(swap 0%\)/,
    );
  });

  it("renders temperature when requested and populated", async () => {
    const { executor, calls } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: true,
    });

    expect(calls[0]?.variables).toMatchObject({ includeTemperature: true });
    expect(firstText(result)).toMatch(
      /Temperature: avg 42\.1°C — 0 warning, 0 critical \(hottest: CPU Package 55\.5°C\)/,
    );
  });

  it("reports unavailable temperature when requested but null", async () => {
    const nullTemp = {
      metrics: { ...full.metrics, temperature: null },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(nullTemp);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: true,
    });

    expect(firstText(result)).toMatch(/Temperature: unavailable/);
  });

  it("renders up interfaces with rates and counts the rest", async () => {
    const { executor } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(
      /Network: eth0 up — rx 1\.2 MB\/s, tx 340\.0 KB\/s, 0 errors \(1 not up omitted\)/,
    );
  });

  it("falls back per section when cpu or memory is null", async () => {
    const degraded = {
      metrics: { ...full.metrics, cpu: null, memory: null },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(degraded);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/CPU: unavailable/);
    expect(firstText(result)).toMatch(/Memory: unavailable/);
  });

  it("reports when interfaces exist but none are up", async () => {
    const allDown = {
      metrics: {
        ...full.metrics,
        network: [
          { ...eth0, operstate: "down" },
          { ...eth0, name: "lo", operstate: "unknown" },
        ],
      },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(allDown);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/Network: no interfaces up \(2 reported\)/);
  });

  it("omits the not-up note when every interface is up", async () => {
    const allUp = {
      metrics: { ...full.metrics, network: [eth0] },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(allUp);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/Network: eth0 up/);
    expect(firstText(result)).not.toMatch(/omitted/);
  });

  it("omits the busiest note when the cpu section has no per-core data", async () => {
    const noCores = {
      metrics: { ...full.metrics, cpu: { percentTotal: 3.2, cpus: [] } },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(noCores);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/CPU: 3% total, 0 threads/);
    expect(firstText(result)).not.toMatch(/busiest/);
  });

  it("renders the suffix of a non-Celsius temperature unit", async () => {
    const fahrenheit = {
      metrics: {
        ...full.metrics,
        temperature: {
          sensors: full.metrics.temperature.sensors,
          summary: {
            ...full.metrics.temperature.summary,
            average: 107.8,
            hottest: { name: "CPU Package", current: { value: 131.9, unit: "FAHRENHEIT" } },
          },
        },
      },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(fahrenheit);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: true,
    });

    expect(firstText(result)).toMatch(/avg 107\.8°F/);
    expect(firstText(result)).toMatch(/hottest: CPU Package 131\.9°F/);
  });

  it("reports when no interfaces are listed", async () => {
    const noNet = {
      metrics: { ...full.metrics, network: [] },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(noNet);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/Network: no interfaces reported/);
  });

  it("returns the pinned raw payload for detailed", async () => {
    const { executor } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "detailed",
      include_temperature: true,
    });

    expect(JSON.parse(firstText(result))).toEqual(full);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createSystemMetricsHandler(throwingExecutor("probe failed"))({
      response_format: "concise",
      include_temperature: false,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch system metrics/);
    expect(firstText(result)).toMatch(/probe failed/);
  });

  it("coerces a non-Error rejection to a string", async () => {
    const result = await createSystemMetricsHandler(rejectingExecutor("plain refusal"))({
      response_format: "concise",
      include_temperature: false,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/plain refusal/);
  });
});
