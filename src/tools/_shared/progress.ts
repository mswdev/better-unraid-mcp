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
/** The v2 handler context carries the request meta and notifier under `mcpReq`. */
interface V2Context {
  mcpReq?: {
    _meta?: { progressToken?: string | number };
    notify?: (notification: ProgressNotification) => Promise<void>;
  };
}

/** The v1 `extra` shape (kept so fakes and older embedders keep working). */
interface V1Extra {
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: ProgressNotification) => Promise<void>;
}

/**
 * Extracts the progress token and notifier from a tool handler's context,
 * accepting both the SDK v2 `ctx` (`ctx.mcpReq._meta`, `ctx.mcpReq.notify`) and
 * the v1 `extra` (`extra._meta`, `extra.sendNotification`) shapes.
 *
 * @param extra - The second argument the SDK passes to a tool callback.
 * @returns A context that `sendProgress` can use; empty when no token was sent.
 */
export function progressContextFrom(extra: unknown): ProgressContext {
  if (typeof extra !== "object" || extra === null) {
    return {};
  }
  const v2 = (extra as V2Context).mcpReq;
  if (v2) {
    return { progressToken: v2._meta?.progressToken, sendNotification: v2.notify?.bind(v2) };
  }
  const v1 = extra as V1Extra;
  return {
    progressToken: v1._meta?.progressToken,
    sendNotification: v1.sendNotification?.bind(v1),
  };
}

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
