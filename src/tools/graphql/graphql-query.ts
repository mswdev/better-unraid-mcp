import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { toolError, toolText } from "../_shared/respond.js";
import {
  DRY_RUN_VALID_TEXT,
  parseSingleOperation,
  renderJsonResult,
  validateAgainstSchema,
  validationFailure,
} from "./_shared.js";

const TOOL_NAME = "graphql_query";

const inputSchema = z.object({
  query: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
  dry_run: z.boolean().optional(),
});

interface GraphqlQueryInput {
  query: string;
  variables?: Record<string, unknown>;
  dry_run?: boolean;
}

/**
 * Creates the `graphql_query` handler bound to a GraphQL executor. Accepts
 * only `query` operations: mutations are pointed at graphql_mutation (which
 * is confirm-gated) and subscriptions are rejected (no transport).
 *
 * @param client - The GraphQL executor used to run the query.
 * @returns An MCP handler returning the raw JSON data payload.
 * @example
 * const handler = createGraphqlQueryHandler(client);
 * await handler({ query: "query { online }" });
 */
export function createGraphqlQueryHandler(client: GraphQLExecutor) {
  return async (input: GraphqlQueryInput): Promise<CallToolResult> => {
    try {
      const parsed = parseSingleOperation(input.query);
      if (parsed.operation !== "query") {
        return toolError(
          `graphql_query only runs query operations; got a ${parsed.operation}. Use graphql_mutation for mutations (subscriptions are unsupported).`,
        );
      }
      const problems = validateAgainstSchema(parsed.document);
      if (problems.length > 0) {
        return toolError(validationFailure(problems));
      }
      if (input.dry_run) {
        return toolText(DRY_RUN_VALID_TEXT);
      }
      const data = await client.execute(parsed.document, input.variables);
      return renderJsonResult(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`GraphQL query failed: ${message}`);
    }
  };
}

/**
 * Registers the read-oriented `graphql_query` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerGraphqlQuery(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Raw GraphQL Query",
      description:
        "Advanced escape hatch. Runs an arbitrary GraphQL *query* operation against the Unraid API and returns the raw JSON data, for API fields no dedicated tool covers yet (users, API keys, registration, share details, ...). Prefer the dedicated tools when one exists: they encode server quirks this passthrough does not. Only `query` operations are accepted; mutations must go through graphql_mutation and subscriptions are unsupported. Every document is validated against the vendored schema before it is sent (typos get did-you-mean hints); pass `dry_run: true` to validate only. The schema is in this package's schema/unraid.graphql. Results are subject to the API key's permissions; oversized results are head-truncated, so narrow the selection or page.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createGraphqlQueryHandler(client),
  );
}
