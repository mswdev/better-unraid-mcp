import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  SystemHealthDocument,
  type SystemHealthQuery,
  UpsStatusDocument,
  type UpsStatusQuery,
} from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createSystemHealthHandler } from "./system-health.js";

/** No UPS reporting at all — the common case on servers without apcupsd. */
const NO_UPS: UpsStatusQuery = { upsDevices: [] };

/** One UPS device with the given name/status; the other fields are required by the generated type. */
function upsDevice(name: string, status: string): UpsStatusQuery {
  return {
    upsDevices: [
      {
        id: name,
        name,
        model: "model",
        status,
        battery: { chargeLevel: 100, estimatedRuntime: 600 },
        power: {
          inputVoltage: 120,
          outputVoltage: 120,
          loadPercentage: 20,
          nominalPower: null,
          currentPower: null,
        },
      },
    ],
  };
}

/**
 * Answers the health and UPS documents independently; `ups` may be an Error
 * to simulate the upstream apcaccess throw (NUT-managed servers).
 */
function healthExecutor(health: SystemHealthQuery, ups: UpsStatusQuery | Error): GraphQLExecutor {
  return {
    execute: async (document) => {
      const requested: unknown = document;
      if (requested === SystemHealthDocument) {
        return health as never;
      }
      if (requested === UpsStatusDocument) {
        if (ups instanceof Error) {
          throw ups;
        }
        return ups as never;
      }
      throw new Error("unexpected document");
    },
  };
}

/** The recordingExecutor replacement: health fixture plus no UPS. */
function recordingExecutor(fixture: SystemHealthQuery): { executor: GraphQLExecutor } {
  return { executor: healthExecutor(fixture, NO_UPS) };
}

/**
 * A fully-healthy snapshot typed against the generated query — the repo's
 * codegen-drift tripwire. Tests vary one field at a time.
 */
function healthyFixture(): SystemHealthQuery {
  return {
    array: {
      state: "STARTED",
      capacity: { kilobytes: { used: "1000", total: "10000" } },
      parityCheckStatus: { status: "COMPLETED", errors: 0, running: false },
      parities: [{ name: "parity", status: "DISK_OK", temp: 35 }],
      disks: [{ name: "disk1", status: "DISK_OK", temp: 38, numErrors: "0" }],
      caches: [{ name: "cache", status: "DISK_OK", temp: 40 }],
    },
    notifications: { overview: { unread: { warning: 0, alert: 0 } } },
    docker: { containers: [{ isUpdateAvailable: false }] },
  };
}

describe("system_health", () => {
  it("reports ok overall when everything is healthy", async () => {
    const { executor } = recordingExecutor(healthyFixture());
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
    expect(result.structuredContent).toMatchObject({ overall: "ok" });
  });

  it("flags critical capacity above 95 percent", async () => {
    const fixture = healthyFixture();
    fixture.array.capacity.kilobytes = { used: "9600", total: "10000" };
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: CRITICAL");
  });

  it("flags warning capacity above 90 percent", async () => {
    const fixture = healthyFixture();
    fixture.array.capacity.kilobytes = { used: "9200", total: "10000" };
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });

  it("flags a faulted disk as critical", async () => {
    const fixture = healthyFixture();
    fixture.array.disks[0].status = "DISK_DSBL";
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: CRITICAL");
  });

  it("flags a hot disk as warning", async () => {
    const fixture = healthyFixture();
    fixture.array.disks[0].temp = 52;
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });

  it("flags an array that is not started", async () => {
    const fixture = healthyFixture();
    fixture.array.state = "STOPPED";
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });

  it("flags parity errors as a warning", async () => {
    const fixture = healthyFixture();
    fixture.array.parityCheckStatus = { status: "COMPLETED", errors: 3, running: false };
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });

  it("flags unread alerts as critical", async () => {
    const fixture = healthyFixture();
    fixture.notifications.overview.unread.alert = 2;
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: CRITICAL");
  });

  it("flags unread warnings as warning", async () => {
    const fixture = healthyFixture();
    fixture.notifications.overview.unread.warning = 4;
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });

  it("flags a UPS on battery as critical", async () => {
    const executor = healthExecutor(healthyFixture(), upsDevice("ups", "ONBATT"));
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: CRITICAL");
  });

  it("counts pending container updates as a warning", async () => {
    const fixture = healthyFixture();
    fixture.docker.containers = [{ isUpdateAvailable: true }, { isUpdateAvailable: true }];
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });

  it("returns per-subsystem JSON in detailed mode", async () => {
    const { executor } = recordingExecutor(healthyFixture());
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as { overall: string; subsystems: unknown[] };

    expect(parsed.overall).toBe("ok");
    expect(parsed.subsystems.length).toBeGreaterThanOrEqual(6);
  });

  it("maps executor failures to a clean error", async () => {
    const handler = createSystemHealthHandler(throwingExecutor("boom"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
  });
});

describe("system_health UPS semantics", () => {
  it("treats a status-less phantom UPS device as absence, not an outage", async () => {
    const executor = healthExecutor(healthyFixture(), upsDevice("ups", ""));
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
  });

  it("accepts multi-token statuses containing ONLINE", async () => {
    const executor = healthExecutor(healthyFixture(), upsDevice("ups", "ONLINE SLAVE"));
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
  });

  it("reports the ups subsystem as unavailable (not a failure) when the UPS query throws", async () => {
    const failure = new Error("Failed to get UPS data: No UPS data returned from apcaccess");
    const handler = createSystemHealthHandler(healthExecutor(healthyFixture(), failure));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("OVERALL: OK");
    expect(firstText(result)).toMatch(/ups: UPS data unavailable .*apcaccess/);
  });

  it("flags a UPS that is offline but not on battery as a warning", async () => {
    const executor = healthExecutor(healthyFixture(), upsDevice("ups", "COMMLOST"));
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
  });
});

describe("system_health partial readings", () => {
  it("reports capacity as not reported when the total is unparseable", async () => {
    const fixture = healthyFixture();
    fixture.array.capacity.kilobytes.total = "n/a";
    const handler = createSystemHealthHandler(recordingExecutor(fixture).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("✓ capacity: Capacity not reported.");
  });

  it("treats a null disk status as an empty slot and a null temperature as cool", async () => {
    const fixture = healthyFixture();
    fixture.array.parities[0] = { name: "parity", status: null, temp: null };
    const handler = createSystemHealthHandler(recordingExecutor(fixture).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("✓ disks: 3 disks healthy.");
  });

  it("flags a disk at the critical temperature as critical", async () => {
    const fixture = healthyFixture();
    fixture.array.caches[0].temp = 60;
    const handler = createSystemHealthHandler(recordingExecutor(fixture).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("⚠ disks: Disk problems: cache (critical).");
  });

  it("names a faulted disk with no name as unnamed", async () => {
    const fixture = healthyFixture();
    fixture.array.disks[0] = { name: null, status: "DISK_INVALID", temp: 30, numErrors: "0" };
    const handler = createSystemHealthHandler(recordingExecutor(fixture).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("Disk problems: (unnamed) (critical).");
  });

  it("mentions a parity check in progress", async () => {
    const fixture = healthyFixture();
    fixture.array.parityCheckStatus.running = true;
    const handler = createSystemHealthHandler(recordingExecutor(fixture).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain(
      "✓ parity: No parity errors reported. A parity check is running.",
    );
  });
});

describe("system_health non-Error failures", () => {
  it("quotes a non-Error UPS rejection in the ups detail", async () => {
    const executor: GraphQLExecutor = {
      execute: async (document) => {
        const requested: unknown = document;
        if (requested === UpsStatusDocument) {
          return Promise.reject("apcaccess timed out");
        }
        return healthyFixture() as never;
      },
    };
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toMatch(/ups: UPS data unavailable .*\(apcaccess timed out\)\.$/m);
  });

  it("reports a non-Error health-read rejection as text", async () => {
    const handler = createSystemHealthHandler(rejectingExecutor("socket hang up"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to compute system health: socket hang up");
  });
});
