import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "./graphql/client.js";
import { registerAllTools } from "./tools/registry.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Builds a fully-configured MCP server bound to a GraphQL executor.
 * Called once for stdio, and once per request for stateless HTTP.
 */
export function buildServer(client: GraphQLExecutor): McpServer {
  const server = new McpServer({ name: "better-unraid-mcp", version: SERVER_VERSION });
  registerAllTools(server, client);
  return server;
}
