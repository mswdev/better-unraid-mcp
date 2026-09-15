import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegistryOptions } from "../tools/registry.js";
import { runConnectionDoctor } from "../tools/system/connection-doctor.js";
import { runSystemHealth } from "../tools/system/system-health.js";
import { loadSchemaSdl } from "./schema-sdl.js";

const SCHEMA_URI = "unraid://schema";
const HEALTH_URI = "unraid://health";
const DOCTOR_URI = "unraid://doctor";
const JSON_INDENT_SPACES = 2;

/**
 * Registers the server's MCP resources: the vendored GraphQL SDL, the
 * system-health rollup, and the connection self-test. Read-only by nature,
 * so read-only mode changes nothing here.
 *
 * @param server - The MCP server to register resources on.
 * @param options - The executors and mode shared with the tool registry.
 * @returns Nothing; registers resources as a side effect.
 */
export function registerAllResources(server: McpServer, options: RegistryOptions): void {
  server.registerResource(
    "unraid-schema",
    SCHEMA_URI,
    {
      title: "Unraid GraphQL Schema",
      description:
        "The vendored Unraid API GraphQL SDL this server was built against — the reference for graphql_query / graphql_mutation.",
      mimeType: "application/graphql",
    },
    async () => ({
      contents: [{ uri: SCHEMA_URI, mimeType: "application/graphql", text: loadSchemaSdl() }],
    }),
  );
  server.registerResource(
    "unraid-health",
    HEALTH_URI,
    {
      title: "System Health Rollup",
      description:
        "Severity-scored health report (ok / warning / critical) across array, capacity, disks, parity, notifications, UPS, and container updates.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: HEALTH_URI,
          mimeType: "application/json",
          text: JSON.stringify(await runSystemHealth(options.client), null, JSON_INDENT_SPACES),
        },
      ],
    }),
  );
  server.registerResource(
    "unraid-doctor",
    DOCTOR_URI,
    {
      title: "Connection Doctor",
      description:
        "Self-test of this MCP server's plumbing: GraphQL reachability, API key validity, SSH connectivity, rate-limit config, read-only mode.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: DOCTOR_URI,
          mimeType: "application/json",
          text: JSON.stringify(await runConnectionDoctor(options), null, JSON_INDENT_SPACES),
        },
      ],
    }),
  );
}
