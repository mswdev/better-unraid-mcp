import { Agent } from "undici";
import { describe, expect, it } from "vitest";
import { type AgentFactory, DispatcherPool, KEEP_ALIVE_TIMEOUT_MS } from "./dispatcher-pool.js";

/** A factory that records the options of every pool it builds. */
function recordingFactory() {
  const built: Agent.Options[] = [];
  const create: AgentFactory = (options) => {
    built.push(options);
    return new Agent(options);
  };
  return { create, built };
}

describe("DispatcherPool", () => {
  it("builds the default pool with keep-alive and certificate verification left on", () => {
    const { create, built } = recordingFactory();

    new DispatcherPool(create).for(false);

    expect(built).toEqual([{ keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS }]);
  });

  it("disables certificate verification only for the self-signed opt-in", () => {
    const { create, built } = recordingFactory();

    new DispatcherPool(create).for(true);

    expect(built).toEqual([
      { keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS, connect: { rejectUnauthorized: false } },
    ]);
  });

  it("reuses one pool per TLS mode and keeps the two modes apart", () => {
    const { create, built } = recordingFactory();
    const pool = new DispatcherPool(create);

    const verifying = pool.for(false);
    const selfSigned = pool.for(true);

    expect(pool.for(false)).toBe(verifying);
    expect(pool.for(true)).toBe(selfSigned);
    expect(selfSigned).not.toBe(verifying);
    expect(built).toHaveLength(2);
  });

  it("builds real undici agents when no factory is injected", () => {
    const pool = new DispatcherPool();

    expect(pool.for(false)).toBeInstanceOf(Agent);
  });
});
