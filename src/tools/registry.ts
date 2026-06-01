import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerGetSystemInfo } from "./system/get-system-info.js";

/**
 * Registers every tool on the server. New tools are added here as the API
 * surface grows — one `register*` call per tool module.
 */
export function registerAllTools(server: McpServer, client: GraphQLExecutor): void {
  registerGetSystemInfo(server, client);
}
