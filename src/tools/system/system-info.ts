import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { SystemInfoDocument, type SystemInfoQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "system_info";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Builds a one-line human summary of the system info payload. */
function summarize(data: SystemInfoQuery): string {
  const { os, cpu } = data.info;
  const osPart = `${os.distro ?? "Unraid"} ${os.release ?? ""}`.trim();
  const cpuPart = `${cpu.brand ?? cpu.manufacturer ?? "CPU"} (${cpu.cores ?? "?"}C/${cpu.threads ?? "?"}T)`;
  return `${osPart}, kernel ${os.kernel ?? "?"}, host ${os.hostname ?? "?"}. ${cpuPart}.`;
}

/**
 * Creates the `system_info` handler bound to a GraphQL executor.
 * Exposed separately from registration so it can be unit-tested directly.
 *
 * @param client - The GraphQL executor used to fetch system info.
 * @returns An MCP tool handler producing a concise or detailed summary.
 */
export function createSystemInfoHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(SystemInfoDocument);
      return formatResponse(response_format, summarize(data), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch system info: ${message}`);
    }
  };
}

/**
 * Registers the read-only `system_info` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerSystemInfo(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Unraid System Info",
      description:
        "Read-only. Returns the Unraid server's OS, distro, release, kernel, uptime, hostname, and a CPU summary.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    createSystemInfoHandler(client),
  );
}
