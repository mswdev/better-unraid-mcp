import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { NotificationAlertsQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationAlertsHandler } from "./notification-alerts.js";

const data = {
  notifications: {
    warningsAndAlerts: [
      {
        id: "srv:Alert_1700000009.notify",
        title: "Array offline",
        subject: "Parity",
        description: "Disk 2 disabled",
        importance: "ALERT",
        link: null,
        type: "UNREAD",
        timestamp: "1700000009",
        formattedTimestamp: "2023-11-14 12:01",
      },
    ],
  },
} satisfies NotificationAlertsQuery;

const fake = (result: NotificationAlertsQuery): GraphQLExecutor => ({
  execute: async () => result as never,
});

describe("notification_alerts handler", () => {
  it("renders unread warnings and alerts, newest first", async () => {
    const result = await createNotificationAlertsHandler(fake(data))({
      response_format: "concise",
    });
    expect(firstText(result)).toBe("[ALERT] Array offline — Parity (2023-11-14 12:01)");
  });

  it("reports the empty attention set distinctly", async () => {
    const result = await createNotificationAlertsHandler(
      fake({ notifications: { warningsAndAlerts: [] } }),
    )({ response_format: "concise" });
    expect(firstText(result)).toBe("No unread warnings or alerts.");
  });

  it("returns the array in detailed format", async () => {
    const result = await createNotificationAlertsHandler(fake(data))({
      response_format: "detailed",
    });
    expect(JSON.parse(firstText(result))).toEqual(data.notifications.warningsAndAlerts);
  });

  it("returns an error result when the client throws (Error branch)", async () => {
    const result = await createNotificationAlertsHandler(throwingExecutor("nope"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch warnings and alerts/);
    expect(firstText(result)).toMatch(/nope/);
  });

  it("coerces a non-Error rejection (String(error) branch)", async () => {
    const result = await createNotificationAlertsHandler(rejectingExecutor("boom"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom/);
  });
});
