import { describe, expect, it } from "vitest";
import {
  DOCKER_CONTAINER_EVICTION_MS,
  LiveSnapshotStore,
  mergeDockerStatsSample,
} from "./live-store.js";
import { type CreateClientLike, SubscriptionFeed, toWsUrl } from "./subscription-feed.js";

interface RecordedSubscribe {
  payload: { query: string; variables?: Record<string, unknown> };
  sink: { next(value: { data?: unknown }): void; error(error: unknown): void };
}

function fakeClientFactory() {
  const subscriptions: RecordedSubscribe[] = [];
  const unsubscribed: number[] = [];
  let built = 0;
  const factory = (): CreateClientLike => {
    built += 1;
    return {
      subscribe: (payload, sink) => {
        const index = subscriptions.length;
        subscriptions.push({ payload, sink });
        return () => unsubscribed.push(index);
      },
      dispose: () => {},
    };
  };
  return { factory, subscriptions, unsubscribed, builtCount: () => built };
}

const options = { endpoint: "https://tower.local/graphql", apiKey: "k" };

describe("toWsUrl", () => {
  it("maps https to wss and http to ws", () => {
    expect(toWsUrl("https://tower.local/graphql")).toBe("wss://tower.local/graphql");
    expect(toWsUrl("http://tower.local/graphql")).toBe("ws://tower.local/graphql");
  });
});

describe("SubscriptionFeed", () => {
  it("builds the client lazily on first subscribe only", () => {
    const { factory, builtCount } = fakeClientFactory();
    const feed = new SubscriptionFeed({ ...options, createClientImpl: factory });

    expect(builtCount()).toBe(0);

    feed.subscribe("subscription { a }", undefined, { onData: () => {} });
    feed.subscribe("subscription { b }", undefined, { onData: () => {} });

    expect(builtCount()).toBe(1);
  });

  it("pumps data samples to the handler", () => {
    const { factory, subscriptions } = fakeClientFactory();
    const feed = new SubscriptionFeed({ ...options, createClientImpl: factory });
    const received: unknown[] = [];

    feed.subscribe("subscription { dockerContainerStats { cpuPercent } }", undefined, {
      onData: (data) => received.push(data),
    });
    subscriptions[0].sink.next({ data: { dockerContainerStats: { cpuPercent: 12 } } });
    subscriptions[0].sink.next({ data: null });

    expect(received).toEqual([{ dockerContainerStats: { cpuPercent: 12 } }]);
    expect(subscriptions[0].payload.query).toContain("dockerContainerStats");
  });

  it("routes errors to onError without throwing", () => {
    const { factory, subscriptions } = fakeClientFactory();
    const feed = new SubscriptionFeed({ ...options, createClientImpl: factory });
    const errors: unknown[] = [];

    feed.subscribe("subscription { a }", undefined, {
      onData: () => {},
      onError: (error) => errors.push(error),
    });
    subscriptions[0].sink.error(new Error("socket closed"));

    expect(errors).toHaveLength(1);
  });

  it("unsubscribes through the client's disposer", () => {
    const { factory, unsubscribed } = fakeClientFactory();
    const feed = new SubscriptionFeed({ ...options, createClientImpl: factory });

    const stop = feed.subscribe("subscription { a }", undefined, { onData: () => {} });
    stop();

    expect(unsubscribed).toEqual([0]);
  });
});

describe("LiveSnapshotStore", () => {
  it("age-stamps stored samples", () => {
    let nowMs = 1_000;
    const store = new LiveSnapshotStore(() => nowMs);

    store.set("dockerContainerStats", { cpu: 1 });
    nowMs = 3_500;

    expect(store.get("dockerContainerStats")).toEqual({ data: { cpu: 1 }, ageMs: 2_500 });
  });

  it("returns null for unknown topics", () => {
    const store = new LiveSnapshotStore();

    expect(store.get("nothing")).toBeNull();
  });
});

describe("mergeDockerStatsSample", () => {
  it("aggregates per container id with arrival stamps", () => {
    const first = mergeDockerStatsSample(
      undefined,
      { dockerContainerStats: { id: "a", cpuPercent: 1 } },
      1_000,
    );
    const second = mergeDockerStatsSample(
      first,
      { dockerContainerStats: { id: "b", cpuPercent: 2 } },
      2_000,
    );

    expect(Object.keys(second.containers).sort()).toEqual(["a", "b"]);
    expect(second.containers.a.seenAtMs).toBe(1_000);
    expect(second.containers.b.seenAtMs).toBe(2_000);
  });

  it("evicts containers unseen for longer than the eviction window", () => {
    const first = mergeDockerStatsSample(
      undefined,
      { dockerContainerStats: { id: "a", cpuPercent: 1 } },
      0,
    );

    const later = mergeDockerStatsSample(
      first,
      { dockerContainerStats: { id: "b", cpuPercent: 2 } },
      DOCKER_CONTAINER_EVICTION_MS + 1_000,
    );

    expect(Object.keys(later.containers)).toEqual(["b"]);
  });
});
