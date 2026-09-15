import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { LiveSnapshotStore } from "../graphql/live-store.js";
import type { SubscriptionFeed } from "../graphql/subscription-feed.js";

const JSON_INDENT_SPACES = 2;

const LOGS_URI_PREFIX = "unraid://logs/";

/** One live topic: its resource URI, feed subscription, and store key. */
interface LiveTopic {
  uri: string;
  topic: string;
  query: string;
  title: string;
  description: string;
}

/** The static live topics (log follow is templated separately). */
const LIVE_TOPICS: LiveTopic[] = [
  {
    uri: "unraid://live/parity",
    topic: "parityHistorySubscription",
    query:
      "subscription { parityHistorySubscription { date duration speed status errors progress correcting paused running } }",
    title: "Live Parity Progress",
    description: "Parity check progress pushed over WebSocket as it changes.",
  },
  {
    uri: "unraid://live/docker-stats",
    topic: "dockerContainerStats",
    query:
      "subscription { dockerContainerStats { id cpuPercent memUsage memPercent netIO blockIO } }",
    title: "Live Docker Stats",
    description: "Per-container CPU/memory/IO samples pushed over WebSocket.",
  },
  {
    uri: "unraid://live/metrics",
    topic: "systemMetricsCpu",
    query: "subscription { systemMetricsCpu { percentTotal cpus { percentTotal } } }",
    title: "Live System Metrics",
    description: "CPU utilization samples pushed over WebSocket.",
  },
];

/** The follow-a-log subscription, parameterized by path. */
const LOG_QUERY =
  "subscription LogFollow($path: String!) { logFile(path: $path) { path content totalLines startLine } }";

/** What live resources need to run. */
export interface LiveResourceDeps {
  feed: SubscriptionFeed;
  store: LiveSnapshotStore;
}

/** Renders the latest sample for a topic, or an honest waiting note. */
function renderSample(store: LiveSnapshotStore, topic: string): string {
  const sample = store.get(topic);
  if (!sample) {
    return JSON.stringify(
      {
        waiting: true,
        hint: "No live sample yet — subscribe to this resource (stdio or session-mode HTTP); samples arrive over the WebSocket subscription.",
      },
      null,
      JSON_INDENT_SPACES,
    );
  }
  return JSON.stringify({ data: sample.data, age_ms: sample.ageMs }, null, JSON_INDENT_SPACES);
}

/** Resolves a subscribed URI to its topic + query + variables. */
function resolveSubscription(
  uri: string,
): { topic: string; query: string; variables?: Record<string, unknown> } | null {
  const staticTopic = LIVE_TOPICS.find((entry) => entry.uri === uri);
  if (staticTopic) {
    return { topic: staticTopic.topic, query: staticTopic.query };
  }
  if (uri.startsWith(LOGS_URI_PREFIX)) {
    const path = decodeURIComponent(uri.slice(LOGS_URI_PREFIX.length));
    return { topic: uri, query: LOG_QUERY, variables: { path } };
  }
  return null;
}

/** Registers the readable side of the static live resources. */
function registerReadables(server: McpServer, store: LiveSnapshotStore): void {
  for (const entry of LIVE_TOPICS) {
    server.registerResource(
      entry.uri.replace("unraid://", "unraid-").replace("/", "-"),
      entry.uri,
      { title: entry.title, description: entry.description, mimeType: "application/json" },
      async () => ({
        contents: [
          { uri: entry.uri, mimeType: "application/json", text: renderSample(store, entry.topic) },
        ],
      }),
    );
  }
  server.registerResource(
    "unraid-logs",
    new ResourceTemplate("unraid://logs/{path}", { list: undefined }),
    {
      title: "Live Log Follow",
      description:
        "Follow a server log file over WebSocket (subscribe to receive updates). {path} is the log file name from log_list.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: renderSample(store, uri.href) },
      ],
    }),
  );
}

/**
 * Registers subscribable live resources: parity progress, docker stats,
 * system metrics, and log follow — fed by the graphql-ws subscription
 * client, with `notifications/resources/updated` on every sample. Updates
 * reach stdio and session-mode HTTP clients (stateless HTTP drops them).
 *
 * @param server - The MCP server to register on.
 * @param deps - The subscription feed and live sample store.
 * @returns Nothing; registers resources and request handlers as a side effect.
 */
export function registerLiveResources(server: McpServer, deps: LiveResourceDeps): void {
  registerReadables(server, deps.store);
  server.server.registerCapabilities({ resources: { subscribe: true, listChanged: true } });
  const active = new Map<string, () => void>();
  server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    startLiveSubscription({ server, deps, active, uri: request.params.uri });
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    active.get(request.params.uri)?.();
    active.delete(request.params.uri);
    return {};
  });
}

/** Starts (idempotently) the feed subscription behind one resource URI. */
function startLiveSubscription(input: {
  server: McpServer;
  deps: LiveResourceDeps;
  active: Map<string, () => void>;
  uri: string;
}): void {
  const { server, deps, active, uri } = input;
  if (active.has(uri)) {
    return;
  }
  const resolved = resolveSubscription(uri);
  if (!resolved) {
    throw new Error(`Resource ${uri} does not support subscriptions`);
  }
  const storeKey = uri.startsWith(LOGS_URI_PREFIX) ? uri : resolved.topic;
  const stop = deps.feed.subscribe(resolved.query, resolved.variables, {
    onData: (data) => {
      deps.store.set(storeKey, reduceSample(storeKey, deps.store.get(storeKey)?.data, data));
      void server.server.sendResourceUpdated({ uri }).catch(() => {});
    },
  });
  active.set(uri, stop);
}

/**
 * Docker-stats subscription events carry ONE container each, so samples are
 * aggregated into a per-id map; every other topic stores the raw sample.
 */
function reduceSample(storeKey: string, previous: unknown, incoming: unknown): unknown {
  if (storeKey !== "dockerContainerStats") {
    return incoming;
  }
  const stats = (incoming as { dockerContainerStats?: { id?: string } }).dockerContainerStats;
  if (!stats?.id) {
    return previous ?? { containers: {} };
  }
  const existing =
    typeof previous === "object" && previous !== null
      ? ((previous as { containers?: Record<string, unknown> }).containers ?? {})
      : {};
  return { containers: { ...existing, [stats.id]: stats } };
}
