import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ArrayStatusDocument, type ArrayStatusQuery } from "../../types/unraid/graphql.js";
import { humanizeKilobytes, toNumber } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "array_status";
const PERCENT = 100;
const DISK_OK = "DISK_OK";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Builds a one-line summary of the array's health. */
function summarize(data: ArrayStatusQuery): string {
  const { array } = data;
  const totalKb = toNumber(array.capacity.kilobytes.total);
  const usedKb = toNumber(array.capacity.kilobytes.used);
  const percent = totalKb > 0 ? Math.round((usedKb / totalKb) * PERCENT) : 0;
  const dataOk = array.disks.filter((disk) => disk.status === DISK_OK).length;
  const parity = array.parityCheckStatus;
  return `Array ${array.state} — ${humanizeKilobytes(usedKb)} / ${humanizeKilobytes(totalKb)} used (${percent}%). Parity: ${parity.status}, ${parity.errors ?? 0} errors. Disks: ${dataOk}/${array.disks.length} data OK, ${array.parities.length} parity, ${array.caches.length} cache.`;
}

/**
 * Creates the `array_status` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch array status.
 * @returns An MCP tool handler producing an array-health summary.
 */
export function createArrayStatusHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ArrayStatusDocument);
      return formatResponse(response_format, summarize(data), data.array);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch array status: ${message}`);
    }
  };
}

/**
 * Registers the read-only `array_status` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerArrayStatus(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Unraid Array Status",
      description:
        "Read-only. Returns the array state, capacity, current parity-check status, and a per-disk health summary (data, parity, and cache disks).",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createArrayStatusHandler(client),
  );
}
