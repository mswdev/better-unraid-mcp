import { describe, expect, it } from "vitest";
import { NotificationUnreadDocument } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationUnreadHandler } from "./notification-unread.js";

describe("notification_unread", () => {
  it("marks a notification unread and reports it", async () => {
    const { executor, calls } = recordingExecutor({
      unreadNotification: { id: "n1", title: "Disk overheated", importance: "WARNING" },
    });
    const handler = createNotificationUnreadHandler(executor);

    const result = await handler({ id: "n1" });

    expect(result.isError).toBeUndefined();
    expect(calls[0].document).toBe(NotificationUnreadDocument);
    expect(calls[0].variables).toEqual({ id: "n1" });
    expect(firstText(result)).toContain("Disk overheated");
  });

  it("maps executor failures to a clean error", async () => {
    const handler = createNotificationUnreadHandler(throwingExecutor("not found"));

    const result = await handler({ id: "ghost" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not found");
  });
});

describe("notification_unread failure messages", () => {
  it("prefixes executor failures with the tool context", async () => {
    const handler = createNotificationUnreadHandler(throwingExecutor("socket hang up"));

    const result = await handler({ id: "n1" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to mark notification n1 unread: socket hang up");
  });
});
