import { describe, expect, it } from "vitest";
import type { NotificationOverviewQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationOverviewHandler } from "./notification-overview.js";
import type { GraphQLExecutor } from "../../graphql/client.js";

const data = {
  notifications: {
    overview: {
      unread: { info: 3, warning: 1, alert: 2, total: 6 },
      archive: { info: 10, warning: 0, alert: 0, total: 10 },
    },
  },
} satisfies NotificationOverviewQuery;

const fake = (result: NotificationOverviewQuery): GraphQLExecutor => ({
  execute: async () => result as never,
});

describe("notification_overview handler", () => {
  it("summarizes unread and archived counts", async () => {
    const result = await createNotificationOverviewHandler(fake(data))({ response_format: "concise" });
    expect(firstText(result)).toBe(
      "Unread: 6 (2 alert / 1 warning / 3 info). Archived: 10 (0 alert / 0 warning / 10 info).",
    );
  });

  it("returns the overview object in detailed format", async () => {
    const result = await createNotificationOverviewHandler(fake(data))({ response_format: "detailed" });
    expect(JSON.parse(firstText(result))).toEqual(data.notifications.overview);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createNotificationOverviewHandler(throwingExecutor("permission denied"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch notification overview/);
  });

  it("coerces a non-Error rejection", async () => {
    const result = await createNotificationOverviewHandler(rejectingExecutor("boom"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom/);
  });
});
