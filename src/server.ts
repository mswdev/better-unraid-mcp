import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type RegistryOptions, registerAllTools } from "./tools/registry.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Builds a fully-configured MCP server bound to its executors.
 * Called once for stdio, and once per request for stateless HTTP.
 *
 * @param options - Executors plus the read-only flag, passed to the registry.
 * @returns A configured McpServer with all (permitted) tools registered.
 */
export function buildServer(options: RegistryOptions): McpServer {
  const server = new McpServer({ name: "better-unraid-mcp", version: SERVER_VERSION });
  registerAllTools(server, options);
  return server;
}
