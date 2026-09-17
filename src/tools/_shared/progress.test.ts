import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progressContextFrom, sendProgress, startProgressHeartbeat } from "./progress.js";

interface RecordedNotification {
  method: string;
  params: { progressToken: string | number; progress: number; message?: string };
}

function recordingExtra(progressToken?: string | number) {
  const notifications: RecordedNotification[] = [];
  return {
    notifications,
    extra: {
      _meta: progressToken === undefined ? undefined : { progressToken },
      sendNotification: async (notification: RecordedNotification) => {
        notifications.push(notification);
      },
    },
  };
}

describe("progressContextFrom", () => {
  it("extracts the token and sender from an SDK extra", () => {
    const { extra } = recordingExtra("tok-1");

    const context = progressContextFrom(extra);

    expect(context.progressToken).toBe("tok-1");
    expect(typeof context.sendNotification).toBe("function");
  });

  it("returns an inert context for undefined extra", () => {
    expect(progressContextFrom(undefined)).toEqual({});
  });
});

describe("sendProgress", () => {
  it("sends a well-formed notification when armed", async () => {
    const { extra, notifications } = recordingExtra(42);

    await sendProgress(progressContextFrom(extra), { progress: 1, total: 2, message: "half" });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe("notifications/progress");
    expect(notifications[0].params).toEqual({
      progressToken: 42,
      progress: 1,
      total: 2,
      message: "half",
    });
  });

  it("does nothing without a progress token", async () => {
    const { extra, notifications } = recordingExtra(undefined);

    await sendProgress(progressContextFrom(extra), { progress: 1 });

    expect(notifications).toHaveLength(0);
  });

  it("swallows sender failures", async () => {
    const context = {
      progressToken: 1,
      sendNotification: async () => {
        throw new Error("transport gone");
      },
    };

    await expect(sendProgress(context, { progress: 1 })).resolves.toBeUndefined();
  });
});

describe("startProgressHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits periodic heartbeats until stopped", async () => {
    const { extra, notifications } = recordingExtra("beat");

    const stop = startProgressHeartbeat(progressContextFrom(extra), {
      message: "still running",
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    stop();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(notifications).toHaveLength(3);
    expect(notifications[0].params.message).toBe("still running");
  });

  it("is inert without a token", async () => {
    const { extra, notifications } = recordingExtra(undefined);

    const stop = startProgressHeartbeat(progressContextFrom(extra), { message: "x" });
    await vi.advanceTimersByTimeAsync(20_000);
    stop();

    expect(notifications).toHaveLength(0);
  });

  it("reads the v2 handler context shape (ctx.mcpReq._meta + ctx.mcpReq.notify)", async () => {
    const sent: RecordedNotification[] = [];
    const ctx = {
      mcpReq: {
        _meta: { progressToken: "tok-v2" },
        notify: async (notification: RecordedNotification) => {
          sent.push(notification);
        },
      },
    };

    const context = progressContextFrom(ctx);
    await sendProgress(context, { progress: 1, message: "hi" });

    expect(context.progressToken).toBe("tok-v2");
    expect(sent[0]?.params.progressToken).toBe("tok-v2");
  });
});
