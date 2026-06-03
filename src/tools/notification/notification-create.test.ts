import { describe, expect, it } from "vitest";
import {
  CreateNotificationDocument,
  type CreateNotificationMutation,
  NotifyIfUniqueDocument,
  type NotifyIfUniqueMutation,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createNotificationCreateHandler } from "./notification-create.js";

const created = {
  createNotification: {
    id: "srv:Made_1700000010.notify",
    title: "Backup done",
    subject: "Appdata",
    description: "Completed in 4m",
    importance: "INFO",
    link: null,
    type: "UNREAD",
    timestamp: "1700000010",
    formattedTimestamp: "2023-11-14 12:02",
  },
} satisfies CreateNotificationMutation;

const baseArgs = {
  response_format: "concise" as const,
  title: "Backup done",
  subject: "Appdata",
  description: "Completed in 4m",
  importance: "info" as const,
};

describe("notification_create", () => {
  it("creates always via CreateNotification with the mapped importance", async () => {
    const { executor, calls } = recordingExecutor(created);
    const result = await createNotificationCreateHandler(executor)({ ...baseArgs, mode: "always" });
    expect(calls[0]?.document).toBe(CreateNotificationDocument);
    expect(calls[0]?.variables).toEqual({
      input: {
        title: "Backup done",
        subject: "Appdata",
        description: "Completed in 4m",
        importance: "INFO",
        link: undefined,
      },
    });
    expect(firstText(result)).toBe("Created notification 'Backup done' (INFO).");
  });

  it("passes link through when provided", async () => {
    const { executor, calls } = recordingExecutor(created);
    await createNotificationCreateHandler(executor)({
      ...baseArgs,
      mode: "always",
      link: "/Dashboard",
    });
    expect((calls[0]?.variables as { input: { link?: string } }).input.link).toBe("/Dashboard");
  });

  it("if_unique creates when no duplicate exists", async () => {
    const canned = { notifyIfUnique: created.createNotification } satisfies NotifyIfUniqueMutation;
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationCreateHandler(executor)({
      ...baseArgs,
      mode: "if_unique",
    });
    expect(calls[0]?.document).toBe(NotifyIfUniqueDocument);
    expect(firstText(result)).toBe("Created notification 'Backup done' (INFO).");
  });

  it("if_unique reports 'already exists' on a null return and never asserts creation", async () => {
    const canned = { notifyIfUnique: null } satisfies NotifyIfUniqueMutation;
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationCreateHandler(executor)({
      ...baseArgs,
      mode: "if_unique",
    });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toBe(
      "An equivalent unread notification already exists; not created.",
    );
    expect(firstText(result)).not.toMatch(/Created/);
  });

  it("returns an error result when the client throws", async () => {
    const throwing = {
      execute: async () => {
        throw new Error("bad input");
      },
    };
    const result = await createNotificationCreateHandler(throwing)({ ...baseArgs, mode: "always" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to create notification/);
  });
});
