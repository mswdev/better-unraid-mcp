/** Interval between best-effort progress heartbeats for long commands. */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** The MCP progress notification shape (SDK `notifications/progress`). */
interface ProgressNotification {
  method: "notifications/progress";
  params: {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
  };
}

/** What a handler needs to emit progress: the client's token and a sender. */
export interface ProgressContext {
  progressToken?: string | number;
  sendNotification?: (notification: ProgressNotification) => Promise<void>;
}

/** One progress update. */
export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

/** Timer injection points for deterministic heartbeat tests. */
export interface HeartbeatOptions {
  message: string;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/**
 * Extracts a progress context from the SDK's `RequestHandlerExtra` second
 * handler argument without depending on its full type. Missing pieces yield
 * an inert context, so callers never need to branch.
 *
 * @param extra - The SDK extra object (or undefined on direct handler calls).
 * @returns The token and sender when the client requested progress.
 */
export function progressContextFrom(extra: unknown): ProgressContext {
  if (typeof extra !== "object" || extra === null) {
    return {};
  }
  const candidate = extra as {
    _meta?: { progressToken?: string | number };
    sendNotification?: (notification: ProgressNotification) => Promise<void>;
  };
  return {
    progressToken: candidate._meta?.progressToken,
    sendNotification: candidate.sendNotification?.bind(candidate),
  };
}

/**
 * Sends one progress notification. A no-op unless the client supplied a
 * progress token AND the transport can carry server-initiated messages;
 * failures are swallowed — progress is best-effort by design.
 *
 * @param context - Token + sender from `progressContextFrom`.
 * @param update - Progress amount, optional total and message.
 * @returns Resolves once sent (or immediately when inert).
 */
export async function sendProgress(
  context: ProgressContext,
  update: ProgressUpdate,
): Promise<void> {
  if (context.progressToken === undefined || !context.sendNotification) {
    return;
  }
  try {
    await context.sendNotification({
      method: "notifications/progress",
      params: { progressToken: context.progressToken, ...update },
    });
  } catch {
    // Progress must never fail the actual operation.
  }
}

/**
 * Starts a periodic heartbeat notification for a long-running operation,
 * counting emitted beats as `progress`. Inert without a token/sender.
 *
 * @param context - Token + sender from `progressContextFrom`.
 * @param options - Message plus optional interval/timer overrides.
 * @returns A stop function; always call it in `finally`.
 */
export function startProgressHeartbeat(
  context: ProgressContext,
  options: HeartbeatOptions,
): () => void {
  if (context.progressToken === undefined || !context.sendNotification) {
    return () => {};
  }
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let beats = 0;
  const timer = setIntervalFn(() => {
    beats += 1;
    void sendProgress(context, { progress: beats, message: options.message });
  }, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  return () => clearIntervalFn(timer);
}
