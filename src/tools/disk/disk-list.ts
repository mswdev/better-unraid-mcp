import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { DiskListDocument, type DiskListQuery } from "../../types/unraid/graphql.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "disk_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type Disks = DiskListQuery["disks"];

/** Summarizes each physical disk on one line. */
function summarize(disks: Disks): string {
  if (disks.length === 0) {
    return "No physical disks detected.";
  }
  return disks
    .map((disk) => {
      const temp = disk.temperature != null ? `, ${disk.temperature}°C` : "";
      return `${disk.name} (${humanizeBytes(disk.size)}, ${disk.interfaceType}) — SMART ${disk.smartStatus}${temp}`;
    })
    .join("\n");
}

/**
 * Creates the `disk_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch physical disks.
 * @returns An MCP tool handler listing physical disks and their health.
 */
export function createDiskListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DiskListDocument);
      return formatResponse(response_format, summarize(data.disks), data.disks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch disks: ${message}`);
    }
  };
}

/**
 * Registers the read-only `disk_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDiskList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Unraid Physical Disks",
      description:
        "Read-only. Lists physical disks with model, size, interface, SMART status, temperature, and partitions.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createDiskListHandler(client),
  );
}
