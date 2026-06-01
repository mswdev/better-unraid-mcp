import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ShareListDocument, type ShareListQuery } from "../../types/unraid/graphql.js";
import { humanizeKilobytes, toNumber } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "share_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  name: z.string().optional(),
};

type Shares = ShareListQuery["shares"];

/** Filters shares by a case-insensitive name substring. */
function filterByName(shares: Shares, name: string | undefined): Shares {
  if (!name) {
    return shares;
  }
  const needle = name.toLowerCase();
  return shares.filter((share) => (share.name ?? "").toLowerCase().includes(needle));
}

/** Summarizes each share's used/total usage. */
function summarize(shares: Shares): string {
  if (shares.length === 0) {
    return "No shares found.";
  }
  return shares
    .map(
      (share) =>
        `${share.name ?? "(unnamed)"} — ${humanizeKilobytes(toNumber(share.used))} / ${humanizeKilobytes(toNumber(share.size))} used`,
    )
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
  }: { response_format: ResponseFormat; name?: string }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ShareListDocument);
      const shares = filterByName(data.shares, name);
      return formatResponse(response_format, summarize(shares), shares);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        "Read-only. Lists user shares with usage (free/used/total). Use `name` to filter by a share name substring.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    createShareListHandler(client),
  );
}
