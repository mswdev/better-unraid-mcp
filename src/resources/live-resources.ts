import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DOCKER_STATS_TOPIC,
  type LiveSnapshotStore,
  mergeDockerStatsSample,
} from "../graphql/live-store.js";
import type { SubscriptionFeed } from "../graphql/subscription-feed.js";

const JSON_INDENT_SPACES = 2;

const LOGS_URI_PREFIX = "unraid://logs/";

/** One upstream GraphQL subscription: its store key and document text. */
interface LiveSubscriptionSpec {
  topic: string;
  query: string;
  variables?: Record<string, unknown>;
}

/** One subscribable resource, backed by one or more upstream subscriptions. */
interface LiveTopic {
  uri: string;
  title: string;
  description: string;
  subscriptions: LiveSubscriptionSpec[];
}

/** The static live topics (log follow is templated separately). */
const LIVE_TOPICS: LiveTopic[] = [
  {
    uri: "unraid://live/parity",
    title: "Live Parity Progress",
    description: "Parity check progress pushed over WebSocket as it changes.",
    subscriptions: [
      {
        topic: "parityHistorySubscription",
        query:
          "subscription { parityHistorySubscription { date duration speed status errors progress correcting paused running } }",
      },
    ],
  },
  {
    uri: "unraid://live/docker-stats",
    title: "Live Docker Stats",
    description: "Per-container CPU/memory/IO samples pushed over WebSocket.",
    subscriptions: [
      {
        topic: "dockerContainerStats",
        query:
          "subscription { dockerContainerStats { id cpuPercent memUsage memPercent netIO blockIO } }",
      },
    ],
  },
  {
    uri: "unraid://live/metrics",
    title: "Live System Metrics",
    description:
      "CPU, memory, network, and temperature samples pushed over WebSocket, merged into one resource.",
    subscriptions: [
      {
        topic: "systemMetricsCpu",
        query: "subscription { systemMetricsCpu { percentTotal cpus { percentTotal } } }",
      },
      {
        topic: "systemMetricsMemory",
        query: "subscription { systemMetricsMemory { total used free available percentTotal } }",
      },
      {
        topic: "systemMetricsNetwork",
        query:
          "subscription { systemMetricsNetwork { name operstate rxSec txSec utilizationPercent } }",
      },
      {
        topic: "systemMetricsTemperature",
        query:
          "subscription { systemMetricsTemperature { sensors { name current { value unit } } summary { average warningCount criticalCount } } }",
      },
    ],
  },
  {
    uri: "unraid://live/ups",
    title: "Live UPS Telemetry",
    description: "UPS status and battery samples pushed over WebSocket.",
    subscriptions: [
      {
        topic: "upsUpdates",
        query: "subscription { upsUpdates { id name model status battery { chargeLevel } } }",
      },
    ],
  },
  {
    uri: "unraid://live/array",
    title: "Live Array State",
    description: "Array state and capacity updates pushed over WebSocket.",
    subscriptions: [
      {
        topic: "arraySubscription",
        query: "subscription { arraySubscription { state capacity { kilobytes { used total } } } }",
      },
    ],
  },
  {
    uri: "unraid://live/notifications",
    title: "Live Notifications",
    description: "The most recent server notification, pushed over WebSocket as it arrives.",
    subscriptions: [
      {
        topic: "notificationAdded",
        query: "subscription { notificationAdded { id title subject importance timestamp } }",
      },
    ],
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

/** The honest not-yet envelope shared by every unfilled live resource. */
const WAITING_ENVELOPE = {
  waiting: true,
  hint: "No live sample yet — subscribe to this resource (stdio or session-mode HTTP); samples arrive over the WebSocket subscription.",
};

/**
 * Renders a resource's latest state: single-topic resources return
 * `{data, age_ms}`, merged resources return per-topic `parts`; either shape
 * becomes the waiting envelope until a first sample lands.
 */
function renderResource(store: LiveSnapshotStore, topics: string[]): string {
  if (topics.length === 1) {
    const sample = store.get(topics[0]);
    const body = sample ? { data: sample.data, age_ms: sample.ageMs } : WAITING_ENVELOPE;
    return JSON.stringify(body, null, JSON_INDENT_SPACES);
  }
  const parts: Record<string, { data: unknown; age_ms: number } | null> = {};
  let any = false;
  for (const topic of topics) {
    const sample = store.get(topic);
    parts[topic] = sample ? { data: sample.data, age_ms: sample.ageMs } : null;
    any = any || sample !== null;
  }
  return JSON.stringify(any ? { parts } : WAITING_ENVELOPE, null, JSON_INDENT_SPACES);
}

/** Resolves a subscribed URI to its upstream subscription list. */
function resolveSubscriptions(uri: string): LiveSubscriptionSpec[] | null {
  const staticTopic = LIVE_TOPICS.find((entry) => entry.uri === uri);
  if (staticTopic) {
    return staticTopic.subscriptions;
  }
  if (uri.startsWith(LOGS_URI_PREFIX)) {
    const path = decodeURIComponent(uri.slice(LOGS_URI_PREFIX.length));
    return [{ topic: uri, query: LOG_QUERY, variables: { path } }];
  }
  return null;
}

/** Registers the readable side of the static live resources. */
function registerReadables(server: McpServer, store: LiveSnapshotStore): void {
  for (const entry of LIVE_TOPICS) {
    const topics = entry.subscriptions.map((subscription) => subscription.topic);
    server.registerResource(
      entry.uri.replace("unraid://", "unraid-").replace("/", "-"),
      entry.uri,
      { title: entry.title, description: entry.description, mimeType: "application/json" },
      async () => ({
        contents: [
          { uri: entry.uri, mimeType: "application/json", text: renderResource(store, topics) },
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
        { uri: uri.href, mimeType: "application/json", text: renderResource(store, [uri.href]) },
      ],
    }),
  );
}

/**
 * Registers subscribable live resources: parity progress, docker stats,
 * system metrics (CPU + memory + network + temperature), UPS, array state,
 * notifications, and log follow — fed by the graphql-ws subscription
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
  installTeardown(server, active);
}

/**
 * Stops every upstream subscription when this server's transport closes
 * (stateless response teardown, session DELETE, or idle expiry) — without
 * this, each recycled session would leak its WebSocket subscriptions on the
 * process-lifetime shared feed forever.
 */
function installTeardown(server: McpServer, active: Map<string, () => void>): void {
  const previousOnClose = server.server.onclose;
  server.server.onclose = () => {
    for (const stop of active.values()) {
      stop();
    }
    active.clear();
    previousOnClose?.();
  };
}

/** Starts (idempotently) every feed subscription behind one resource URI. */
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
  const specs = resolveSubscriptions(uri);
  if (!specs) {
    throw new Error(`Resource ${uri} does not support subscriptions`);
  }
  const stops = specs.map((spec) =>
    deps.feed.subscribe(spec.query, spec.variables, {
      onData: (data) => {
        deps.store.set(
          spec.topic,
          reduceSample(spec.topic, deps.store.get(spec.topic)?.data, data),
        );
        void server.server.sendResourceUpdated({ uri }).catch(() => {});
      },
      onError: () => {
        // A dead subscription must not block revival: drop the active entry
        // (stopping any surviving siblings) so the next subscribe restarts.
        const stop = active.get(uri);
        active.delete(uri);
        stop?.();
      },
    }),
  );
  active.set(uri, () => {
    for (const stop of stops) {
      stop();
    }
  });
}

/**
 * Docker-stats subscription events carry ONE container each, so samples are
 * aggregated (with eviction) via the shared merge; every other topic stores
 * the raw sample.
 */
function reduceSample(storeKey: string, previous: unknown, incoming: unknown): unknown {
  if (storeKey !== DOCKER_STATS_TOPIC) {
    return incoming;
  }
  return mergeDockerStatsSample(previous, incoming);
}
