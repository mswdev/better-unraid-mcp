import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { print } from "graphql";
import { Agent, fetch as undiciFetch } from "undici";

/** Subset of the fetch signature we depend on (lets tests inject a fake). */
export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<Response>;

/** Options for a single GraphQL request. */
export interface GraphQLExecuteOptions {
  endpoint: string;
  apiKey: string;
  allowSelfSigned?: boolean;
  fetchImpl?: FetchLike;
}

/** Raw GraphQL response envelope. */
export interface GraphQLResponse<TData> {
  data?: TData | null;
  errors?: Array<{ message: string }>;
}

const selfSignedDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

function defaultFetch(allowSelfSigned: boolean): FetchLike {
  return (url, init) =>
    undiciFetch(url, {
      ...init,
      dispatcher: allowSelfSigned ? selfSignedDispatcher : undefined,
    }) as unknown as Promise<Response>;
}

/**
 * POSTs a typed GraphQL operation to the Unraid endpoint over native fetch.
 *
 * @param options - Endpoint, API key, TLS and fetch overrides.
 * @param document - A typed-document-node operation.
 * @param variables - Operation variables, if any.
 * @returns The raw GraphQL response envelope (`data` and/or `errors`).
 * @throws Error when the HTTP response is not 2xx.
 */
export async function executeGraphQL<TData, TVariables>(
  options: GraphQLExecuteOptions,
  document: TypedDocumentNode<TData, TVariables>,
  variables?: TVariables,
): Promise<GraphQLResponse<TData>> {
  const doFetch = options.fetchImpl ?? defaultFetch(options.allowSelfSigned ?? false);
  const response = await doFetch(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": options.apiKey },
    body: JSON.stringify({ query: print(document), variables: variables ?? undefined }),
  });
  if (!response.ok) {
    throw new Error(`Unraid API HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as GraphQLResponse<TData>;
}
