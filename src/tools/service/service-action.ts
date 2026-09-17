import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ShellExecutor } from "../../shell/executor.js";
import { requireRiskAcknowledgementInteractive } from "../_shared/confirm.js";
import { type ElicitationChannel, createElicitationChannel } from "../_shared/elicitation.js";
import { quoteForShell } from "../_shared/quote-shell.js";
import { sshUnavailableError } from "../_shared/require-shell.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import {
  PROBE_TIMEOUT_MS,
  SERVICES,
  SERVICE_TIMEOUT_MS,
  type ServiceName,
  type ServiceState,
  parseStatusOutput,
  rcCommand,
  rcScript,
} from "./_shared.js";

const TOOL_NAME = "service_action";

type ServiceVerb = "restart" | "start" | "stop";

/** Stopping these takes down every container / VM; array_action and the web UI own that. */
const NEVER_STOP: ReadonlySet<ServiceName> = new Set(["docker", "libvirt"]);

/** The state each verb is expected to leave the service in. */
const EXPECTED_STATE: Record<ServiceVerb, ServiceState> = {
  restart: "running",
  start: "running",
  stop: "stopped",
};

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  service: z.enum(["samba", "nfs", "sshd", "docker", "libvirt", "tailscale"]),
  action: z.enum(["restart", "start", "stop"]),
  allow_stop: z.boolean().optional(),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
});

/** The validated handler input. */
export interface ServiceActionArgs {
  response_format?: ResponseFormat;
  service: ServiceName;
  action: ServiceVerb;
  allow_stop?: boolean;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

function isKnownService(service: string): service is ServiceName {
  return service in SERVICES;
}

/** Argument-level refusals that need no shell access. */
function validate(args: ServiceActionArgs): CallToolResult | null {
  if (!isKnownService(args.service)) {
    return toolError(
      `Unknown service "${args.service}". Known: ${Object.keys(SERVICES).join(", ")}. No changes were made.`,
    );
  }
  if (args.action === "stop" && NEVER_STOP.has(args.service)) {
    return toolError(
      `Refusing to stop ${args.service}: that takes every container/VM offline — stop the array with array_action or use the web UI instead. No changes were made.`,
    );
  }
  if (args.action === "stop" && args.allow_stop !== true) {
    return toolError(
      `Refusing to stop ${args.service}: stopping it cuts off every client using it (shares/SSH). Re-call with "allow_stop": true as well if that is intended. No changes were made.`,
    );
  }
  return null;
}

function refusalMessage(args: ServiceActionArgs): string {
  return `Refusing to ${args.action} ${args.service}: this interrupts the service for every client using it (${SERVICES[args.service]} ${args.action}). Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`;
}

/** Runs the verb, then reads the status back so the report never guesses. */
async function runVerb(shell: ShellExecutor, args: ServiceActionArgs): Promise<CallToolResult> {
  const probe = await shell.execute(
    `test -x ${quoteForShell(rcScript(args.service))}`,
    PROBE_TIMEOUT_MS,
  );
  if (probe.exitCode !== 0) {
    return toolError(
      `${args.service} is not installed on this server (${rcScript(args.service)} is missing). No changes were made.`,
    );
  }
  const action = await shell.execute(rcCommand(args.service, args.action), SERVICE_TIMEOUT_MS);
  if (action.exitCode !== 0) {
    return toolError(
      `${SERVICES[args.service]} ${args.action} failed (exit ${action.exitCode}): ${action.stderr.trim() || action.stdout.trim()}`,
    );
  }
  const status = await shell.execute(rcCommand(args.service, "status"), PROBE_TIMEOUT_MS);
  const state = parseStatusOutput(status.stdout);
  return renderOutcome(args, state, status.stdout.trim());
}

function renderOutcome(
  args: ServiceActionArgs,
  state: ServiceState,
  detail: string,
): CallToolResult {
  const verified = state === EXPECTED_STATE[args.action];
  const payload = {
    service: args.service,
    action: args.action,
    stateAfter: state,
    verified,
    detail,
  };
  if (!verified) {
    return toolError(
      `${SERVICES[args.service]} ${args.action} ran, but the status read-back says: "${detail}" (state ${state}, expected ${EXPECTED_STATE[args.action]}). Check the syslog with log_read.`,
    );
  }
  return formatResponse(
    args.response_format ?? "concise",
    `${args.service} ${args.action} done — state now ${state} (verified: "${detail}")`,
    payload,
  );
}

/**
 * Creates the `service_action` handler bound to a shell executor.
 *
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @param channel - Optional elicitation channel for interactive confirmation.
 * @returns An MCP handler that restarts/starts/stops a host service.
 */
export function createServiceActionHandler(
  shell: ShellExecutor | null,
  channel?: ElicitationChannel | null,
) {
  return async (args: ServiceActionArgs): Promise<CallToolResult> => {
    if (!shell) {
      return sshUnavailableError();
    }
    const invalid = validate(args);
    if (invalid) {
      return invalid;
    }
    const refusal = await requireRiskAcknowledgementInteractive({
      flags: args,
      refusalMessage: refusalMessage(args),
      channel,
    });
    if (refusal) {
      return refusal;
    }
    try {
      return await runVerb(shell, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.action} ${args.service} over SSH: ${message}`);
    }
  };
}

/**
 * Registers the destructive `service_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param shell - The SSH executor, or null when SSH is not configured.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerServiceAction(server: McpServer, shell: ShellExecutor | null): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Restart / Start / Stop a Host Service",
      description:
        "⚠ Runs `/etc/rc.d/rc.<service> restart|start|stop` over SSH for samba, nfs, sshd, docker, libvirt, or tailscale, then reads the status back and reports it (never assumes success). `restart` is the normal use. `stop` additionally requires `allow_stop: true` because stopping samba/nfs cuts every client off their shares (and stopping sshd cuts off this very tool); stopping docker or libvirt is refused outright — use array_action or the web UI. Requires `confirm: true` AND `acknowledge_risk: true`, plus SSH.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    createServiceActionHandler(shell, createElicitationChannel(server)),
  );
}
