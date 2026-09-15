const MS_PER_SECOND = 1_000;

/**
 * Bucket size: the API configures 100 requests / 10 s (unraid/api
 * ThrottlerModule); 90 leaves 10% headroom for other API consumers.
 */
export const BUCKET_CAPACITY = 90;

/** Steady-state refill matching 90 requests per 10 seconds. */
export const REFILL_PER_SECOND = 9;

/** Longest a caller will wait for a token before erroring. */
const DEFAULT_MAX_WAIT_MS = 10_000;

/** Injection points for deterministic tests. */
export interface TokenBucketOptions {
  capacity?: number;
  refillPerSecond?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client-side token bucket modeling the Unraid API's configured throttle,
 * so a chatty agent cannot get the user's key rate-limited. `acquire` grants
 * immediately while tokens remain, sleeps until the next token otherwise,
 * and throws when the wait would exceed the bound. Concurrent acquirers may
 * briefly overshoot by design — the server-side limit has headroom for that.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * @param options - Capacity/refill/wait overrides plus injectable clock.
   */
  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity ?? BUCKET_CAPACITY;
    this.refillPerSecond = options.refillPerSecond ?? REFILL_PER_SECOND;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.tokens = this.capacity;
    this.lastRefillMs = this.now();
  }

  /**
   * Takes one token, sleeping until the next refill when the bucket is empty.
   *
   * @throws Error when the wait for the next token would exceed the bound.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = this.msUntilNextToken();
    if (waitMs > this.maxWaitMs) {
      throw new Error(
        `Rate limit: next request slot is ${waitMs} ms away, over the max wait of ${this.maxWaitMs} ms. Slow down and retry.`,
      );
    }
    await this.sleep(waitMs);
    this.refill();
    this.tokens = Math.max(this.tokens - 1, 0);
  }

  /** Adds tokens for the time elapsed since the last refill, up to capacity. */
  private refill(): void {
    const nowMs = this.now();
    const elapsedSeconds = (nowMs - this.lastRefillMs) / MS_PER_SECOND;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillMs = nowMs;
  }

  /** Milliseconds until one full token is available. */
  private msUntilNextToken(): number {
    return Math.ceil(((1 - this.tokens) / this.refillPerSecond) * MS_PER_SECOND);
  }
}
