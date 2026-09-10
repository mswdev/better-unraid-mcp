import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { toolError } from "../_shared/respond.js";
import { findRiskyFields, parseSingleOperation, renderJsonResult } from "./_shared.js";

const TOOL_NAME = "graphql_mutation";

const inputSchema = {
  mutation: z.string().min(1),
  variables: z.record(z.unknown()).optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

interface GraphqlMutationInput {
  mutation: string;
  variables?: Record<string, unknown>;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/** One combined refusal for risky fields, so callers learn both flags at once. */
function riskyRefusal(fields: string[]): CallToolResult {
  return toolError(
    `Refusing to run this mutation: it selects ${fields.join(", ")}, which can stop the array, hard-kill a VM, or rewrite the system shutdown configuration. Re-call with both "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
  );
}

/**
 * Creates the `graphql_mutation` handler bound to a GraphQL executor. Accepts
 * only `mutation` operations, requires explicit confirmation before any call
 * reaches the server, and demands an additional acknowledge_risk flag when
 * the document selects a known-dangerous field (matching the double gate the
 * dedicated array/VM tools enforce).
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
      const riskyFields = findRiskyFields(parsed.document);
      if (riskyFields.length > 0 && (input.confirm !== true || input.acknowledge_risk !== true)) {
        return riskyRefusal(riskyFields);
      }
      const refusal = requireConfirmation(
        input.confirm,
        "run a raw GraphQL mutation against the Unraid API",
      );
      if (refusal) {
        return refusal;
      }
      const data = await client.execute(parsed.document, input.variables);
      return renderJsonResult(data);
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
        "⚠ Advanced escape hatch. Runs an arbitrary GraphQL *mutation* against the Unraid API, reaching write operations no dedicated tool covers yet (share edits, user/API-key management, disk operations, ...). Requires `confirm: true` on every call, and additionally `acknowledge_risk: true` when the mutation selects a known-dangerous field (setState, forceStop, reset, configureUps); without them the tool refuses and never touches your server. Prefer the dedicated gated tools when one exists: they encode server quirks (stale read-backs, replace-vs-merge semantics) this passthrough does not, so verify results with a follow-up read. Only `mutation` operations are accepted. The schema is in this package's schema/unraid.graphql; results are subject to the API key's permissions.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createGraphqlMutationHandler(client),
  );
}
