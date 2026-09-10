import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ParityHistoryDocument, type ParityHistoryQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "parity_history";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
};

type Checks = ParityHistoryQuery["parityHistory"];

/** Sorts parity checks newest-first by ISO date (null dates last); the SDL guarantees no order. */
function sortNewestFirst(checks: Checks): Checks {
  return [...checks].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** Summarizes the most recent parity check. */
function summarize(checks: Checks): string {
  if (checks.length === 0) {
    return "No parity checks recorded.";
  }
  const last = checks[0];
  return `Last parity check: ${last.status} on ${last.date ?? "unknown"}, ${last.errors ?? 0} errors, ${last.speed ?? "?"} MB/s.`;
}

/**
 * Creates the `parity_history` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch parity history.
 * @returns An MCP tool handler producing recent parity-check results.
 */
export function createParityHistoryHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    limit,
  }: { response_format: ResponseFormat; limit: number }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ParityHistoryDocument);
      const checks = sortNewestFirst(data.parityHistory).slice(0, limit);
      return formatResponse(response_format, summarize(checks), checks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch parity history: ${message}`);
    }
  };
}

/**
 * Registers the read-only `parity_history` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerParityHistory(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Unraid Parity Check History",
      description:
        "Read-only. Returns the most recent parity checks (date, status, errors, speed). Use `limit` to control how many are returned.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    createParityHistoryHandler(client),
  );
}
