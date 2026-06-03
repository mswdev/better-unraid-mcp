import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { VmListDocument, type VmListQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "vm_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  name: z.string().optional(),
};

/** Non-null element list of the `vms.domains` selection. */
type VmDomains = NonNullable<VmListQuery["vms"]["domains"]>;

/** Filters VMs by a case-insensitive substring of their (nullable) name. */
function filterByName(domains: VmDomains, name: string | undefined): VmDomains {
  if (!name) {
    return domains;
  }
  const needle = name.toLowerCase();
  return domains.filter((domain) => domain.name?.toLowerCase().includes(needle));
}

/**
 * One line per VM: `name — state`, falling back to `(id)` for a null name. An
 * empty result distinguishes "nothing matched the filter" from "no VMs at all",
 * so a filtered caller is not misled into thinking the host has no VMs.
 */
function summarize(domains: VmDomains, name: string | undefined): string {
  if (domains.length === 0) {
    return name ? `No VMs match '${name}'.` : "No VMs found.";
  }
  return domains.map((domain) => `${domain.name ?? `(${domain.id})`} — ${domain.state}`).join("\n");
}

/**
 * Creates the `vm_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch VMs.
 * @returns An MCP handler listing VMs and their run state.
 */
export function createVmListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    name,
  }: { response_format: ResponseFormat; name?: string }): Promise<CallToolResult> => {
    try {
      const { vms } = await client.execute(VmListDocument);
      const domains = filterByName(vms.domains ?? [], name);
      return formatResponse(response_format, summarize(domains, name), domains);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch VMs: ${message}`);
    }
  };
}

/**
 * Registers the read-only `vm_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerVmList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Virtual Machines",
      description:
        "Read-only. Lists virtual machines with their run state (RUNNING, SHUTOFF, PAUSED, …). Use `name` to filter by a VM-name substring.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createVmListHandler(client),
  );
}
