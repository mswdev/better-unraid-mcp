import { METRIC_SUBSCRIPTIONS, type MetricTopic, extractSeries } from "./metric-subscriptions.js";
import type { SubscriptionFeed } from "./subscription-feed.js";

/** One point per 30 seconds… */
export const BUCKET_MS = 30_000;
/** …kept for 24 hours… */
export const RETENTION_MS = 24 * 60 * 60 * 1000;
/** …which is this many ring slots per topic (2880). */
export const BUCKET_CAPACITY = RETENTION_MS / BUCKET_MS;

const MS_PER_MINUTE = 60_000;

/** Per-series aggregate within one bucket. */
export interface SeriesStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/** One downsampled point. */
export interface HistoryPoint {
  bucketStartMs: number;
  series: Record<string, SeriesStats>;
}

interface Accumulator {
  min: number;
  max: number;
  sum: number;
  count: number;
}

interface Slot {
  bucketIndex: number;
  series: Record<string, Accumulator>;
}

function fold(accumulator: Accumulator | undefined, value: number): Accumulator {
  if (!accumulator) {
    return { min: value, max: value, sum: value, count: 1 };
  }
  return {
    min: Math.min(accumulator.min, value),
    max: Math.max(accumulator.max, value),
    sum: accumulator.sum + value,
    count: accumulator.count + 1,
  };
}

function toPoint(slot: Slot): HistoryPoint {
  const series: Record<string, SeriesStats> = {};
  for (const [name, acc] of Object.entries(slot.series)) {
    series[name] = { min: acc.min, max: acc.max, avg: acc.sum / acc.count, count: acc.count };
  }
  return { bucketStartMs: slot.bucketIndex * BUCKET_MS, series };
}

/**
 * A fixed-size ring of 30-second buckets: adding a sample folds it into the
 * bucket for its timestamp, and a slot is reused once its bucket is older
 * than the retention window. Memory is bounded by {@link BUCKET_CAPACITY}.
 */
export class MetricRingBuffer {
  private readonly slots: Array<Slot | null> = new Array(BUCKET_CAPACITY).fill(null);
  private readonly now: () => number;

  /**
   * @param now - Injectable clock (tests).
   */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Folds one sample into its bucket.
   *
   * @param values - Named numeric series from {@link extractSeries}.
   * @param atMs - Sample time; defaults to the clock.
   */
  add(values: Record<string, number>, atMs: number = this.now()): void {
    const bucketIndex = Math.floor(atMs / BUCKET_MS);
    const position = bucketIndex % BUCKET_CAPACITY;
    const existing = this.slots[position];
    const slot = existing?.bucketIndex === bucketIndex ? existing : { bucketIndex, series: {} };
    for (const [name, value] of Object.entries(values)) {
      slot.series[name] = fold(slot.series[name], value);
    }
    this.slots[position] = slot;
  }

  /**
   * Points whose bucket starts at or after `sinceMs`, oldest first.
   *
   * @param sinceMs - Window start (epoch ms).
   * @returns The points in the window; buckets without samples are absent.
   */
  window(sinceMs: number): HistoryPoint[] {
    const firstIndex = Math.floor(sinceMs / BUCKET_MS);
    return this.slots
      .filter((slot): slot is Slot => slot !== null && slot.bucketIndex >= firstIndex)
      .sort((a, b) => a.bucketIndex - b.bucketIndex)
      .map(toPoint);
  }

  /** Number of buckets currently holding samples. */
  size(): number {
    return this.slots.filter((slot) => slot !== null).length;
  }
}

/** What the recorder needs: a feed to subscribe on and a clock. */
export interface RecorderDeps {
  feed: Pick<SubscriptionFeed, "subscribe">;
  now?: () => number;
}

/** A window of one topic's history plus how complete it is. */
export interface HistoryWindow {
  points: HistoryPoint[];
  gaps: number;
  expectedBuckets: number;
}

/**
 * Opt-in sampler: subscribes to the three metric feeds and downsamples every
 * sample into per-topic ring buffers for the life of the process.
 */
export class MetricsHistoryRecorder {
  private readonly buffers: Record<MetricTopic, MetricRingBuffer>;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly feed: Pick<SubscriptionFeed, "subscribe">;
  private readonly now: () => number;
  private startedAt: number | null = null;

  /**
   * @param deps - The subscription feed and an injectable clock.
   */
  constructor(deps: RecorderDeps) {
    this.feed = deps.feed;
    this.now = deps.now ?? Date.now;
    this.buffers = {
      cpu: new MetricRingBuffer(this.now),
      memory: new MetricRingBuffer(this.now),
      network: new MetricRingBuffer(this.now),
    };
  }

  /** Opens the three feed subscriptions (idempotent). */
  start(): void {
    if (this.startedAt !== null) {
      return;
    }
    this.startedAt = this.now();
    for (const spec of Object.values(METRIC_SUBSCRIPTIONS)) {
      const unsubscribe = this.feed.subscribe(spec.query, undefined, {
        onData: (data) => this.record(spec.topic, data),
        onError: () => {},
      });
      this.unsubscribers.push(unsubscribe);
    }
  }

  private record(topic: MetricTopic, data: unknown): void {
    const values = extractSeries(topic, data);
    if (values) {
      this.buffers[topic].add(values);
    }
  }

  /** Closes every subscription; the buffers keep their samples. */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    this.startedAt = null;
  }

  isRunning(): boolean {
    return this.startedAt !== null;
  }

  /** When recording began (epoch ms), or null while stopped. */
  startedAtMs(): number | null {
    return this.startedAt;
  }

  /**
   * The last `windowMinutes` of one topic, capped at the recorder's start.
   *
   * @param topic - cpu | memory | network.
   * @param windowMinutes - How far back to look.
   * @returns Points plus the number of expected-but-missing buckets.
   */
  window(topic: MetricTopic, windowMinutes: number): HistoryWindow {
    const requestedSince = this.now() - windowMinutes * MS_PER_MINUTE;
    const since = Math.max(requestedSince, this.startedAt ?? requestedSince);
    const points = this.buffers[topic].window(since);
    const expectedBuckets = Math.max(1, Math.ceil((this.now() - since) / BUCKET_MS));
    return { points, gaps: Math.max(0, expectedBuckets - points.length), expectedBuckets };
  }
}
