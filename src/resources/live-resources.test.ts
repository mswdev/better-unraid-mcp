import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { LiveSnapshotStore } from "../graphql/live-store.js";
import type { FeedHandlers, SubscriptionFeed } from "../graphql/subscription-feed.js";
import { registerLiveResources } from "./live-resources.js";

interface RecordedFeedSub {
  query: string;
  variables?: Record<string, unknown>;
  handlers: FeedHandlers;
}

function fakeFeed() {
  const subs: RecordedFeedSub[] = [];
  const stopped: number[] = [];
  const feed = {
    subscribe: (
      query: string,
      variables: Record<string, unknown> | undefined,
      handlers: FeedHandlers,
    ) => {
      const index = subs.length;
      subs.push({ query, variables, handlers });
      return () => stopped.push(index);
    },
    dispose: () => {},
  } as unknown as SubscriptionFeed;
  return { feed, subs, stopped };
}

type SchemaHandler = (request: { params: { uri: string } }) => Promise<unknown>;

function fakeMcpServer() {
  const resources: Array<{ name: string; read: (uri?: URL) => Promise<unknown> }> = [];
  const handlers = new Map<string, SchemaHandler>();
  const updated: string[] = [];
  const capabilities: unknown[] = [];
  const server = {
    registerResource: (name: string, _uri: unknown, _meta: unknown, read: never) => {
      resources.push({ name, read });
    },
    server: {
      registerCapabilities: (caps: unknown) => capabilities.push(caps),
      setRequestHandler: (schema: { shape: { method: { value: string } } }, handler: unknown) => {
        handlers.set(schema.shape.method.value, handler as SchemaHandler);
      },
      sendResourceUpdated: async (params: { uri: string }) => {
        updated.push(params.uri);
      },
    },
  } as unknown as McpServer;
  return { server, resources, handlers, updated, capabilities };
}

function setup() {
  const { feed, subs, stopped } = fakeFeed();
  const store = new LiveSnapshotStore(() => 0);
  const fake = fakeMcpServer();
  registerLiveResources(fake.server, { feed, store });
  const subscribe = fake.handlers.get("resources/subscribe") as SchemaHandler;
  const unsubscribe = fake.handlers.get("resources/unsubscribe") as SchemaHandler;
  return { subs, stopped, store, fake, subscribe, unsubscribe };
}

describe("registerLiveResources", () => {
  it("registers the live resources and the subscribe capability", () => {
    const { fake } = setup();

    expect(fake.resources.map((resource) => resource.name)).toContain("unraid-live-parity");
    expect(fake.resources.map((resource) => resource.name)).toContain("unraid-logs");
    expect(JSON.stringify(fake.capabilities)).toContain('"subscribe":true');
  });

  it("starts one feed subscription per subscribed uri, idempotently", async () => {
    const { subs, subscribe } = setup();

    await subscribe({ params: { uri: "unraid://live/docker-stats" } });
    await subscribe({ params: { uri: "unraid://live/docker-stats" } });

    expect(subs).toHaveLength(1);
    expect(subs[0].query).toContain("dockerContainerStats");
  });

  it("stores samples and sends resource-updated notifications", async () => {
    const { subs, store, fake, subscribe } = setup();
    await subscribe({ params: { uri: "unraid://live/parity" } });

    subs[0].handlers.onData({ parityHistorySubscription: { progress: 42 } });

    expect(store.get("parityHistorySubscription")?.data).toEqual({
      parityHistorySubscription: { progress: 42 },
    });
    expect(fake.updated).toEqual(["unraid://live/parity"]);
  });

  it("passes the log path variable for templated log subscriptions", async () => {
    const { subs, subscribe } = setup();

    await subscribe({ params: { uri: "unraid://logs/syslog" } });

    expect(subs[0].variables).toEqual({ path: "syslog" });
    expect(subs[0].query).toContain("logFile");
  });

  it("stops the feed subscription on unsubscribe", async () => {
    const { stopped, subscribe, unsubscribe } = setup();
    await subscribe({ params: { uri: "unraid://live/metrics" } });

    await unsubscribe({ params: { uri: "unraid://live/metrics" } });

    expect(stopped).toEqual([0]);
  });

  it("rejects subscriptions to unknown uris", async () => {
    const { subscribe } = setup();

    await expect(subscribe({ params: { uri: "unraid://nope" } })).rejects.toThrow(
      /does not support subscriptions/,
    );
  });
});
