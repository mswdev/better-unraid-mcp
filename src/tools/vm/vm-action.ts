import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  VmForceStopDocument,
  VmPauseDocument,
  VmRebootDocument,
  VmResetDocument,
  VmResolveDocument,
  type VmResolveQuery,
  VmResumeDocument,
  VmStartDocument,
  VmStopDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

/** The number of colon-separated parts a prefixed `PrefixedID` (`serverId:rawId`) has. */
const PREFIXED_ID_PARTS = 2;

/**
 * Strips the `serverId:` prefix from a `PrefixedID`, mirroring the upstream scalar:
 * it returns the part after the colon only when the value splits into exactly two
 * parts, otherwise the value unchanged. A bare uuid (no colon) round-trips as-is,
 * so a caller may pass either the prefixed `id` from `vm_list` or a bare uuid.
 *
 * @param id - A VM id: either `serverId:uuid` or a bare uuid.
 * @returns The uuid without its server prefix, or the input unchanged.
 */
export function stripServerPrefix(id: string): string {
  const parts = id.split(":");
  return parts.length === PREFIXED_ID_PARTS ? parts[1] : id;
}

const TOOL_NAME = "vm_action";

type VmAction = "start" | "stop" | "pause" | "resume" | "forceStop" | "reboot" | "reset";

/** The two ungraceful actions that can corrupt the guest filesystem. */
const UNGRACEFUL: ReadonlySet<VmAction> = new Set(["forceStop", "reset"]);

/** Completed-action verb per action (the resolver awaits to completion). */
const PAST_TENSE: Record<VmAction, string> = {
  start: "Started",
  stop: "Stopped",
  pause: "Paused",
  resume: "Resumed",
  forceStop: "Force-stopped",
  reboot: "Rebooted",
  reset: "Reset",
};

/** A resolvable VM (id + nullable name) from the `VmResolve` read. */
type VmDomain = NonNullable<VmResolveQuery["vms"]["domains"]>[number];

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  vm: z.string(),
  action: z.enum(["start", "stop", "pause", "resume", "forceStop", "reboot", "reset"]),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface VmActionArgs {
  response_format: ResponseFormat;
  vm: string;
  action: VmAction;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * Two-tier gate. Ungraceful actions need both `confirm` and `acknowledge_risk`
 * (one combined refusal naming both); every other action uses the shared
 * `requireConfirmation`. Returns `null` to proceed, or a refusal to return as-is.
 *
 * @param args - The action, both gate flags, and the raw `vm` target for the message.
 * @returns `null` when gated through, otherwise an error `CallToolResult`.
 */
function gateRefusal(args: VmActionArgs): CallToolResult | null {
  const { action, confirm, acknowledge_risk, vm } = args;
  if (!UNGRACEFUL.has(action)) {
    return requireConfirmation(confirm, `${action} VM ${vm}`);
  }
  if (confirm === true && acknowledge_risk === true) {
    return null;
  }
  return toolError(
    `Refusing to ${action} VM ${vm}: this ungraceful action can corrupt the guest filesystem (like pulling the power). Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.`,
  );
}

/** True when the input matches the VM's id directly or after stripping either server prefix. */
function matchesId(domain: VmDomain, vm: string): boolean {
  return domain.id === vm || stripServerPrefix(domain.id) === stripServerPrefix(vm);
}

/** Result of resolving the `vm` target: a matched domain, or an error message. */
interface ResolveResult {
  domain?: VmDomain;
  error?: string;
}

/** Resolves `vm` to a single VM: tolerant id match first, then exact case-insensitive name. */
function resolveVm(domains: VmDomain[], vm: string): ResolveResult {
  const byId = domains.find((domain) => matchesId(domain, vm));
  if (byId) {
    return { domain: byId };
  }
  const needle = vm.toLowerCase();
  // Optional chaining mirrors vm-list.ts: a null name yields `undefined === needle` → excluded.
  const byName = domains.filter((domain) => domain.name?.toLowerCase() === needle);
  if (byName.length === 1) {
    return { domain: byName[0] };
  }
  if (byName.length === 0) {
    return { error: `No VM matches '${vm}'.` };
  }
  return {
    error: `Multiple VMs named '${vm}': ${byName.map((domain) => domain.id).join(", ")}. Pass the id to disambiguate.`,
  };
}

/** Dispatches one lifecycle action to its typed mutation Document; returns the Boolean result. */
async function runAction(client: GraphQLExecutor, action: VmAction, id: string): Promise<boolean> {
  switch (action) {
    case "start":
      return (await client.execute(VmStartDocument, { id })).vm.start;
    case "stop":
      return (await client.execute(VmStopDocument, { id })).vm.stop;
    case "pause":
      return (await client.execute(VmPauseDocument, { id })).vm.pause;
    case "resume":
      return (await client.execute(VmResumeDocument, { id })).vm.resume;
    case "forceStop":
      return (await client.execute(VmForceStopDocument, { id })).vm.forceStop;
    case "reboot":
      return (await client.execute(VmRebootDocument, { id })).vm.reboot;
    case "reset":
      return (await client.execute(VmResetDocument, { id })).vm.reset;
  }
}

/**
 * Builds the concise summary. A `true` result earns completed past-tense copy; a
 * `false` result hits the defensive guard. Per source validation the VM mutations
 * are `true`-or-throw (failures throw a GraphQLError), so `false` is unreachable —
 * this branch is intentional `Boolean!`-contract insurance for the un-live-verified
 * API, NOT the autostart no-op case.
 *
 * @param action - The dispatched action (selects the verb).
 * @param label - The VM's display label (name, or id when the name is null).
 * @param ok - The mutation's Boolean result.
 * @returns The concise summary line.
 */
function summarize(action: VmAction, label: string, ok: boolean): string {
  if (!ok) {
    return `VM ${label}: ${action} returned false instead of confirming success. Run vm_list to check the current state.`;
  }
  return `${PAST_TENSE[action]} VM ${label}.`;
}

/**
 * Creates the `vm_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to resolve the VM and run the mutation.
 * @returns An MCP handler that changes a VM's run state behind the confirm gate.
 */
export function createVmActionHandler(client: GraphQLExecutor) {
  return async (args: VmActionArgs): Promise<CallToolResult> => {
    const { response_format, vm, action } = args;
    const refusal = gateRefusal(args);
    if (refusal) {
      return refusal;
    }
    try {
      const { vms } = await client.execute(VmResolveDocument);
      const { domain, error } = resolveVm(vms.domains ?? [], vm);
      if (!domain) {
        return toolError(error ?? `No VM matches '${vm}'.`);
      }
      const ok = await runAction(client, action, domain.id);
      const label = domain.name ?? domain.id;
      const detailed = { ok, action, id: domain.id, name: domain.name ?? null };
      return formatResponse(response_format, summarize(action, label, ok), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${action} VM ${vm}: ${message}`);
    }
  };
}

/**
 * Registers the destructive `vm_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerVmAction(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Control a Virtual Machine",
      description:
        "Changes a VM's run state. `action`: start/resume (bring up / un-pause), stop (graceful ACPI shutdown — waits ~10s then force-kills if the guest doesn't respond), reboot (graceful — fails if the guest ignores ACPI within ~10s; use forceStop then start), pause (freeze in memory), or forceStop/reset (⚠ ungraceful hard kill / hard kill-and-cold-boot that can corrupt the guest filesystem). `vm` accepts a VM name or id. Requires `confirm: true`; forceStop and reset additionally require `acknowledge_risk: true`. The configured Unraid API key must have VM permission.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createVmActionHandler(client),
  );
}
