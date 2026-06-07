import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  LogReadAllowlistDocument,
  type LogReadAllowlistQuery,
  LogReadContentDocument,
  type LogReadContentQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "log_read";
const DEFAULT_LINES = 100;
const MAX_LINES = 2000;
/** Cap on names listed in the unknown-file refusal so the error stays short. */
const MAX_NAMES_IN_ERROR = 25;
/** Matches the single trailing newline the API appends to non-empty content. */
const TRAILING_NEWLINE = /\n$/;

/**
 * Validator for `lines`: positive, capped, defaulted. The server applies NO
 * upper bound, so this client-side cap is load-bearing. Exported for tests.
 */
export const linesSchema = z.number().int().positive().max(MAX_LINES).default(DEFAULT_LINES);

/**
 * Validator for `start_line`: 1-indexed when present. The server silently
 * returns empty content for non-positive values, so reject them up front.
 * Exported for tests.
 */
export const startLineSchema = z.number().int().positive().optional();

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  path: z.string().min(1),
  lines: linesSchema,
  start_line: startLineSchema,
};

type AllowedFile = LogReadAllowlistQuery["logFiles"][number];
type Content = LogReadContentQuery["logFile"];

/** The validated handler input (lines is always present via the zod default). */
interface LogReadInput {
  response_format: ResponseFormat;
  path: string;
  lines: number;
  start_line?: number;
}

/** Finds the allowlisted file matching the requested full path or bare name. */
function findAllowed(files: AllowedFile[], path: string): AllowedFile | undefined {
  return files.find((file) => file.path === path || file.name === path);
}

/** Builds the refusal message naming the valid files (capped for brevity). */
function unknownFileError(files: AllowedFile[], path: string): string {
  const names = files
    .map((file) => file.name)
    .slice(0, MAX_NAMES_IN_ERROR)
    .join(", ");
  return `Unknown log file "${path}". Valid files (from log_list): ${names || "(none listed)"}.`;
}

/** Counts returned lines; non-empty content always ends with exactly one newline. */
function countLines(content: string): number {
  if (content === "") {
    return 0;
  }
  return content.replace(TRAILING_NEWLINE, "").split("\n").length;
}

/** Renders the window header, paging hints, and raw content. */
function summarize(file: Content, lines: number): string {
  const returned = countLines(file.content);
  if (file.totalLines === 0) {
    return `${file.path} is empty (0 lines).`;
  }
  if (returned === 0) {
    return `${file.path}: no lines at or after start_line=${file.startLine} (file has ${file.totalLines} lines).`;
  }
  const first = file.startLine ?? 1;
  const last = first + returned - 1;
  const parts = [`${file.path} — lines ${first}–${last} of ${file.totalLines}`];
  if (first > 1) {
    parts.push(`— earlier: re-call with start_line=${Math.max(1, first - lines)}`);
  }
  if (last < file.totalLines) {
    parts.push(`— later: re-call with start_line=${last + 1}`);
  }
  parts.push("", file.content.replace(TRAILING_NEWLINE, ""));
  return parts.join("\n");
}

/**
 * Creates the `log_read` handler bound to a GraphQL executor. The handler
 * preflights the requested path against the live `logFiles` allowlist and
 * refuses anything not listed, then fetches the requested window.
 *
 * @param client - The GraphQL executor used for the preflight and the read.
 * @returns An MCP handler returning a window of log lines.
 * @example
 * const handler = createLogReadHandler(client);
 * await handler({ response_format: "concise", path: "syslog", lines: 100 });
 */
export function createLogReadHandler(client: GraphQLExecutor) {
  return async (input: LogReadInput): Promise<CallToolResult> => {
    try {
      const preflight = await client.execute(LogReadAllowlistDocument);
      const allowed = findAllowed(preflight.logFiles, input.path);
      if (!allowed) {
        return toolError(unknownFileError(preflight.logFiles, input.path));
      }
      const data = await client.execute(LogReadContentDocument, {
        path: allowed.path,
        lines: input.lines,
        startLine: input.start_line,
      });
      return formatResponse(
        input.response_format,
        summarize(data.logFile, input.lines),
        data.logFile,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read log file ${input.path}: ${message}`);
    }
  };
}

/**
 * Registers the read-only `log_read` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerLogRead(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Read Log File",
      description:
        "Read-only. Returns lines from a server log file. `path` is a path or name from log_list — validated against that list before reading (reads are limited to filenames the server lists in its log directory; symlinked entries are read as the server resolves them). Omitting `start_line` returns the last `lines` lines (default 100, max 2000); pass `start_line` (1-indexed) to window from there and re-call with the hinted values to page. Counts may drift slightly on rapidly-growing logs; the cap bounds line count, not bytes. Requires LOGS read permission (any viewer-level key).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createLogReadHandler(client),
  );
}
