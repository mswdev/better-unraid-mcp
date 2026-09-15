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
