import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllPrompts } from "./prompts/registry.js";
import { registerAllResources } from "./resources/registry.js";
import { type RegistryOptions, registerAllTools } from "./tools/registry.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Builds a fully-configured MCP server bound to its executors: every
 * (permitted) tool, the unraid:// resources, and the guided prompts.
 * Called once for stdio, and once per request for stateless HTTP.
 *
 * @param options - Executors plus the read-only flag, passed to the registry.
 * @returns A configured McpServer.
 */
export function buildServer(options: RegistryOptions): McpServer {
  const server = new McpServer({ name: "better-unraid-mcp", version: SERVER_VERSION });
  registerAllTools(server, options);
  registerAllResources(server, options);
  registerAllPrompts(server);
  return server;
}
