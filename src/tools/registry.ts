import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerArrayStatus } from "./array/array-status.js";
import { registerParityHistory } from "./array/parity-history.js";
import { registerDiskList } from "./disk/disk-list.js";
import { registerDockerContainerList } from "./docker/container-list.js";
import { registerShareList } from "./share/share-list.js";
import { registerSystemInfo } from "./system/system-info.js";

/**
 * Registers every tool on the server. New tools are added here as the API
 * surface grows — one `register*` call per tool module.
 *
 * @param server - The MCP server to register tools on.
 * @param client - The GraphQL executor passed to each tool.
 */
export function registerAllTools(server: McpServer, client: GraphQLExecutor): void {
  registerSystemInfo(server, client);
  registerArrayStatus(server, client);
  registerParityHistory(server, client);
  registerDiskList(server, client);
  registerShareList(server, client);
  registerDockerContainerList(server, client);
}
