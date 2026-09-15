import { describe, expect, it } from "vitest";
import { TokenBucket } from "./rate-limit.js";

/** Deterministic clock + sleep: sleeping advances the clock. */
function fakeClock(startMs = 0) {
  let nowMs = startMs;
  const sleeps: number[] = [];
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    sleeps,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("TokenBucket", () => {
  it("grants immediately while tokens remain", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1, ...clock });

    await bucket.acquire();
    await bucket.acquire();

    expect(clock.sleeps).toHaveLength(0);
  });

  it("waits for a refill when empty", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, ...clock });

    await bucket.acquire();
    await bucket.acquire();

    expect(clock.sleeps).toHaveLength(1);
    expect(clock.sleeps[0]).toBeGreaterThan(0);
    expect(clock.sleeps[0]).toBeLessThanOrEqual(1000);
  });

  it("refills over elapsed time", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, ...clock });

    await bucket.acquire();
    clock.advance(1000);
    await bucket.acquire();

    expect(clock.sleeps).toHaveLength(0);
  });

  it("throws when the wait would exceed maxWaitMs", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({
      capacity: 1,
      refillPerSecond: 0.001,
      maxWaitMs: 500,
      ...clock,
    });

    await bucket.acquire();

    await expect(bucket.acquire()).rejects.toThrow(/max wait/i);
  });
});
