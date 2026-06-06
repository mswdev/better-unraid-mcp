import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ArraySetStateDocument, type ArrayStateInputState } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "array_action";

type ArrayAction = "start" | "stop";

/** Lowercase tool action → SDL `ArrayStateInputState` value. */
export const DESIRED_STATE: Record<ArrayAction, ArrayStateInputState> = {
  start: "START",
  stop: "STOP",
};

/**
 * Success copy per action — "requested", never "done": setState returns the
 * pre-mutation store snapshot (validated at unraid/api v4.35.0), so the
 * resulting state cannot be reported from this call.
 */
const REQUESTED_SUMMARY: Record<ArrayAction, string> = {
  start: "Array start requested. Run array_status to confirm — state reads may lag a few seconds.",
  stop: "Array stop requested — Unraid is taking every share, Docker container, and VM offline. Run array_status to confirm — state reads may lag a few seconds.",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["start", "stop"]),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface ArrayActionArgs {
  response_format: ResponseFormat;
  action: ArrayAction;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * Two-tier gate. `stop` needs both `confirm` and `acknowledge_risk` (one
 * combined refusal naming both — the risk axis is blast radius, not
 * corruption); `start` uses the shared `requireConfirmation`.
 *
 * @param args - The action and both gate flags.
 * @returns `null` when gated through, otherwise an error `CallToolResult`.
 */
function gateRefusal(args: ArrayActionArgs): CallToolResult | null {
  const { action, confirm, acknowledge_risk } = args;
  if (action !== "stop") {
    return requireConfirmation(confirm, `${action} the array`);
  }
  if (confirm === true && acknowledge_risk === true) {
    return null;
  }
  return toolError(
    'Refusing to stop the array: Unraid will take every share, Docker container, and VM offline until the array is started again. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.',
  );
}

/**
 * Creates the `array_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the setState mutation.
 * @returns An MCP handler that starts/stops the array behind the gate.
 */
export function createArrayActionHandler(client: GraphQLExecutor) {
  return async (args: ArrayActionArgs): Promise<CallToolResult> => {
    const { response_format, action } = args;
    const refusal = gateRefusal(args);
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(ArraySetStateDocument, {
        input: { desiredState: DESIRED_STATE[action] },
      });
      const detailed = {
        requested: action,
        outcome: "requested",
        // Pre-mutation snapshot, NOT the result (no store reload upstream).
        preMutationState: data.array.setState.state,
      };
      return formatResponse(response_format, REQUESTED_SUMMARY[action], detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${action} the array: ${message}`);
    }
  };
}

/**
 * Registers the destructive `array_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerArrayAction(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Start or Stop the Unraid Array",
      description:
        "Starts or stops the array. ⚠ stop: Unraid takes every share, Docker container, and VM offline (the API does not check for active services first). Requires `confirm: true`; stop additionally requires `acknowledge_risk: true`. The mutation cannot report the resulting state — run array_status afterward to confirm (state reads may lag a few seconds). Requires an Unraid API key with ADMIN role. Encrypted arrays cannot be started by this tool (no decryption inputs) — use the web UI.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createArrayActionHandler(client),
  );
}
