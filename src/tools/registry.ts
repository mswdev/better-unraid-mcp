import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "../graphql/client.js";
import type { ShellExecutor } from "../shell/executor.js";
import { registerArrayAction } from "./array/array-action.js";
import { registerArrayStatus } from "./array/array-status.js";
import { registerParityCheck } from "./array/parity-check.js";
import { registerParityHistory } from "./array/parity-history.js";
import { registerDiskList } from "./disk/disk-list.js";
import { registerDockerAutostartSet } from "./docker/autostart-set.js";
import { registerDockerContainerAction } from "./docker/container/container-action.js";
import { registerDockerContainerList } from "./docker/container/container-list.js";
import { registerDockerContainerLogs } from "./docker/container/container-logs.js";
import { registerDockerContainerRemove } from "./docker/container/container-remove.js";
import { registerDockerContainerUpdate } from "./docker/container/container-update.js";
import { registerDockerStats } from "./docker/docker-stats.js";
import { registerDockerNetworkList } from "./docker/network-list.js";
import { registerDockerPortConflicts } from "./docker/port-conflicts.js";
import { registerGraphqlMutation } from "./graphql/graphql-mutation.js";
import { registerGraphqlQuery } from "./graphql/graphql-query.js";
import { registerLogList } from "./log/log-list.js";
import { registerLogRead } from "./log/log-read.js";
import { registerMoverAction } from "./mover/mover-action.js";
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

/** Dependencies and mode shared by every tool registration. */
export interface RegistryOptions {
  client: GraphQLExecutor;
  shell: ShellExecutor | null;
  readOnly: boolean;
}

/** One tool's registry entry: whether it mutates server state, and how to register it. */
export interface ToolRegistration {
  isMutating: boolean;
  register: (server: McpServer, options: RegistryOptions) => void;
}

/**
 * Every tool, in registration order. `isMutating` must mirror the tool's
 * `readOnlyHint` annotation (enforced by registry tests); read-only mode
 * skips mutating entries entirely, so they never appear in the listing.
 */
export const TOOL_REGISTRATIONS: ToolRegistration[] = [
  { isMutating: false, register: (server, { client }) => registerSystemInfo(server, client) },
  { isMutating: false, register: (server, { client }) => registerSystemMetrics(server, client) },
  { isMutating: false, register: (server, { client }) => registerLogList(server, client) },
  { isMutating: false, register: (server, { client }) => registerLogRead(server, client) },
  { isMutating: false, register: (server, { client }) => registerArrayStatus(server, client) },
  { isMutating: true, register: (server, { client }) => registerArrayAction(server, client) },
  { isMutating: false, register: (server, { client }) => registerParityHistory(server, client) },
  { isMutating: true, register: (server, { client }) => registerParityCheck(server, client) },
  { isMutating: false, register: (server, { client }) => registerDiskList(server, client) },
  { isMutating: false, register: (server, { client }) => registerShareList(server, client) },
  {
    isMutating: true,
    register: (server, { client }) => registerDockerAutostartSet(server, client),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerDockerContainerAction(server, client),
  },
  {
    isMutating: false,
    register: (server, { client }) => registerDockerContainerList(server, client),
  },
  {
    isMutating: false,
    register: (server, { client, shell }) => registerDockerContainerLogs(server, client, shell),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerDockerContainerRemove(server, client),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerDockerContainerUpdate(server, client),
  },
  {
    isMutating: false,
    register: (server, { client }) => registerDockerNetworkList(server, client),
  },
  {
    isMutating: false,
    register: (server, { client }) => registerDockerPortConflicts(server, client),
  },
  { isMutating: false, register: (server, { client }) => registerVmList(server, client) },
  { isMutating: true, register: (server, { client }) => registerVmAction(server, client) },
  {
    isMutating: false,
    register: (server, { client }) => registerNotificationOverview(server, client),
  },
  { isMutating: false, register: (server, { client }) => registerNotificationList(server, client) },
  {
    isMutating: false,
    register: (server, { client }) => registerNotificationAlerts(server, client),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerNotificationArchive(server, client),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerNotificationDelete(server, client),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerNotificationCreate(server, client),
  },
  {
    isMutating: true,
    register: (server, { client }) => registerNotificationRecalculate(server, client),
  },
  { isMutating: false, register: (server, { client }) => registerPluginList(server, client) },
  { isMutating: true, register: (server, { client }) => registerPluginAdd(server, client) },
  { isMutating: true, register: (server, { client }) => registerPluginRemove(server, client) },
  { isMutating: false, register: (server, { client }) => registerUpsStatus(server, client) },
  { isMutating: false, register: (server, { client }) => registerMoverStatus(server, client) },
  { isMutating: true, register: (server, { shell }) => registerMoverAction(server, shell) },
  { isMutating: false, register: (server, { shell }) => registerDockerStats(server, shell) },
  { isMutating: false, register: (server, { shell }) => registerFileRead(server, shell) },
  { isMutating: true, register: (server, { shell }) => registerShellExec(server, shell) },
  { isMutating: false, register: (server, { client }) => registerGraphqlQuery(server, client) },
  { isMutating: true, register: (server, { client }) => registerGraphqlMutation(server, client) },
];

/**
 * Registers every tool on the server. In read-only mode mutating tools are
 * skipped entirely — absent from the listing, not rejected at call time.
 *
 * @param server - The MCP server to register tools on.
 * @param options - Executors plus the read-only flag.
 */
export function registerAllTools(server: McpServer, options: RegistryOptions): void {
  for (const tool of TOOL_REGISTRATIONS) {
    if (options.readOnly && tool.isMutating) {
      continue;
    }
    tool.register(server, options);
  }
}
