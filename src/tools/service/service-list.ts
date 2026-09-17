import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import {
  NOT_INSTALLED_MARKER,
  SERVICES,
  SERVICE_NAMES,
  SERVICE_TIMEOUT_MS,
  type ServiceName,
  type ServiceState,
  parseStatusOutput,
  rcScript,
} from "./_shared.js";

const TOOL_NAME = "service_list";

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
});

/** One service's status as reported by its rc.d script. */
interface ServiceStatus {
  name: ServiceName;
  script: string;
  state: ServiceState;
  detail: string;
}

/** One shell round-trip: `rc.X: <status line>` per service, or the not-installed marker. */
function buildListCommand(): string {
  return SERVICE_NAMES.map((name) => {
    const script = quoteForShell(rcScript(name));
    return `if [ -x ${script} ]; then echo "${SERVICES[name]}: $(${script} status 2>&1 | head -1)"; else echo "${SERVICES[name]}: ${NOT_INSTALLED_MARKER}"; fi`;
  }).join("; ");
}

/** Maps `rc.samba: Samba server daemon is currently running.` lines back to services. */
function parseListing(stdout: string): ServiceStatus[] {
  const byScript = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf(": ");
    if (separator > 0) {
      byScript.set(line.slice(0, separator), line.slice(separator + ": ".length).trim());
    }
  }
  return SERVICE_NAMES.map((name) => {
    const detail = byScript.get(SERVICES[name]) ?? "";
    return { name, script: rcScript(name), state: parseStatusOutput(detail), detail };
  });
}

const STATE_LABELS: Record<ServiceState, string> = {
  running: "running",
  stopped: "stopped",
  not_installed: "not installed",
  unknown: "unknown",
};

function summarize(services: ServiceStatus[]): string {
  return services.map((service) => `${service.name}: ${STATE_LABELS[service.state]}`).join("\n");
}

/**
 * Creates the `service_list` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns An MCP handler reporting the state of the standard host services.
 */
export function createServiceListHandler(shell: ShellExecutor | null) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    try {
      const result = await shell.execute(buildListCommand(), SERVICE_TIMEOUT_MS);
      const services = parseListing(result.stdout);
      return formatResponse(input.response_format, summarize(services), { services });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list services over SSH: ${message}`);
    }
  };
}

/**
 * Registers the read-only `service_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerServiceList(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Host Services",
      description:
        "Read-only. Reports whether the standard Unraid host services are running — samba (SMB shares), nfs, sshd, docker, libvirt (VMs), tailscale — by asking each /etc/rc.d/rc.* script for its status over SSH. Services whose script is absent are reported as not installed. The GraphQL API has no service surface. Requires SSH (UNRAID_SSH_*).",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createServiceListHandler(shell),
  );
}
