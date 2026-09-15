import { describe, expect, it } from "vitest";
import type { SystemHealthQuery } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createSystemHealthHandler } from "./system-health.js";

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
    upsDevices: [],
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
    const fixture = healthyFixture();
    fixture.upsDevices = [{ name: "ups", status: "ONBATT", battery: { chargeLevel: 80 } }];
    const { executor } = recordingExecutor(fixture);
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
    const fixture = healthyFixture();
    fixture.upsDevices = [{ name: "ups", status: "", battery: { chargeLevel: 0 } }];
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
  });

  it("accepts multi-token statuses containing ONLINE", async () => {
    const fixture = healthyFixture();
    fixture.upsDevices = [{ name: "ups", status: "ONLINE SLAVE", battery: { chargeLevel: 100 } }];
    const { executor } = recordingExecutor(fixture);
    const handler = createSystemHealthHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("OVERALL: OK");
  });
});
