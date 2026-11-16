import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  confirmSchema,
  requireConfirmationInteractive,
  requireRiskAcknowledgementInteractive,
} from "../_shared/confirm.js";
import { createElicitationChannel, type ElicitationChannel } from "../_shared/elicitation.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import { toolError, toolText } from "../_shared/respond.js";
import {
  DRY_RUN_VALID_TEXT,
  findRiskyFields,
  type ParsedOperation,
  parseSingleOperation,
  renderJsonResult,
  validateAgainstSchema,
  validationFailure,
} from "./_shared.js";

const TOOL_NAME = "graphql_mutation";

const inputSchema = z.object({
  mutation: z
    .string()
    .min(1)
    .describe("GraphQL document containing exactly one `mutation` operation."),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Values for the variables the document declares, keyed by name without the `$`."),
  confirm: confirmSchema,
  acknowledge_risk: z
    .boolean()
    .optional()
    .describe(
      "Set `true` only after the user accepts the risk; needed when the mutation selects `setState`, `forceStop`, `reset` or `configureUps`, ignored otherwise.",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "`true` validates the document against the vendored schema and returns without sending it; no `confirm` needed.",
    ),
});

interface GraphqlMutationInput {
  mutation: string;
  variables?: Record<string, unknown>;
  confirm?: boolean;
  acknowledge_risk?: boolean;
  dry_run?: boolean;
}

/** One combined refusal message for risky fields, naming both flags at once. */
function riskyRefusalMessage(fields: string[]): string {
  return `Refusing to run this mutation: it selects ${fields.join(", ")}, which can stop the array, hard-kill a VM, or rewrite the system shutdown configuration. Re-call with both "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/** A document ready for the confirm gate, or the result to return without sending anything. */
type PreparedMutation =
  | { parsed: ParsedOperation; riskyFields: string[] }
  | { early: CallToolResult };

/**
 * Parses and validates the document locally. A non-mutation operation, a
 * schema violation, or a dry run ends here with the result to return, so
 * nothing reaches the gate or the server.
 *
 * @param input - The tool input carrying the document and the dry-run flag.
 * @returns The parsed document plus the risky fields it selects, or the early result.
 * @throws Error when the document has a syntax error or not exactly one operation.
 */
function prepareMutation(input: GraphqlMutationInput): PreparedMutation {
  const parsed = parseSingleOperation(input.mutation);
  if (parsed.operation !== "mutation") {
    return {
      early: toolError(
        `graphql_mutation only runs mutation operations; got a ${parsed.operation}. Use graphql_query for queries.`,
      ),
    };
  }
  const problems = validateAgainstSchema(parsed.document);
  if (problems.length > 0) {
    return { early: toolError(validationFailure(problems)) };
  }
  if (input.dry_run) {
    return { early: toolText(DRY_RUN_VALID_TEXT) };
  }
  return { parsed, riskyFields: findRiskyFields(parsed.document) };
}

/**
 * Two-tier gate, matching the dedicated tier-2 tools. A mutation selecting a
 * risky field needs both `confirm` and `acknowledge_risk` (one combined
 * refusal, or one two-checkbox prompt under elicitation); any other mutation
 * needs `confirm` alone. The tiers are exclusive, so the human is asked once.
 *
 * @param input - The tool input carrying both gate flags.
 * @param riskyFields - The risky field names the document selects; empty when benign.
 * @param channel - The elicitation channel, when the client can prompt the human.
 * @returns `null` to proceed, or a refusal `CallToolResult` to return as-is.
 */
async function gateRefusal(
  input: GraphqlMutationInput,
  riskyFields: string[],
  channel?: ElicitationChannel | null,
): Promise<CallToolResult | null> {
  if (riskyFields.length === 0) {
    return requireConfirmationInteractive({
      confirm: input.confirm,
      actionDescription: "run a raw GraphQL mutation against the Unraid API",
      channel,
    });
  }
  return requireRiskAcknowledgementInteractive({
    flags: input,
    refusalMessage: riskyRefusalMessage(riskyFields),
    channel,
  });
}

/**
 * Creates the `graphql_mutation` handler bound to a GraphQL executor. Accepts
 * only `mutation` operations and requires explicit confirmation before any
 * call reaches the server. A document selecting a known-dangerous field needs
 * `acknowledge_risk` as well, through the same single gate the dedicated
 * array/VM tools use.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @param channel - Optional elicitation channel; when the client supports it,
 *   the human is prompted once instead of the call being refused.
 * @returns An MCP handler returning the raw JSON data payload.
 * @example
 * const handler = createGraphqlMutationHandler(client);
 * await handler({ mutation: "mutation { archiveAll { total } }", confirm: true });
 */
export function createGraphqlMutationHandler(
  client: GraphQLExecutor,
  channel?: ElicitationChannel | null,
) {
  return async (input: GraphqlMutationInput): Promise<CallToolResult> => {
    try {
      const prepared = prepareMutation(input);
      if ("early" in prepared) {
        return prepared.early;
      }
      const refusal = await gateRefusal(input, prepared.riskyFields, channel);
      if (refusal) {
        return refusal;
      }
      const data = await client.execute(prepared.parsed.document, input.variables);
      return renderJsonResult(data);
    } catch (error) {
      const message = errorMessage(error);
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
        "⚠ Advanced escape hatch. Runs an arbitrary GraphQL *mutation* against the Unraid API, reaching write operations no dedicated tool covers yet (server identity, SSH settings, system time, Docker folders, ...). Requires `confirm: true` on every call, and additionally `acknowledge_risk: true` when the mutation selects a known-dangerous field; without them the tool refuses and never touches your server. Prefer the dedicated gated tools when one exists: they encode server quirks (stale read-backs, replace-vs-merge semantics) this passthrough does not, so verify results with a follow-up read. Only `mutation` operations are accepted (use graphql_query for queries). Every document is validated against the vendored schema before the confirm gate (typos get did-you-mean hints); `dry_run: true` validates only. The schema is in this package's schema/unraid.graphql; results are subject to the API key's permissions.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createGraphqlMutationHandler(client, createElicitationChannel(server)),
  );
}
