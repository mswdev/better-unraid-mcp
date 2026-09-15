import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { UnraidApiError } from "./errors.js";
import { type FetchLike, HttpStatusError, executeGraphQL } from "./execute.js";
import { TokenBucket } from "./rate-limit.js";

const HTTP_TOO_MANY_REQUESTS = 429;
const RETRY_DELAY_MS = 1_000;

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
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for the one HTTP status worth an automatic single retry. */
function isTooManyRequests(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status === HTTP_TOO_MANY_REQUESTS;
}

/** Live client that executes typed operations against an Unraid server. */
export class UnraidClient implements GraphQLExecutor {
  private readonly limiter: TokenBucket;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * @param config - Endpoint, key, TLS/fetch overrides, and injectables.
   */
  constructor(private readonly config: UnraidClientConfig) {
    this.limiter = config.rateLimiter ?? new TokenBucket({});
    this.sleep = config.sleep ?? defaultSleep;
  }

  /**
   * Executes a typed operation behind the rate limiter, retrying exactly
   * once after an HTTP 429 (defensive: the server's throttle is configured
   * upstream but not currently enforced — do not rely on 429 semantics).
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
    await this.limiter.acquire();
    try {
      return await this.executeOnce(document, variables);
    } catch (error) {
      if (!isTooManyRequests(error)) {
        throw error;
      }
      await this.sleep(RETRY_DELAY_MS);
      await this.limiter.acquire();
      return this.executeOnce(document, variables);
    }
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
