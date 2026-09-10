import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "pino";

/**
 * Connects the server over stdio (the universal local transport).
 *
 * @param server - The MCP server to connect.
 * @param logger - Logger for readiness output (stderr only).
 * @returns A promise that resolves once the transport is connected.
 */
export async function startStdio(server: McpServer, logger: Logger): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("better-unraid-mcp ready (stdio transport)");
}
