import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShellExecutor, ShellResult } from "../../shell/executor.js";
import { requireShell } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { quoteForShell, truncateOutput } from "./_shared.js";

const TOOL_NAME = "file_read";
const DEFAULT_LINES = 200;
const MAX_LINES = 2000;
/** Deadline for one read; generous enough for grep over a multi-GB log. */
const READ_TIMEOUT_MS = 60_000;
/** grep exits 1 when it ran fine but nothing matched. */
const GREP_NO_MATCH_EXIT = 1;
/** Matches the single trailing newline tail/grep output ends with. */
const TRAILING_NEWLINE = /\n$/;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  path: z.string().min(1),
  lines: z.number().int().positive().max(MAX_LINES).default(DEFAULT_LINES),
  pattern: z.string().min(1).optional(),
};

/** The validated handler input (lines is always present via the zod default). */
interface FileReadInput {
  response_format: ResponseFormat;
  path: string;
  lines: number;
  pattern?: string;
}

/**
 * Builds the remote command: a plain tail, or a grep piped into tail when a
 * pattern is given. `pipefail` makes grep's failure (e.g. unreadable file)
 * surface as the pipeline's exit code instead of being masked by tail's 0.
 * Exported for tests.
 *
 * @param input - The validated tool input.
 * @returns The exact shell command sent over SSH.
 */
export function buildReadCommand(input: FileReadInput): string {
  const path = quoteForShell(input.path);
  if (input.pattern) {
    const pattern = quoteForShell(input.pattern);
    return `set -o pipefail; grep -E -e ${pattern} -- ${path} | tail -n ${input.lines}`;
  }
  return `tail -n ${input.lines} -- ${path}`;
}

/** Renders the result: no-match and empty cases get explicit messages. */
function renderResult(input: FileReadInput, result: ShellResult): CallToolResult {
  const noMatch = input.pattern && result.exitCode === GREP_NO_MATCH_EXIT && !result.stderr.trim();
  if (noMatch) {
    return formatResponse(
      input.response_format,
      `No lines in ${input.path} match pattern ${input.pattern}.`,
      { path: input.path, exit_code: result.exitCode, content: "" },
    );
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "(no error output)";
    return toolError(`Failed to read ${input.path} (exit ${result.exitCode}): ${detail}`);
  }
  const content = truncateOutput(result.stdout.replace(TRAILING_NEWLINE, ""));
  const summary =
    content === ""
      ? `${input.path} is empty${input.pattern ? ` (or nothing matched ${input.pattern})` : ""}.`
      : `${input.path}: last ${input.lines} lines${input.pattern ? ` matching ${input.pattern}` : ""}:\n\n${content}`;
  return formatResponse(input.response_format, summary, {
    path: input.path,
    exit_code: result.exitCode,
    content,
  });
}

/**
 * Creates the `file_read` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or `null` when SSH is not configured.
 * @returns An MCP handler returning the tail of (or grep matches in) a file.
 * @example
 * const handler = createFileReadHandler(shell);
 * await handler({ response_format: "concise", path: "/boot/logs/syslog-previous", lines: 200 });
 */
export function createFileReadHandler(shell: ShellExecutor | null) {
  return async (input: FileReadInput): Promise<CallToolResult> => {
    const unavailable = requireShell(shell);
    if (unavailable || !shell) {
      return unavailable ?? toolError("SSH is not configured.");
    }
    if (!input.path.startsWith("/")) {
      return toolError(`path must be absolute (start with "/"); got "${input.path}".`);
    }
    try {
      const result = await shell.execute(buildReadCommand(input), READ_TIMEOUT_MS);
      return renderResult(input, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read ${input.path} over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `file_read` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor the tool uses (or `null` when unconfigured).
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerFileRead(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Read Host File",
      description:
        "Read-only. Returns the last `lines` lines (default 200, max 2000) of any absolute file path on the Unraid host over SSH, reaching files the GraphQL API cannot (e.g. /boot/logs/syslog-previous, /proc/cpuinfo). Optional `pattern` (extended regex) filters server-side via grep before the tail, so searching huge logs stays cheap. Requires SSH to be configured (UNRAID_SSH_* environment variables); reads run as the SSH user (typically root).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createFileReadHandler(shell),
  );
}
