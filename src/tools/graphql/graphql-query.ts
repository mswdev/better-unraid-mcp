import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { toolError, toolText } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";
import { parseSingleOperation } from "./_shared.js";

const TOOL_NAME = "graphql_query";
const JSON_INDENT_SPACES = 2;

const inputSchema = {
  query: z.string().min(1),
  variables: z.record(z.unknown()).optional(),
};

interface GraphqlQueryInput {
  query: string;
  variables?: Record<string, unknown>;
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
      const data = await client.execute(parsed.document, input.variables);
      return toolText(truncateOutput(JSON.stringify(data, null, JSON_INDENT_SPACES)));
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
        "Advanced escape hatch. Runs an arbitrary GraphQL *query* operation against the Unraid API and returns the raw JSON data, for API fields no dedicated tool covers yet (users, API keys, registration, share details, ...). Prefer the dedicated tools when one exists: they encode server quirks this passthrough does not. Only `query` operations are accepted; mutations must go through graphql_mutation and subscriptions are unsupported. The schema is in this package's schema/unraid.graphql. Results are subject to the API key's permissions; output is capped.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createGraphqlQueryHandler(client),
  );
}
