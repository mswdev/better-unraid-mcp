import { type Client, createClient } from "graphql-ws";
import { WebSocket } from "ws";

/** Bounded reconnect budget; graphql-ws backs off between attempts. */
const RETRY_ATTEMPTS = 10;

/** What a subscriber receives. */
export interface FeedHandlers {
  onData(data: unknown): void;
  onError?(error: unknown): void;
}

/** The graphql-ws client surface the feed depends on. Test seam. */
export interface CreateClientLike {
  subscribe(
    payload: { query: string; variables?: Record<string, unknown> },
    sink: {
      next(value: { data?: unknown }): void;
      error(error: unknown): void;
      complete(): void;
    },
  ): () => void;
  dispose(): void;
}

/** Configuration for the live subscription feed. */
export interface SubscriptionFeedOptions {
  endpoint: string;
  apiKey: string;
  /** Injectable client factory (tests). Default builds a real graphql-ws client. */
  createClientImpl?: () => CreateClientLike;
}

/**
 * Maps the configured HTTP GraphQL endpoint to its WebSocket twin — the
 * Unraid API serves subscriptions on the same /graphql path.
 *
 * @param endpoint - The configured http(s) endpoint.
 * @returns The ws(s) URL.
 */
export function toWsUrl(endpoint: string): string {
  return endpoint.replace(/^http/, "ws");
}

/**
 * Lazily-connected graphql-ws subscription client. The wire subprotocol is
 * graphql-transport-ws; authentication rides in the connection_init payload
 * (`{"x-api-key": ...}`), which the API's auth guard merges into request
 * headers. Reconnects are handled by graphql-ws itself.
 */
export class SubscriptionFeed {
  private client: CreateClientLike | null = null;
  private readonly buildClient: () => CreateClientLike;

  /**
   * @param options - Endpoint, key, and the injectable client factory.
   */
  constructor(options: SubscriptionFeedOptions) {
    this.buildClient = options.createClientImpl ?? (() => realClient(options));
  }

  /**
   * Starts one subscription, connecting the shared socket on first use.
   *
   * @param query - The raw subscription document text.
   * @param variables - Operation variables, if any.
   * @param handlers - Data/error callbacks; errors never throw into callers.
   * @returns An unsubscribe function.
   */
  subscribe(
    query: string,
    variables: Record<string, unknown> | undefined,
    handlers: FeedHandlers,
  ): () => void {
    this.client ??= this.buildClient();
    return this.client.subscribe(
      { query, variables },
      {
        next: (value) => {
          if (value.data !== undefined && value.data !== null) {
            handlers.onData(value.data);
          }
        },
        error: (error) => handlers.onError?.(error),
        complete: () => {},
      },
    );
  }

  /** Closes the shared socket and every subscription on it. */
  dispose(): void {
    this.client?.dispose();
    this.client = null;
  }
}

/** Builds the real graphql-ws client bound to the Unraid endpoint. */
function realClient(options: SubscriptionFeedOptions): CreateClientLike {
  const client: Client = createClient({
    url: toWsUrl(options.endpoint),
    connectionParams: { "x-api-key": options.apiKey },
    webSocketImpl: WebSocket,
    lazy: true,
    retryAttempts: RETRY_ATTEMPTS,
    shouldRetry: () => true,
  });
  return {
    subscribe: (payload, sink) => client.subscribe(payload, sink),
    dispose: () => {
      void client.dispose();
    },
  };
}
