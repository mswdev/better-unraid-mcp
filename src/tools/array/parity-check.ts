import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ParityCheckCancelDocument,
  ParityCheckPauseDocument,
  ParityCheckResumeDocument,
  ParityCheckStartDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "parity_check";

type ParityAction = "start" | "pause" | "resume" | "cancel";

/** A started check is read-only unless the caller opts into corrections. */
const DEFAULT_CORRECT = false;

/** Shared pointer copy — no read can confirm these mutations synchronously. */
const POINT_TO_STATUS = "Run array_status to confirm — status reads may lag a few seconds.";

/**
 * The API's action guard (validated at v4.35.0: only `start` while a check is
 * already running is filtered; pause/resume/cancel are always forwarded).
 * Matching is best-effort under production error masking.
 */
const INVALID_STATE_MESSAGE = "Invalid parity check state";

/** Thrown by the post-command history read AFTER the command already fired. */
const HISTORY_READ_MESSAGE = "Parity history file not found";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["start", "pause", "resume", "cancel"]),
  correct: z.boolean().optional(),
  confirm: z.boolean().optional(),
};

/** The validated handler arguments. */
interface ParityCheckArgs {
  response_format: ResponseFormat;
  action: ParityAction;
  correct?: boolean;
  confirm?: boolean;
}

/** Human description of the gated action for the confirm-gate refusal copy. */
function describeAction(args: ParityCheckArgs): string {
  if (args.action !== "start") {
    return `${args.action} the parity check`;
  }
  return args.correct === true
    ? "start a correcting parity check (writes corrections to parity)"
    : "start a read-only parity check";
}

/**
 * Validates `correct` usage, then applies the confirm gate. `correct` is only
 * meaningful on `start` (the web UI's "Write corrections to parity" checkbox)
 * — supplying it with any other action is rejected, never silently ignored.
 *
 * @param args - The validated handler arguments.
 * @returns `null` to proceed, or a refusal/validation error to return as-is.
 */
function gateRefusal(args: ParityCheckArgs): CallToolResult | null {
  if (args.correct !== undefined && args.action !== "start") {
    return toolError(
      '`correct` is only valid with action "start" (it selects a correcting check). No changes were made.',
    );
  }
  return requireConfirmation(args.confirm, describeAction(args));
}

/**
 * Dispatches one parity action to its typed mutation Document. The mutations'
 * `JSON!` payload is a stale parity-history array (validated at v4.35.0;
 * upstream marks the group WIP) — it is deliberately never read.
 *
 * @param client - The GraphQL executor.
 * @param action - The parity action to run.
 * @param correct - Whether a started check writes corrections to parity.
 */
async function runAction(
  client: GraphQLExecutor,
  action: ParityAction,
  correct: boolean,
): Promise<void> {
  switch (action) {
    case "start":
      await client.execute(ParityCheckStartDocument, { correct });
      return;
    case "pause":
      await client.execute(ParityCheckPauseDocument);
      return;
    case "resume":
      await client.execute(ParityCheckResumeDocument);
      return;
    case "cancel":
      await client.execute(ParityCheckCancelDocument);
      return;
  }
}

/** Success copy — "requested", never "done": the mutations return no usable status. */
function summarize(action: ParityAction, correct: boolean): string {
  if (action === "start") {
    const mode = correct ? "correcting — writes corrections to parity" : "read-only";
    return `Parity check start requested (${mode}). ${POINT_TO_STATUS}`;
  }
  return `Parity check ${action} requested. ${POINT_TO_STATUS} If no check was running, Unraid may accept this with no effect.`;
}

/** Inputs for mapping a thrown message to a known, non-generic result. */
interface KnownErrorInput {
  action: ParityAction;
  message: string;
  format: ResponseFormat;
}

/**
 * Maps the API's known messages: the start-while-running guard → a real
 * refusal; the post-command history-read failure → the command already fired,
 * so report it as issued-but-unverified rather than a failure. Returns `null`
 * for unknown messages (generic failure path).
 *
 * @param input - The action, the thrown message, and the response format.
 * @returns A mapped `CallToolResult`, or `null` when the message is unknown.
 */
function mapKnownError(input: KnownErrorInput): CallToolResult | null {
  const { action, message, format } = input;
  if (message.includes(INVALID_STATE_MESSAGE)) {
    return toolError(
      `Unraid refused to ${action} the parity check — a check is already running (run array_status to see it). No changes were made.`,
    );
  }
  if (message.includes(HISTORY_READ_MESSAGE)) {
    const summary = `The parity check ${action} command was issued, but the API's post-command history read failed. ${POINT_TO_STATUS}`;
    const detailed = { requested: action, outcome: "issued-unverified", apiMessage: message };
    return formatResponse(format, summary, detailed);
  }
  return null;
}

/**
 * Creates the `parity_check` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the parity mutations.
 * @returns An MCP handler controlling the parity job behind the confirm gate.
 */
export function createParityCheckHandler(client: GraphQLExecutor) {
  return async (args: ParityCheckArgs): Promise<CallToolResult> => {
    const { response_format, action } = args;
    const refusal = gateRefusal(args);
    if (refusal) {
      return refusal;
    }
    const correct = args.correct ?? DEFAULT_CORRECT;
    try {
      await runAction(client, action, correct);
      const detailed = { requested: action, correct, outcome: "requested" };
      return formatResponse(response_format, summarize(action, correct), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return (
        mapKnownError({ action, message, format: response_format }) ??
        toolError(`Failed to ${action} the parity check: ${message}`)
      );
    }
  };
}

/**
 * Registers the destructive `parity_check` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerParityCheck(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Control the Parity Check",
      description:
        'Starts, pauses, resumes, or cancels a parity check. `action: "start"` accepts `correct` (true = write corrections to parity, like the web UI checkbox; default false = read-only check). Requires `confirm: true`. The mutations return no usable status — run array_status afterward to confirm (status reads may lag a few seconds); pause/resume/cancel with no check running may be accepted with no effect. Requires an Unraid API key with ADMIN role. Behavior validated against Unraid API v4.35.0 (upstream marks these mutations WIP).',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createParityCheckHandler(client),
  );
}
