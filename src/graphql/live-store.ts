/** The store topic the docker-stats subscription aggregates into. */
export const DOCKER_STATS_TOPIC = "dockerContainerStats";

/** Containers with no sample for this long are evicted from the aggregate. */
export const DOCKER_CONTAINER_EVICTION_MS = 30_000;

/** One container's live stats sample (subscription events carry one each). */
export interface LiveContainerStats {
  id: string;
  cpuPercent: number;
  memUsage: string;
  memPercent: number;
  netIO: string;
  blockIO: string;
}

/** A container sample stamped with its own arrival time. */
export interface TimestampedContainerStats extends LiveContainerStats {
  seenAtMs: number;
}

/** The aggregated docker-stats sample shape both producer and consumer share. */
export interface DockerStatsAggregate {
  containers: Record<string, TimestampedContainerStats>;
}

/**
 * Merges one docker-stats subscription event into the per-container
 * aggregate, evicting containers whose last sample is older than the
 * eviction window — a stopped/removed container must not ghost in
 * docker_stats output behind the topic's shared freshness stamp.
 *
 * @param previous - The prior aggregate (or anything else, treated as empty).
 * @param incoming - The raw subscription event payload.
 * @param nowMs - Current time, injectable for tests.
 * @returns The updated aggregate.
 */
export function mergeDockerStatsSample(
  previous: unknown,
  incoming: unknown,
  nowMs: number = Date.now(),
): DockerStatsAggregate {
  const stats = (incoming as { dockerContainerStats?: LiveContainerStats }).dockerContainerStats;
  const existing =
    typeof previous === "object" && previous !== null
      ? ((previous as DockerStatsAggregate).containers ?? {})
      : {};
  const kept: Record<string, TimestampedContainerStats> = {};
  for (const [id, entry] of Object.entries(existing)) {
    if (nowMs - entry.seenAtMs <= DOCKER_CONTAINER_EVICTION_MS) {
      kept[id] = entry;
    }
  }
  if (stats?.id) {
    kept[stats.id] = { ...stats, seenAtMs: nowMs };
  }
  return { containers: kept };
}

/** One live sample with its arrival time. */
interface StoredSample {
  data: unknown;
  receivedAtMs: number;
}

/**
 * Latest-sample store fed by the subscription feed: one slot per topic,
 * age-stamped so consumers can judge freshness.
 */
export class LiveSnapshotStore {
  private readonly samples = new Map<string, StoredSample>();
  private readonly now: () => number;

  /**
   * @param now - Injectable clock (tests).
   */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Records the newest sample for a topic.
   *
   * @param topic - The subscription topic (e.g. "dockerContainerStats").
   * @param data - The sample payload.
   */
  set(topic: string, data: unknown): void {
    this.samples.set(topic, { data, receivedAtMs: this.now() });
  }

  /**
   * Returns the latest sample and its age, or `null` when none arrived yet.
   *
   * @param topic - The subscription topic.
   * @returns The sample with `ageMs`, or `null`.
   */
  get(topic: string): { data: unknown; ageMs: number } | null {
    const sample = this.samples.get(topic);
    if (!sample) {
      return null;
    }
    return { data: sample.data, ageMs: this.now() - sample.receivedAtMs };
  }
}
