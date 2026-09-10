import { describe, expect, it } from "vitest";
import type { MoverStatusQuery } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createMoverStatusHandler } from "./mover-status.js";

const running = {
  vars: { shareMoverActive: true, shareMoverSchedule: "40 3 * * *", shareMoverLogging: true },
} satisfies MoverStatusQuery;

const idle = {
  vars: { shareMoverActive: false, shareMoverSchedule: null, shareMoverLogging: false },
} satisfies MoverStatusQuery;

const unreported = {
  vars: { shareMoverActive: null, shareMoverSchedule: null, shareMoverLogging: null },
} satisfies MoverStatusQuery;

describe("mover_status", () => {
  it("reports a running mover with its schedule and logging", async () => {
    const { executor } = recordingExecutor(running);
    const handler = createMoverStatusHandler(executor);

    const result = await handler({ response_format: "concise" });

    const text = firstText(result);
    expect(text).toContain("Mover is currently running.");
    expect(text).toContain("40 3 * * *");
    expect(text).toContain("logging: enabled");
  });

  it("reports an idle mover", async () => {
    const { executor } = recordingExecutor(idle);
    const handler = createMoverStatusHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("Mover is not running.");
  });

  it("says the state is not reported when the API returns null", async () => {
    const { executor } = recordingExecutor(unreported);
    const handler = createMoverStatusHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("not reported");
  });

  it("returns the raw vars in detailed format", async () => {
    const { executor } = recordingExecutor(running);
    const handler = createMoverStatusHandler(executor);

    const result = await handler({ response_format: "detailed" });

    expect(JSON.parse(firstText(result))).toMatchObject({ shareMoverActive: true });
  });

  it("maps executor failures to a tool error", async () => {
    const handler = createMoverStatusHandler(throwingExecutor("boom"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("boom");
  });
});
