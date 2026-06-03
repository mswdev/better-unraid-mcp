import { describe, expect, it } from "vitest";
import {
  ArchiveAllDocument,
  type ArchiveAllMutation,
  ArchiveNotificationsDocument,
  type ArchiveNotificationsMutation,
  UnarchiveAllDocument,
  type UnarchiveAllMutation,
  UnarchiveNotificationsDocument,
  type UnarchiveNotificationsMutation,
} from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createNotificationArchiveHandler } from "./notification-archive.js";

// An ARBITRARY overview — the handler must NOT echo these numbers (counts are racy).
const overview = {
  unread: { info: 99, warning: 99, alert: 99, total: 297 },
  archive: { info: 99, warning: 99, alert: 99, total: 297 },
} satisfies ArchiveNotificationsMutation["archiveNotifications"];
const canned = { archiveNotifications: overview } satisfies ArchiveNotificationsMutation;

describe("notification_archive validation", () => {
  it("rejects neither ids nor all and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects both ids and all", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["a"],
      all: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects importance combined with ids (importance is only valid with all)", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["a"],
      importance: "alert",
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("notification_archive dispatch", () => {
  it("archives ids via ArchiveNotifications", async () => {
    const { executor, calls } = recordingExecutor(canned);
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["srv:a.notify", "srv:b.notify"],
    });
    expect(calls[0]?.document).toBe(ArchiveNotificationsDocument);
    expect(calls[0]?.variables).toEqual({ ids: ["srv:a.notify", "srv:b.notify"] });
  });

  it("unarchives ids via UnarchiveNotifications", async () => {
    const { executor, calls } = recordingExecutor({
      unarchiveNotifications: overview,
    } satisfies UnarchiveNotificationsMutation);
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "unarchive",
      ids: ["srv:a.notify"],
    });
    expect(calls[0]?.document).toBe(UnarchiveNotificationsDocument);
    expect(calls[0]?.variables).toEqual({ ids: ["srv:a.notify"] });
  });

  it("archives all of an importance via ArchiveAll", async () => {
    const { executor, calls } = recordingExecutor({
      archiveAll: overview,
    } satisfies ArchiveAllMutation);
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      all: true,
      importance: "warning",
    });
    expect(calls[0]?.document).toBe(ArchiveAllDocument);
    expect(calls[0]?.variables).toEqual({ importance: "WARNING" });
  });

  it("unarchives all (no importance) via UnarchiveAll with importance omitted", async () => {
    const { executor, calls } = recordingExecutor({
      unarchiveAll: overview,
    } satisfies UnarchiveAllMutation);
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "unarchive",
      all: true,
    });
    expect(calls[0]?.document).toBe(UnarchiveAllDocument);
    expect(calls[0]?.variables).toEqual({ importance: undefined });
  });
});

describe("notification_archive reporting (action-based, never counts)", () => {
  it("reports the requested ids action and does NOT echo the racy overview counts", async () => {
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["srv:a.notify", "srv:b.notify"],
    });
    const text = firstText(result);
    expect(text).toBe("Requested archive of 2 notification(s); verify with notification_list.");
    expect(text).not.toMatch(/297|99/); // proves we don't parrot returned counts
  });

  it("silently-swallowed bad ids still report only what was requested (never per-id success)", async () => {
    // Server swallows bad ids (batchProcess never throws); the executor returns success regardless.
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["bogus-id"],
    });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toBe(
      "Requested archive of 1 notification(s); verify with notification_list.",
    );
  });

  it("reports an all+importance action", async () => {
    const { executor } = recordingExecutor({ archiveAll: overview } satisfies ArchiveAllMutation);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      all: true,
      importance: "alert",
    });
    expect(firstText(result)).toBe(
      "Requested archive of all ALERT notifications; verify with notification_list.",
    );
  });

  it("returns the raw server overview in detailed (labeled, may lag)", async () => {
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "detailed",
      direction: "archive",
      ids: ["srv:a.notify"],
    });
    expect(JSON.parse(firstText(result))).toMatchObject({ serverOverview: overview });
  });
});

describe("notification_archive error paths", () => {
  it("returns an error result when the client throws (Error branch)", async () => {
    const result = await createNotificationArchiveHandler(throwingExecutor("boom"))({
      response_format: "concise",
      direction: "archive",
      ids: ["srv:a.notify"],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to archive notifications: boom/);
  });

  it("coerces a non-Error rejection (String(error) branch)", async () => {
    const result = await createNotificationArchiveHandler(rejectingExecutor("nope"))({
      response_format: "concise",
      direction: "unarchive",
      all: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to unarchive notifications/);
    expect(firstText(result)).toMatch(/nope/);
  });
});
