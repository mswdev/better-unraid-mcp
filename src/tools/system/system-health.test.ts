import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ParityHistoryDocument,
  type ParityHistoryQuery,
  SystemHealthDocument,
  type SystemHealthQuery,
  UpsStatusDocument,
  type UpsStatusQuery,
} from "../../types/unraid/graphql.js";
import { DOCKER_UNAVAILABLE } from "../_shared/errors/require-service.js";
import { firstText, throwingExecutor } from "../_shared/test-support.js";
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

/** One parity-history entry; tests override only the fields they exercise. */
function parityCheck(
  overrides: Partial<ParityHistoryQuery["parityHistory"][number]> = {},
): ParityHistoryQuery["parityHistory"][number] {
  return {
    date: "2026-05-30T00:00:00Z",
    duration: 3600,
    speed: "180",
    status: "COMPLETED",
    errors: 0,
    correcting: null,
    ...overrides,
  };
}

/** A clean history: one completed check with no errors. */
const CLEAN_HISTORY: ParityHistoryQuery = { parityHistory: [parityCheck()] };

/** The canned answers for each document the rollup reads; an Error is thrown instead. */
interface HealthAnswers {
  health: SystemHealthQuery;
  ups?: UpsStatusQuery | Error;
  parity?: ParityHistoryQuery | Error;
}

/** Returns the canned answer, or throws it when it is an Error. */
function answer(value: unknown): never {
  if (value instanceof Error) {
    throw value;
  }
  return value as never;
}

/**
 * Answers the health, UPS and parity-history documents independently. `ups`
 * may be an Error to simulate the upstream apcaccess throw (NUT-managed
 * servers); `parity` may be an Error to simulate a missing parity-check log.
 */
function healthExecutor(answers: HealthAnswers): GraphQLExecutor {
  const { health, ups = NO_UPS, parity = CLEAN_HISTORY } = answers;
  return {
    execute: async (document) => {
      const requested: unknown = document;
      if (requested === SystemHealthDocument) {
        return health as never;
      }
      if (requested === UpsStatusDocument) {
        return answer(ups);
      }
      if (requested === ParityHistoryDocument) {
        return answer(parity);
      }
      throw new Error("unexpected document");
    },
  };
}

/** The recordingExecutor replacement: health fixture plus no UPS and a clean parity history. */
function recordingExecutor(fixture: SystemHealthQuery): { executor: GraphQLExecutor } {
  return { executor: healthExecutor({ health: fixture }) };
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
      parityCheckStatus: { status: "COMPLETED", progress: 0 },
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
    const executor = healthExecutor({ health: healthyFixture(), ups: upsDevice("ups", "ONBATT") });
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: CRITICAL");
  });

  it("warns that Docker status is unknown when the API returned no Docker data", async () => {
    const fixture = healthyFixture();
    fixture.docker = null;
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
    expect(firstText(result)).toContain(DOCKER_UNAVAILABLE);
  });

  it("counts pending container updates as a warning", async () => {
    const fixture = healthyFixture();
    fixture.docker = { containers: [{ isUpdateAvailable: true }, { isUpdateAvailable: true }] };
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
    const executor = healthExecutor({ health: healthyFixture(), ups: upsDevice("ups", "") });
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
  });

  it("accepts multi-token statuses containing ONLINE", async () => {
    const executor = healthExecutor({
      health: healthyFixture(),
      ups: upsDevice("ups", "ONLINE SLAVE"),
    });
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
  });

  it("reports the ups subsystem as unavailable (not a failure) when the UPS query throws", async () => {
    const failure = new Error("Failed to get UPS data: No UPS data returned from apcaccess");
    const handler = createSystemHealthHandler(
      healthExecutor({ health: healthyFixture(), ups: failure }),
    );

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("OVERALL: OK");
    expect(firstText(result)).toMatch(/ups: UPS data unavailable .*apcaccess/);
  });

  it("flags a UPS that is offline but not on battery as a warning", async () => {
    const executor = healthExecutor({
      health: healthyFixture(),
      ups: upsDevice("ups", "COMMLOST"),
    });
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
});

describe("system_health parity semantics", () => {
  it("reports the newest recorded check when it is clean", async () => {
    const handler = createSystemHealthHandler(recordingExecutor(healthyFixture()).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
    expect(firstText(result)).toContain(
      "✓ parity: Last parity check (2026-05-30T00:00:00Z): COMPLETED, 0 error(s).",
    );
  });

  it("warns when the newest recorded check found errors", async () => {
    const parity = { parityHistory: [parityCheck({ errors: 3 })] };
    const handler = createSystemHealthHandler(healthExecutor({ health: healthyFixture(), parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
    expect(firstText(result)).toContain(
      "⚠ parity: Last parity check (2026-05-30T00:00:00Z): COMPLETED, 3 error(s).",
    );
  });

  it("scores the newest check even when the API lists an older one first", async () => {
    const older = parityCheck({ date: "2026-04-30T00:00:00Z", errors: 5 });
    const parity = { parityHistory: [older, parityCheck()] };
    const handler = createSystemHealthHandler(healthExecutor({ health: healthyFixture(), parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
    expect(firstText(result)).toContain("parity: Last parity check (2026-05-30T00:00:00Z)");
  });

  it("warns when the newest recorded check FAILED, even with no errors counted", async () => {
    const parity = { parityHistory: [parityCheck({ status: "FAILED" })] };
    const handler = createSystemHealthHandler(healthExecutor({ health: healthyFixture(), parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
    expect(firstText(result)).toContain("FAILED, 0 error(s).");
  });

  it("reports an undated check with no error count as date unknown and 0 errors", async () => {
    const parity = { parityHistory: [parityCheck({ date: null, errors: null })] };
    const handler = createSystemHealthHandler(healthExecutor({ health: healthyFixture(), parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain(
      "✓ parity: Last parity check (date unknown): COMPLETED, 0 error(s).",
    );
  });

  it("scores ok, not critical, when the API has no parity-check log to read", async () => {
    const parity = new Error("Parity history file not found: /boot/config/parity-checks.log");
    const handler = createSystemHealthHandler(healthExecutor({ health: healthyFixture(), parity }));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("OVERALL: OK");
    expect(firstText(result)).toContain(
      "✓ parity: No parity-check history could be read (Parity history file not found: /boot/config/parity-checks.log).",
    );
  });

  it("scores ok when the history is empty", async () => {
    const parity = { parityHistory: [] };
    const handler = createSystemHealthHandler(healthExecutor({ health: healthyFixture(), parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("✓ parity: No parity checks recorded.");
  });

  it("mentions a running check and its progress from the live status", async () => {
    const fixture = healthyFixture();
    fixture.array.parityCheckStatus = { status: "RUNNING", progress: 37 };
    const handler = createSystemHealthHandler(recordingExecutor(fixture).executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
    expect(firstText(result)).toContain(
      "✓ parity: Last parity check (2026-05-30T00:00:00Z): COMPLETED, 0 error(s). A parity check is running (37% done).",
    );
  });

  it("keeps warning about the last check's errors while a new check runs", async () => {
    const fixture = healthyFixture();
    fixture.array.parityCheckStatus = { status: "RUNNING", progress: 12 };
    const parity = { parityHistory: [parityCheck({ errors: 2 })] };
    const handler = createSystemHealthHandler(healthExecutor({ health: fixture, parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: WARNING");
    expect(firstText(result)).toContain("2 error(s). A parity check is running (12% done).");
  });

  it("mentions a paused check, reading a missing progress as 0%", async () => {
    const fixture = healthyFixture();
    fixture.array.parityCheckStatus = { status: "PAUSED", progress: null };
    const parity = { parityHistory: [] };
    const handler = createSystemHealthHandler(healthExecutor({ health: fixture, parity }));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain(
      "✓ parity: No parity checks recorded. A parity check is paused (0% done).",
    );
  });
});

describe("system_health failure messages", () => {
  it("prefixes executor failures with the tool context", async () => {
    const handler = createSystemHealthHandler(throwingExecutor("socket hang up"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to compute system health: socket hang up");
  });
});
