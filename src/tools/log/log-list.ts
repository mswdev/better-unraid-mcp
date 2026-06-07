import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { LogListDocument, type LogListQuery } from "../../types/unraid/graphql.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "log_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type LogFiles = LogListQuery["logFiles"];

/** Sorts log files most-recently-modified first (ISO timestamps compare lexically). */
function sortNewestFirst(files: LogFiles): LogFiles {
  return [...files].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Renders one line per file; an empty list is ambiguous upstream (errors are swallowed to []). */
function summarize(files: LogFiles): string {
  if (files.length === 0) {
    return "No log files listed (the API also returns an empty list when the log directory is unreadable).";
  }
  return files
    .map((file) => `${file.name} — ${humanizeBytes(file.size)}, modified ${file.modifiedAt}`)
    .join("\n");
}

/**
 * Creates the `log_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to list log files.
 * @returns An MCP handler returning the server's log file inventory.
 * @example
 * const handler = createLogListHandler(client);
 * await handler({ response_format: "concise" });
 */
export function createLogListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(LogListDocument);
      const files = sortNewestFirst(data.logFiles);
      return formatResponse(response_format, summarize(files), files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list log files: ${message}`);
    }
  };
}

/**
 * Registers the read-only `log_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerLogList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Log Files",
      description:
        "Read-only. Lists the server's log files (name, path, size, last modified), most recently modified first. Pass a returned path or name to log_read. An empty list may also mean the log directory was unreadable — the API does not distinguish. Requires LOGS read permission (any viewer-level key).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createLogListHandler(client),
  );
}
