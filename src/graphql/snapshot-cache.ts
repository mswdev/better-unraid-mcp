import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import {
  ArrayStatusDocument,
  DockerContainerListDocument,
  SystemMetricsDocument,
} from "../types/unraid/graphql.js";
import type { GraphQLExecutor } from "./client.js";

/** How long a hot-path snapshot is served before refetching. */
export const SNAPSHOT_TTL_MS = 5_000;

/**
 * The hot read documents worth caching: dashboards and agents poll these in
 * tight loops. Everything else always hits the server.
 */
const DEFAULT_CACHEABLE_DOCUMENTS: ReadonlySet<unknown> = new Set([
  SystemMetricsDocument,
  ArrayStatusDocument,
  DockerContainerListDocument,
]);

/** Serve-age stamps for payload objects handed out by the cache. */
const servedAges = new WeakMap<object, number>();

/** One cached snapshot. */
interface CacheEntry {
  data: unknown;
  storedAtMs: number;
}

/** Injection points for deterministic tests. */
export interface CachingExecutorOptions {
  ttlMs?: number;
  now?: () => number;
  documents?: ReadonlySet<unknown>;
}

/**
 * Looks up how stale a payload served by the cache is: 0 for a fresh fetch,
 * the serve-time age for a cached snapshot, `undefined` for data that never
 * passed through the cache. Tools include this as `data_age_ms` in detailed
 * output so users can tell a snapshot from a live read.
 *
 * @param data - A payload object previously returned by a CachingExecutor.
 * @returns Age in milliseconds at serve time, or `undefined`.
 */
export function cacheAgeMs(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  return servedAges.get(data);
}

/**
 * GraphQLExecutor decorator that serves a short-lived snapshot for an
 * allow-list of hot read documents, keyed by document + variables. Mutations
 * and non-listed queries pass straight through.
 */
export class CachingExecutor implements GraphQLExecutor {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly documentIds = new Map<unknown, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cacheable: ReadonlySet<unknown>;

  /**
   * @param inner - The real executor performing the network round-trip.
   * @param options - TTL/clock/allow-list overrides (tests).
   */
  constructor(
    private readonly inner: GraphQLExecutor,
    options: CachingExecutorOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.cacheable = options.documents ?? DEFAULT_CACHEABLE_DOCUMENTS;
  }

  /**
   * Executes the operation, serving a cached snapshot when the document is
   * allow-listed and its entry is younger than the TTL.
   *
   * @param document - A typed-document-node operation.
   * @param variables - Operation variables, if any.
   * @returns The typed `data` payload (possibly a cached snapshot).
   */
  async execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData> {
    if (!this.cacheable.has(document)) {
      return this.inner.execute(document, variables);
    }
    const key = this.cacheKey(document, variables);
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.storedAtMs <= this.ttlMs) {
      this.stampAge(cached.data, this.now() - cached.storedAtMs);
      return cached.data as TData;
    }
    const data = await this.inner.execute(document, variables);
    this.cache.set(key, { data, storedAtMs: this.now() });
    this.stampAge(data, 0);
    return data;
  }

  /** Stable key: an id per document object plus the serialized variables. */
  private cacheKey(document: unknown, variables: unknown): string {
    let id = this.documentIds.get(document);
    if (id === undefined) {
      id = this.documentIds.size;
      this.documentIds.set(document, id);
    }
    return `${id}:${JSON.stringify(variables ?? null)}`;
  }

  /** Records serve age for later `cacheAgeMs` lookups. */
  private stampAge(data: unknown, ageMs: number): void {
    if (typeof data === "object" && data !== null) {
      servedAges.set(data, ageMs);
    }
  }
}
