import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { MoverStatusDocument, type MoverStatusQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "mover_status";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

interface MoverStatusInput {
  response_format: ResponseFormat;
}

type MoverVars = MoverStatusQuery["vars"];

/** Renders running state, schedule, and logging; nulls read as "not reported". */
function summarize(vars: MoverVars): string {
  const state =
    vars.shareMoverActive === null || vars.shareMoverActive === undefined
      ? "Mover state not reported by the API."
      : vars.shareMoverActive
        ? "Mover is currently running."
        : "Mover is not running.";
  const parts = [state];
  if (vars.shareMoverSchedule) {
    parts.push(`Schedule (cron): ${vars.shareMoverSchedule}`);
  }
  if (vars.shareMoverLogging !== null && vars.shareMoverLogging !== undefined) {
    parts.push(`Mover logging: ${vars.shareMoverLogging ? "enabled" : "disabled"}`);
  }
  return parts.join("\n");
}

/**
 * Creates the `mover_status` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used for the read.
 * @returns An MCP handler reporting whether the mover is running.
 * @example
 * const handler = createMoverStatusHandler(client);
 * await handler({ response_format: "concise" });
 */
export function createMoverStatusHandler(client: GraphQLExecutor) {
  return async (input: MoverStatusInput): Promise<CallToolResult> => {
    try {
      const data = await client.execute(MoverStatusDocument);
      return formatResponse(input.response_format, summarize(data.vars), data.vars);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read mover status: ${message}`);
    }
  };
}

/**
 * Registers the read-only `mover_status` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerMoverStatus(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Mover Status",
      description:
        "Read-only. Reports whether the mover (the process that migrates data from the cache pool to the array) is currently running, plus its cron schedule and whether mover logging is enabled. Needs a viewer-level key (VARS read). Mover activity detail appears in the syslog (see log_read).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createMoverStatusHandler(client),
  );
}
