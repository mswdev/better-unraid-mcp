import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "./graphql/client.js";
import type { ShellExecutor } from "./shell/executor.js";
import { registerAllTools } from "./tools/registry.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Builds a fully-configured MCP server bound to its executors.
 * Called once for stdio, and once per request for stateless HTTP.
 *
 * @param client - The GraphQL executor the registered tools will use.
 * @param shell - The SSH executor for host-level tools, or `null` when SSH is not configured.
 * @returns A configured McpServer with all tools registered.
 */
export function buildServer(client: GraphQLExecutor, shell: ShellExecutor | null): McpServer {
  const server = new McpServer({ name: "better-unraid-mcp", version: SERVER_VERSION });
  registerAllTools(server, client, shell);
  return server;
}
