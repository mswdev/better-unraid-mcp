import { describe, expect, it } from "vitest";
import {
  NotificationListDocument,
  type NotificationListQuery,
} from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createNotificationListHandler } from "./notification-list.js";

const data = {
  notifications: {
    list: [
      {
        id: "srv:Disk_1700000001.notify",
        title: "Disk warning",
        subject: "Disk 1",
        description: "SMART error",
        importance: "WARNING",
        link: null,
        type: "UNREAD",
        timestamp: "1700000001",
        formattedTimestamp: "2023-11-14 12:00",
      },
    ],
  },
} satisfies NotificationListQuery;

const empty = { notifications: { list: [] } } satisfies NotificationListQuery;

describe("notification_list handler", () => {
  it("applies default offset/limit and maps the type enum into the filter", async () => {
    const { executor, calls } = recordingExecutor(data);
    await createNotificationListHandler(executor)({ response_format: "concise", type: "unread" });
    expect(calls[0]?.document).toBe(NotificationListDocument);
    expect(calls[0]?.variables).toEqual({ filter: { type: "UNREAD", offset: 0, limit: 25 } });
  });

  it("includes a provided importance (mapped) and explicit paging in the filter", async () => {
    const { executor, calls } = recordingExecutor(empty);
    await createNotificationListHandler(executor)({
      response_format: "concise",
      type: "archive",
      importance: "alert",
      offset: 10,
      limit: 5,
    });
    expect(calls[0]?.variables).toEqual({
      filter: { type: "ARCHIVE", importance: "ALERT", offset: 10, limit: 5 },
    });
  });

  it("renders one line per notification", async () => {
    const { executor } = recordingExecutor(data);
    const result = await createNotificationListHandler(executor)({
      response_format: "concise",
      type: "unread",
    });
    expect(firstText(result)).toBe("[WARNING] Disk warning — Disk 1 (2023-11-14 12:00)");
  });

  it("distinguishes importance-filtered-empty from plain-empty", async () => {
    const { executor } = recordingExecutor(empty);
    const filtered = await createNotificationListHandler(executor)({
      response_format: "concise",
      type: "unread",
      importance: "alert",
    });
    expect(firstText(filtered)).toBe("No unread notifications match importance ALERT.");

    const plain = await createNotificationListHandler(recordingExecutor(empty).executor)({
      response_format: "concise",
      type: "archive",
    });
    expect(firstText(plain)).toBe("No archive notifications.");
  });

  it("returns the list array in detailed format", async () => {
    const { executor } = recordingExecutor(data);
    const result = await createNotificationListHandler(executor)({
      response_format: "detailed",
      type: "unread",
    });
    expect(JSON.parse(firstText(result))).toEqual(data.notifications.list);
  });

  it("returns an error result when the client throws (Error branch)", async () => {
    const result = await createNotificationListHandler(throwingExecutor("nope"))({
      response_format: "concise",
      type: "unread",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list notifications: nope/);
  });

  it("coerces a non-Error rejection (String(error) branch)", async () => {
    const result = await createNotificationListHandler(rejectingExecutor("boom"))({
      response_format: "concise",
      type: "archive",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list notifications: boom/);
  });
});
