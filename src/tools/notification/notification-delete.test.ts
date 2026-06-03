import { describe, expect, it } from "vitest";
import {
  DeleteArchivedNotificationsDocument,
  type DeleteArchivedNotificationsMutation,
  DeleteNotificationDocument,
  type DeleteNotificationMutation,
} from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createNotificationDeleteHandler } from "./notification-delete.js";

const overview = {
  unread: { info: 1, warning: 0, alert: 0, total: 1 },
  archive: { info: 0, warning: 0, alert: 0, total: 0 },
} satisfies DeleteNotificationMutation["deleteNotification"];
const cannedOne = { deleteNotification: overview } satisfies DeleteNotificationMutation;

describe("notification_delete gate + validation", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "one",
      id: "srv:a.notify",
      type: "unread",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects scope:one without id+type", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "one",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects scope:all_archived combined with id/type", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "all_archived",
      id: "srv:a.notify",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("notification_delete dispatch + reporting", () => {
  it("deletes one by id+type and reports resulting counts", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "one",
      id: "srv:a.notify",
      type: "archive",
      confirm: true,
    });
    expect(calls[0]?.document).toBe(DeleteNotificationDocument);
    expect(calls[0]?.variables).toEqual({ id: "srv:a.notify", type: "ARCHIVE" });
    expect(firstText(result)).toBe("Deleted 1 notification; now 1 unread / 0 archived.");
  });

  it("deletes all archived and reports resulting counts", async () => {
    const { executor, calls } = recordingExecutor({
      deleteArchivedNotifications: overview,
    } satisfies DeleteArchivedNotificationsMutation);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "all_archived",
      confirm: true,
    });
    expect(calls[0]?.document).toBe(DeleteArchivedNotificationsDocument);
    expect(firstText(result)).toBe(
      "Deleted all archived notifications; now 1 unread / 0 archived.",
    );
  });

  it("returns an error result when the client throws (e.g. wrong type, ENOENT)", async () => {
    const result = await createNotificationDeleteHandler(throwingExecutor("ENOENT"))({
      response_format: "concise",
      scope: "one",
      id: "srv:missing.notify",
      type: "unread",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to delete notifications: ENOENT/);
  });

  it("coerces a non-Error rejection (String(error) branch)", async () => {
    const result = await createNotificationDeleteHandler(rejectingExecutor("boom"))({
      response_format: "concise",
      scope: "all_archived",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to delete notifications: boom/);
  });
});
