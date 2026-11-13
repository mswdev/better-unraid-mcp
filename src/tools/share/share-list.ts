import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ShareListDocument, type ShareListQuery } from "../../types/unraid/graphql.js";
import { errorMessage } from "../_shared/errors/error-message.js";
import { humanizeKilobytes, toNumber } from "../_shared/format-bytes.js";
import {
  formatResponse,
  type ResponseFormat,
  responseFormatSchema,
  toolError,
} from "../_shared/respond.js";

const TOOL_NAME = "share_list";

const inputSchema = z.object({
  response_format: responseFormatSchema,
  name: z
    .string()
    .optional()
    .describe("Case-insensitive substring of the share name to filter by; omit to list all."),
});

type Shares = ShareListQuery["shares"];

/** Filters shares by a case-insensitive name substring. */
function filterByName(shares: Shares, name: string | undefined): Shares {
  if (!name) {
    return shares;
  }
  const needle = name.toLowerCase();
  return shares.filter((share) => (share.name ?? "").toLowerCase().includes(needle));
}

/**
 * Summarizes each share's usage. Total is computed as used + free because the
 * API's `size` field is 0 for shares without a size limit (the common case),
 * which previously rendered as a misleading "/ 0 B used".
 */
function summarize(shares: Shares): string {
  if (shares.length === 0) {
    return "No shares found.";
  }
  return shares
    .map((share) => {
      const used = toNumber(share.used);
      const free = toNumber(share.free);
      return `${share.name ?? "(unnamed)"} — ${humanizeKilobytes(used)} used of ${humanizeKilobytes(used + free)} (${humanizeKilobytes(free)} free)`;
    })
    .join("\n");
}

/**
 * Creates the `share_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch shares.
 * @returns An MCP tool handler listing user shares and their usage.
 */
export function createShareListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    name,
  }: {
    response_format: ResponseFormat;
    name?: string;
  }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ShareListDocument);
      const shares = filterByName(data.shares, name);
      return formatResponse(response_format, summarize(shares), shares);
    } catch (error) {
      const message = errorMessage(error);
      return toolError(`Failed to fetch shares: ${message}`);
    }
  };
}

/**
 * Registers the read-only `share_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerShareList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Unraid Shares",
      description:
        "Read-only. Lists user shares with usage (free/used/total); `detailed` adds each share's cache flag, included/excluded disks, and comment. Use `name` to filter by a share name substring. Pass a returned name to share_edit, share_delete, or flash_backup; those accept only letters, digits, dots, underscores, and hyphens. Allocator, cache-mode, and SMB settings are not returned (read /boot/config/shares/<name>.cfg with file_read). For array-wide capacity and per-disk usage use array_status.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createShareListHandler(client),
  );
}
