import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { type FetchLike, executeGraphQL } from "./execute.js";

/** Anything that can run a typed Unraid operation. Tools depend on this. */
export interface GraphQLExecutor {
  execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData>;
}

/** Raised when the Unraid API returns GraphQL errors or no data. */
export class UnraidApiError extends Error {}

/** Configuration for a live Unraid GraphQL client. */
export interface UnraidClientConfig {
  endpoint: string;
  apiKey: string;
  allowSelfSigned: boolean;
  fetchImpl?: FetchLike;
}

/** Live client that executes typed operations against an Unraid server. */
export class UnraidClient implements GraphQLExecutor {
  constructor(private readonly config: UnraidClientConfig) {}

  /**
   * Executes a typed operation and returns its data.
   *
   * @param document - A typed-document-node operation.
   * @param variables - Operation variables, if any.
   * @returns The typed `data` payload.
   * @throws UnraidApiError when the response has errors or null data.
   */
  async execute<TData, TVariables>(
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
