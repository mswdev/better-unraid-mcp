import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { type DocumentNode, Kind } from "graphql";
import { UnraidApiError } from "./errors.js";
import { type FetchLike, HttpStatusError, executeGraphQL } from "./execute.js";
import { TokenBucket } from "./rate-limit.js";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_FLOOR = 500;

/** Fixed delay before the single 429 retry. */
const RETRY_DELAY_MS = 1_000;

/** Extra attempts allowed for idempotent queries (3 attempts total). */
const MAX_QUERY_RETRIES = 2;

/** Mutations only ever retry the never-admitted 429 case, once. */
const MAX_MUTATION_RETRIES = 1;

/** Base for the exponential jittered backoff between query retries. */
const RETRY_BASE_DELAY_MS = 250;

/** Jitter floor: each delay is scaled by (0.5 + random()) ∈ [0.5, 1.5). */
const JITTER_FLOOR = 0.5;

/** What may be retried, and how often. Mutations never retry server errors. */
interface RetryPolicy {
  maxRetries: number;
  retryServerErrors: boolean;
}

/** Anything that can run a typed Unraid operation. Tools depend on this. */
export interface GraphQLExecutor {
  execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData>;
}

/** Configuration for a live Unraid GraphQL client. */
export interface UnraidClientConfig {
  endpoint: string;
  apiKey: string;
  allowSelfSigned: boolean;
  fetchImpl?: FetchLike;
  /** Injectable rate limiter; a default TokenBucket is built when omitted. */
  rateLimiter?: TokenBucket;
  /** Injectable delay (tests pass an instant resolver). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source (tests pass a constant). */
  random?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for the one HTTP status worth an automatic single retry. */
function isTooManyRequests(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status === HTTP_TOO_MANY_REQUESTS;
}

/** True when the document's single operation is a query (idempotent). */
function isQueryOperation(document: DocumentNode): boolean {
  const operation = document.definitions.find(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  return operation?.operation === "query";
}

/** Queries earn transport/5xx retries; mutations only the single 429 retry. */
function retryPolicyFor(document: DocumentNode): RetryPolicy {
  if (isQueryOperation(document)) {
    return { maxRetries: MAX_QUERY_RETRIES, retryServerErrors: true };
  }
  return { maxRetries: MAX_MUTATION_RETRIES, retryServerErrors: false };
}

/**
 * Whether an error is worth another attempt under the policy: 429 always is
 * (the request was never admitted); transport failures and 5xx responses are
 * only for idempotent queries; GraphQL-level errors never are.
 */
function isRetryable(error: unknown, policy: RetryPolicy): boolean {
  if (isTooManyRequests(error)) {
    return true;
  }
  if (!policy.retryServerErrors || error instanceof UnraidApiError) {
    return false;
  }
  if (error instanceof HttpStatusError) {
    return error.status >= HTTP_SERVER_ERROR_FLOOR;
  }
  return error instanceof Error;
}

/** Live client that executes typed operations against an Unraid server. */
export class UnraidClient implements GraphQLExecutor {
  private readonly limiter: TokenBucket;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  /**
   * @param config - Endpoint, key, TLS/fetch overrides, and injectables.
   */
  constructor(private readonly config: UnraidClientConfig) {
    this.limiter = config.rateLimiter ?? new TokenBucket({});
    this.sleep = config.sleep ?? defaultSleep;
    this.random = config.random ?? Math.random;
  }

  /**
   * Executes a typed operation behind the rate limiter. Idempotent queries
   * get a bounded jittered retry on transport failures and 5xx responses;
   * mutations retry only the never-admitted 429 case, once (defensive: the
   * server's throttle is configured upstream but not currently enforced).
   *
   * @param document - A typed-document-node operation.
   * @param variables - Operation variables, if any.
   * @returns The typed `data` payload.
   * @throws UnraidApiError when the response has errors or null data.
   * @throws HttpStatusError on persistent non-2xx responses.
   */
  async execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData> {
    const policy = retryPolicyFor(document);
    for (let attempt = 0; ; attempt += 1) {
      await this.limiter.acquire();
      try {
        return await this.executeOnce(document, variables);
      } catch (error) {
        await this.delayBeforeRetry(error, attempt, policy);
      }
    }
  }

  /** Sleeps before the next attempt, or rethrows when out of budget. */
  private async delayBeforeRetry(
    error: unknown,
    attempt: number,
    policy: RetryPolicy,
  ): Promise<void> {
    if (attempt >= policy.maxRetries || !isRetryable(error, policy)) {
      throw error;
    }
    if (isTooManyRequests(error)) {
      await this.sleep(RETRY_DELAY_MS);
      return;
    }
    const jitter = JITTER_FLOOR + this.random();
    await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt * jitter);
  }

  /** One request/response cycle with GraphQL-level error mapping. */
  private async executeOnce<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData> {
    const response = await executeGraphQL(this.config, document, variables);
    if (response.errors?.length) {
      throw new UnraidApiError(response.errors.map((error) => error.message).join("; "));
    }
    if (response.data == null) {
      throw new UnraidApiError("Unraid API returned no data");
    }
    return response.data;
  }
}
