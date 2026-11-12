import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "./graphql/client.js";
import { LiveSnapshotStore } from "./graphql/live-store.js";
import { SubscriptionFeed } from "./graphql/subscription-feed.js";
import { buildServer } from "./server.js";
import type { RegistryOptions } from "./tools/registry.js";

const unusedExecutor: GraphQLExecutor = {
  execute: async () => {
    throw new Error("listing never executes a GraphQL operation");
  },
};

const baseOptions: RegistryOptions = {
  client: unusedExecutor,
  shell: null,
  readOnly: false,
  schemaApiVersion: null,
};

/** A feed whose socket is never opened: these tests only list, never subscribe. */
function idleFeed(): SubscriptionFeed {
  return new SubscriptionFeed({
    endpoint: "http://tower.local/graphql",
    apiKey: "k",
    createClientImpl: () => {
      throw new Error("no subscription is opened while listing");
    },
  });
}

/** Connects a built server to an in-memory client end and returns a JSON-RPC request helper. */
async function connectClient(options: RegistryOptions) {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  clientEnd.onmessage = (message) => {
    const { id } = message as { id?: number };
    if (id !== undefined) {
      pending.get(id)?.(message);
    }
  };
  await buildServer(options).connect(serverEnd);
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, (message) =>
        resolve((message as { result: Record<string, unknown> }).result),
      );
      void clientEnd.send({ jsonrpc: "2.0", id, method, params });
    });
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  return { request, initialized };
}

async function listedResourceUris(request: Awaited<ReturnType<typeof connectClient>>["request"]) {
  const result = (await request("resources/list")) as { resources: Array<{ uri: string }> };
  return result.resources.map((resource) => resource.uri);
}

describe("buildServer", () => {
  it("serves the live resources and the subscribe capability when a feed and store are wired", async () => {
    const options = { ...baseOptions, feed: idleFeed(), liveStore: new LiveSnapshotStore() };

    const { request, initialized } = await connectClient(options);
    const uris = await listedResourceUris(request);

    expect(uris).toContain("unraid://live/parity");
    expect(uris).toContain("unraid://schema");
    expect(initialized.capabilities).toMatchObject({ resources: { subscribe: true } });
  });

  it("omits the live resources when the live store is missing", async () => {
    const { request } = await connectClient({ ...baseOptions, feed: idleFeed() });

    const uris = await listedResourceUris(request);

    expect(uris).toContain("unraid://schema");
    expect(uris).not.toContain("unraid://live/parity");
  });

  it("registers the tools and guided prompts", async () => {
    const { request } = await connectClient(baseOptions);

    const tools = (await request("tools/list")) as { tools: Array<{ name: string }> };
    const prompts = (await request("prompts/list")) as { prompts: unknown[] };

    expect(tools.tools.map((tool) => tool.name)).toContain("array_status");
    expect(prompts.prompts.length).toBeGreaterThan(0);
  });
});
