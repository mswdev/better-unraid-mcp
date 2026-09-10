import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "../graphql/client.js";
import type { ShellExecutor } from "../shell/executor.js";
import { registerArrayAction } from "./array/array-action.js";
import { registerArrayStatus } from "./array/array-status.js";
import { registerParityCheck } from "./array/parity-check.js";
import { registerParityHistory } from "./array/parity-history.js";
import { registerDiskList } from "./disk/disk-list.js";
import { registerDockerAutostartSet } from "./docker/autostart-set.js";
import { registerDockerContainerAction } from "./docker/container-action.js";
import { registerDockerContainerList } from "./docker/container-list.js";
import { registerDockerContainerLogs } from "./docker/container-logs.js";
import { registerDockerContainerRemove } from "./docker/container-remove.js";
import { registerDockerContainerUpdate } from "./docker/container-update.js";
import { registerDockerStats } from "./docker/docker-stats.js";
import { registerDockerNetworkList } from "./docker/network-list.js";
import { registerDockerPortConflicts } from "./docker/port-conflicts.js";
import { registerLogList } from "./log/log-list.js";
import { registerLogRead } from "./log/log-read.js";
import { registerMoverStatus } from "./mover/mover-status.js";
import { registerNotificationAlerts } from "./notification/notification-alerts.js";
import { registerNotificationArchive } from "./notification/notification-archive.js";
import { registerNotificationCreate } from "./notification/notification-create.js";
import { registerNotificationDelete } from "./notification/notification-delete.js";
import { registerNotificationList } from "./notification/notification-list.js";
import { registerNotificationOverview } from "./notification/notification-overview.js";
import { registerNotificationRecalculate } from "./notification/notification-recalculate.js";
import { registerPluginAdd } from "./plugin/plugin-add.js";
import { registerPluginList } from "./plugin/plugin-list.js";
import { registerPluginRemove } from "./plugin/plugin-remove.js";
import { registerShareList } from "./share/share-list.js";
import { registerFileRead } from "./shell/file-read.js";
import { registerShellExec } from "./shell/shell-exec.js";
import { registerSystemInfo } from "./system/system-info.js";
import { registerSystemMetrics } from "./system/system-metrics.js";
import { registerUpsStatus } from "./ups/ups-status.js";
import { registerVmAction } from "./vm/vm-action.js";
import { registerVmList } from "./vm/vm-list.js";

/**
 * Registers every tool on the server. New tools are added here as the API
 * surface grows — one `register*` call per tool module. GraphQL-backed tools
 * take the GraphQL executor; host-level tools take the shell executor, which
 * is `null` when SSH is not configured (they then refuse with guidance).
 *
 * @param server - The MCP server to register tools on.
 * @param client - The GraphQL executor passed to each GraphQL-backed tool.
 * @param shell - The SSH executor passed to host-level tools, or `null`.
 */
export function registerAllTools(
  server: McpServer,
  client: GraphQLExecutor,
  shell: ShellExecutor | null,
): void {
  registerSystemInfo(server, client);
  registerSystemMetrics(server, client);
  registerLogList(server, client);
  registerLogRead(server, client);
  registerArrayStatus(server, client);
  registerArrayAction(server, client);
  registerParityHistory(server, client);
  registerParityCheck(server, client);
  registerDiskList(server, client);
  registerShareList(server, client);
  registerDockerAutostartSet(server, client);
  registerDockerContainerAction(server, client);
  registerDockerContainerList(server, client);
  registerDockerContainerLogs(server, client);
  registerDockerContainerRemove(server, client);
  registerDockerContainerUpdate(server, client);
  registerDockerNetworkList(server, client);
  registerDockerPortConflicts(server, client);
  registerVmList(server, client);
  registerVmAction(server, client);
  registerNotificationOverview(server, client);
  registerNotificationList(server, client);
  registerNotificationAlerts(server, client);
  registerNotificationArchive(server, client);
  registerNotificationDelete(server, client);
  registerNotificationCreate(server, client);
  registerNotificationRecalculate(server, client);
  registerPluginList(server, client);
  registerPluginAdd(server, client);
  registerPluginRemove(server, client);
  registerUpsStatus(server, client);
  registerMoverStatus(server, client);
  registerDockerStats(server, shell);
  registerFileRead(server, shell);
  registerShellExec(server, shell);
}
