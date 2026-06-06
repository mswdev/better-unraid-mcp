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

/**
 * The API's same-state guard message per action (validated at v4.35.0).
 * Matching is best-effort: production error masking may rewrite messages, in
 * which case the generic failure path runs instead.
 */
const ALREADY_IN_STATE_MESSAGE: Record<ArrayAction, string> = {
  start: "The array is already STARTED",
  stop: "The array is already STOPPED",
};

/** The API's re-entrancy guard: another state change is still in flight. */
const CHANGE_IN_FLIGHT_MESSAGE = "Array state is still being updated";

/** Thrown by the post-command read-back AFTER setState already fired. */
const STATE_NOT_LOADED_MESSAGE = "state was not loaded";

/**
 * Benign no-op copy per action. The stop copy hedges: the API reports error
 * states (e.g. TOO_MANY_MISSING_DISKS) with the same "already STOPPED"
 * message, so it cannot be taken literally.
 */
const NO_OP_SUMMARY: Record<ArrayAction, string> = {
  start: "Unraid reports the array is already STARTED — no action was taken.",
  stop: "Unraid reports the array is already stopped — or it is in an error state where stop does not apply (the API reports both the same way). Run array_status to see the actual state. No changes were made.",
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

/** Inputs for mapping a thrown message to a known, non-generic result. */
interface KnownErrorInput {
  action: ArrayAction;
  message: string;
  format: ResponseFormat;
}

/**
 * Maps the API's known guard/read-back messages to honest results: same-state
 * → benign no-op; in-flight → transient failure; state-not-loaded → the
 * command already fired, so report it as issued-but-unverified rather than a
 * failure. Returns `null` for unknown messages (generic failure path).
 *
 * @param input - The action, the thrown message, and the response format.
 * @returns A mapped `CallToolResult`, or `null` when the message is unknown.
 */
function mapKnownError(input: KnownErrorInput): CallToolResult | null {
  const { action, message, format } = input;
  if (message.includes(ALREADY_IN_STATE_MESSAGE[action])) {
    const detailed = { requested: action, outcome: "already-in-state", apiMessage: message };
    return formatResponse(format, NO_OP_SUMMARY[action], detailed);
  }
  if (message.includes(CHANGE_IN_FLIGHT_MESSAGE)) {
    return toolError(
      `Cannot ${action} the array: another array state change is still in progress. Retry shortly. No changes were made.`,
    );
  }
  if (message.includes(STATE_NOT_LOADED_MESSAGE)) {
    const summary = `The array ${action} command was issued, but the API could not read back the array state. Run array_status to check the result.`;
    const detailed = { requested: action, outcome: "issued-unverified", apiMessage: message };
    return formatResponse(format, summary, detailed);
  }
  return null;
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
      return (
        mapKnownError({ action, message, format: response_format }) ??
        toolError(`Failed to ${action} the array: ${message}`)
      );
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
