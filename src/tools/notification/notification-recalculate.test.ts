import { describe, expect, it } from "vitest";
import {
  RecalculateOverviewDocument,
  type RecalculateOverviewMutation,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationRecalculateHandler } from "./notification-recalculate.js";

const canned = {
  recalculateOverview: {
    unread: { info: 2, warning: 1, alert: 0, total: 3 },
    archive: { info: 4, warning: 0, alert: 0, total: 4 },
  },
} satisfies RecalculateOverviewMutation;

describe("notification_recalculate", () => {
  it("dispatches RecalculateOverview and reports the re-synced counts", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationRecalculateHandler(executor)({ response_format: "concise" });
    expect(calls[0]?.document).toBe(RecalculateOverviewDocument);
    expect(firstText(result)).toBe("Overview re-synced from disk: 3 unread / 4 archived.");
  });

  it("returns the overview in detailed format", async () => {
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationRecalculateHandler(executor)({ response_format: "detailed" });
    expect(JSON.parse(firstText(result))).toEqual(canned.recalculateOverview);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createNotificationRecalculateHandler(throwingExecutor("refresh failed"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to recalculate/);
  });
});
