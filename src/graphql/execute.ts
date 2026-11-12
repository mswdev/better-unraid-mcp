import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { print } from "graphql";
import { fetch as undiciFetch } from "undici";
import { DispatcherPool } from "./dispatcher-pool.js";

/** Subset of the fetch signature we depend on (lets tests inject a fake). */
export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<Response>;

/** Default per-request deadline so no GraphQL call can hang forever. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Options for a single GraphQL request. */
export interface GraphQLExecuteOptions {
  endpoint: string;
  apiKey: string;
  allowSelfSigned?: boolean;
  fetchImpl?: FetchLike;
  /** Per-request deadline in milliseconds; defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Connection pools to dispatch through; defaults to the process-wide shared pools. */
  dispatchers?: DispatcherPool;
}

/** Raw GraphQL response envelope. */
export interface GraphQLResponse<TData> {
  data?: TData | null;
  errors?: Array<{ message: string }>;
}

/** A non-2xx HTTP response from the Unraid endpoint, carrying its status. */
export class HttpStatusError extends Error {
  /**
   * @param status - The HTTP status code.
   * @param message - Human-readable failure description.
   */
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/** The pools every Unraid API request shares unless a caller injects its own. */
const sharedDispatchers = new DispatcherPool();

/** Undici's fetch, narrowed to the subset of the signature we depend on. */
const undiciFetchLike = undiciFetch as unknown as FetchLike;

/** True for the abort/timeout errors AbortSignal.timeout produces. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * POSTs a typed GraphQL operation to the Unraid endpoint over native fetch,
 * with a hard per-request deadline and a shared keep-alive connection pool.
 *
 * @param options - Endpoint, API key, TLS/fetch/timeout overrides.
 * @param document - A typed-document-node operation.
 * @param variables - Operation variables, if any.
 * @returns The raw GraphQL response envelope (`data` and/or `errors`).
 * @throws HttpStatusError when the HTTP response is not 2xx.
 * @throws Error when the request exceeds the deadline.
 */
export async function executeGraphQL<TData, TVariables>(
  options: GraphQLExecuteOptions,
  document: TypedDocumentNode<TData, TVariables>,
  variables?: TVariables,
): Promise<GraphQLResponse<TData>> {
  const body = JSON.stringify({ query: print(document), variables: variables ?? undefined });
  const response = await postWithDeadline(options, body);
  if (!response.ok) {
    throw new HttpStatusError(
      response.status,
      `Unraid API HTTP ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as GraphQLResponse<TData>;
}

/** Sends the POST under the configured deadline, mapping aborts to a clear error. */
async function postWithDeadline(options: GraphQLExecuteOptions, body: string): Promise<Response> {
  const doFetch = options.fetchImpl ?? undiciFetchLike;
  const dispatchers = options.dispatchers ?? sharedDispatchers;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  try {
    return await doFetch(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": options.apiKey },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: dispatchers.for(options.allowSelfSigned ?? false),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Unraid API request timed out after ${timeoutMs} ms`);
    }
    throw error;
  }
}
