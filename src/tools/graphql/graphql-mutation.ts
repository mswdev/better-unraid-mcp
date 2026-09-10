import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { toolError, toolText } from "../_shared/respond.js";
import { truncateOutput } from "../_shared/truncate-output.js";
import { parseSingleOperation } from "./_shared.js";

const TOOL_NAME = "graphql_mutation";
const JSON_INDENT_SPACES = 2;

const inputSchema = {
  mutation: z.string().min(1),
  variables: z.record(z.unknown()).optional(),
  confirm: z.boolean().optional(),
};

interface GraphqlMutationInput {
  mutation: string;
  variables?: Record<string, unknown>;
  confirm?: boolean;
}

/**
 * Creates the `graphql_mutation` handler bound to a GraphQL executor. Accepts
 * only `mutation` operations and requires explicit confirmation before any
 * call reaches the server.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @returns An MCP handler returning the raw JSON data payload.
 * @example
 * const handler = createGraphqlMutationHandler(client);
 * await handler({ mutation: "mutation { archiveAll { total } }", confirm: true });
 */
export function createGraphqlMutationHandler(client: GraphQLExecutor) {
  return async (input: GraphqlMutationInput): Promise<CallToolResult> => {
    try {
      const parsed = parseSingleOperation(input.mutation);
      if (parsed.operation !== "mutation") {
        return toolError(
          `graphql_mutation only runs mutation operations; got a ${parsed.operation}. Use graphql_query for queries.`,
        );
      }
      const refusal = requireConfirmation(
        input.confirm,
        "run a raw GraphQL mutation against the Unraid API",
      );
      if (refusal) {
        return refusal;
      }
      const data = await client.execute(parsed.document, input.variables);
      return toolText(truncateOutput(JSON.stringify(data, null, JSON_INDENT_SPACES)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`GraphQL mutation failed: ${message}`);
    }
  };
}

/**
 * Registers the confirm-gated `graphql_mutation` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerGraphqlMutation(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Raw GraphQL Mutation",
      description:
        "⚠ Advanced escape hatch. Runs an arbitrary GraphQL *mutation* against the Unraid API, reaching write operations no dedicated tool covers yet (share edits, user/API-key management, disk operations, ...). Requires `confirm: true` on every call; without it the tool refuses and never touches your server. Prefer the dedicated gated tools when one exists: they encode server quirks (stale read-backs, replace-vs-merge semantics) this passthrough does not, so verify results with a follow-up read. Only `mutation` operations are accepted. The schema is in this package's schema/unraid.graphql; results are subject to the API key's permissions.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createGraphqlMutationHandler(client),
  );
}
