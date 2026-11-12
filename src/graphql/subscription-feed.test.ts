import type { ClientOptions } from "graphql-ws";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  DOCKER_CONTAINER_EVICTION_MS,
  LiveSnapshotStore,
  mergeDockerStatsSample,
} from "./live-store.js";
import {
  type CreateClientLike,
  type GraphqlWsClientFactory,
  SubscriptionFeed,
  toWsUrl,
} from "./subscription-feed.js";

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

type FeedSink = Parameters<CreateClientLike["subscribe"]>[1];

/** A hand-written graphql-ws factory recording the options and calls it receives. */
function fakeGraphqlWs() {
  const built: ClientOptions[] = [];
  const subscribed: Array<{ query: string; sink: FeedSink }> = [];
  let disposed = 0;
  const create: GraphqlWsClientFactory = (clientOptions) => {
    built.push(clientOptions);
    return {
      subscribe: (payload, sink) => {
        subscribed.push({ query: payload.query, sink });
        return () => {};
      },
      dispose: () => {
        disposed += 1;
      },
    };
  };
  return { create, built, subscribed, disposedCount: () => disposed };
}

describe("SubscriptionFeed default graphql-ws client", () => {
  it("connects lazily to the WebSocket twin with the API key and a bounded retry budget", () => {
    const graphqlWs = fakeGraphqlWs();
    const feed = new SubscriptionFeed({ ...options, createGraphqlWsClient: graphqlWs.create });

    feed.subscribe("subscription { a }", undefined, { onData: () => {} });

    const [clientOptions] = graphqlWs.built;
    expect(clientOptions).toMatchObject({
      url: "wss://tower.local/graphql",
      connectionParams: { "x-api-key": "k" },
      lazy: true,
      retryAttempts: 10,
    });
    expect(clientOptions.webSocketImpl).toBe(WebSocket);
    expect(clientOptions.shouldRetry?.(new Error("socket closed"))).toBe(true);
  });

  it("forwards subscriptions and their samples through the graphql-ws client", () => {
    const graphqlWs = fakeGraphqlWs();
    const feed = new SubscriptionFeed({ ...options, createGraphqlWsClient: graphqlWs.create });
    const received: unknown[] = [];

    feed.subscribe("subscription { b }", undefined, { onData: (data) => received.push(data) });
    graphqlWs.subscribed[0].sink.next({ data: { b: 1 } });
    graphqlWs.subscribed[0].sink.complete();

    expect(graphqlWs.subscribed[0].query).toBe("subscription { b }");
    expect(received).toEqual([{ b: 1 }]);
  });

  it("disposes the client once and rebuilds it on the next subscribe", () => {
    const graphqlWs = fakeGraphqlWs();
    const feed = new SubscriptionFeed({ ...options, createGraphqlWsClient: graphqlWs.create });
    feed.subscribe("subscription { a }", undefined, { onData: () => {} });

    feed.dispose();
    feed.dispose();
    feed.subscribe("subscription { a }", undefined, { onData: () => {} });

    expect(graphqlWs.disposedCount()).toBe(1);
    expect(graphqlWs.built).toHaveLength(2);
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

  it("starts a fresh aggregate when the previous sample has no containers map", () => {
    const merged = mergeDockerStatsSample(
      { unrelated: true },
      { dockerContainerStats: { id: "a", cpuPercent: 1 } },
      5,
    );

    expect(Object.keys(merged.containers)).toEqual(["a"]);
  });

  it("keeps the aggregate unchanged for an event without a container id", () => {
    const first = mergeDockerStatsSample(
      undefined,
      { dockerContainerStats: { id: "a", cpuPercent: 1 } },
      0,
    );

    const merged = mergeDockerStatsSample(first, { dockerContainerStats: null }, 10);

    expect(merged.containers).toEqual(first.containers);
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
