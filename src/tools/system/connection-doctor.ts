import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { BUCKET_CAPACITY, REFILL_PER_SECOND } from "../../graphql/rate-limit.js";
import type { ShellExecutor } from "../../shell/executor.js";
import { ConnectionDoctorDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "connection_doctor";

/** A cheap remote command proving the SSH channel end to end. */
const SSH_PROBE_COMMAND = "echo ok";
const SSH_PROBE_TIMEOUT_MS = 10_000;

/** One diagnostic check's outcome. */
export interface DoctorCheck {
  check: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** Everything the doctor inspects. */
export interface DoctorDeps {
  client: GraphQLExecutor;
  shell: ShellExecutor | null;
  readOnly: boolean;
  /** Upstream API version the vendored schema was fetched from (null when unrecorded). */
  schemaApiVersion: string | null;
}

/** The graphql check plus the API version it observed (null when unreachable or unreported). */
interface GraphqlProbe {
  check: DoctorCheck;
  apiVersion: string | null;
}

/** Number of leading version segments that define the schema contract (major.minor). */
const CONTRACT_SEGMENTS = 2;

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
});

/** Classifies a GraphQL failure into actionable guidance. */
function classifyGraphqlFailure(message: string): DoctorCheck {
  if (message.includes("401") || message.includes("403") || message.includes("Unauthorized")) {
    return {
      check: "graphql",
      status: "fail",
      detail: `API key rejected (${message}). Regenerate the key in Unraid Settings → Management Access → API Keys and update UNRAID_API_KEY.`,
    };
  }
  return {
    check: "graphql",
    status: "fail",
    detail: `Endpoint unreachable (${message}). Check UNRAID_API_URL (must end in /graphql), the server being up, and TLS (UNRAID_ALLOW_SELF_SIGNED for self-signed certs).`,
  };
}

/** Runs the GraphQL probe, measuring round-trip latency. */
async function checkGraphql(client: GraphQLExecutor): Promise<GraphqlProbe> {
  const startedAt = Date.now();
  try {
    const data = await client.execute(ConnectionDoctorDocument);
    const latencyMs = Date.now() - startedAt;
    const core = data.info.versions.core;
    const check: DoctorCheck = {
      check: "graphql",
      status: "ok",
      detail: `Reachable in ${latencyMs} ms — Unraid ${core.unraid ?? "?"}, API ${core.api ?? "?"}, online=${data.online}.`,
    };
    return { check, apiVersion: core.api ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { check: classifyGraphqlFailure(message), apiVersion: null };
  }
}

/** "4.37.4+ad268301" → "4.37": the part of a version that defines the schema contract. */
function contractVersion(version: string): string {
  return version.split("+")[0].split(".").slice(0, CONTRACT_SEGMENTS).join(".");
}

/**
 * Compares the server's reported API version with the version the vendored
 * schema was fetched from. Only major.minor matter; a mismatch is a warning
 * (fields may be missing or renamed), never a failure.
 *
 * @param serverVersion - `info.versions.core.api` from the server, or null when unknown.
 * @param schemaVersion - The recorded upstream version, or null when unrecorded.
 * @returns The `schema` doctor check.
 * @example
 * compareApiVersions("4.37.4+abc", "4.37.1").status; // "ok"
 */
export function compareApiVersions(
  serverVersion: string | null,
  schemaVersion: string | null,
): DoctorCheck {
  if (schemaVersion === null) {
    return {
      check: "schema",
      status: "warn",
      detail:
        "Vendored schema version unrecorded — run npm run schema:update in a checkout to record it.",
    };
  }
  if (serverVersion === null) {
    return {
      check: "schema",
      status: "warn",
      detail: `Server API version unknown (GraphQL check failed?), so schema skew vs vendored ${schemaVersion} cannot be assessed.`,
    };
  }
  if (contractVersion(serverVersion) === contractVersion(schemaVersion)) {
    return {
      check: "schema",
      status: "ok",
      detail: `Vendored schema matches the server API (${schemaVersion} vs ${serverVersion}).`,
    };
  }
  return {
    check: "schema",
    status: "warn",
    detail: `Schema skew: server API ${serverVersion} vs vendored schema ${schemaVersion} — fields may be missing or renamed; update better-unraid-mcp (or run npm run schema:update in a checkout).`,
  };
}

async function checkSsh(shell: ShellExecutor | null): Promise<DoctorCheck> {
  if (!shell) {
    return {
      check: "ssh",
      status: "warn",
      detail:
        "SSH: not configured (optional). Host tools (shell_exec, file_read, docker_stats, mover_action, system_power) are unavailable; set UNRAID_SSH_* to enable them.",
    };
  }
  try {
    const result = await shell.execute(SSH_PROBE_COMMAND, SSH_PROBE_TIMEOUT_MS);
    if (result.exitCode === 0) {
      return { check: "ssh", status: "ok", detail: "SSH: connected." };
    }
    return { check: "ssh", status: "fail", detail: `SSH: failed (exit ${result.exitCode}).` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { check: "ssh", status: "fail", detail: `SSH: failed — ${message}` };
  }
}

/** Static configuration facts worth surfacing in a health report. */
function configChecks(readOnly: boolean): DoctorCheck[] {
  return [
    {
      check: "rate-limit",
      status: "ok",
      detail: `Client-side rate limiting active: ${BUCKET_CAPACITY} request burst, ${REFILL_PER_SECOND}/s refill.`,
    },
    {
      check: "read-only",
      status: "ok",
      detail: readOnly
        ? "read-only mode: enabled — mutating tools are hidden from the listing."
        : "read-only mode: disabled — mutating tools are registered (each behind its confirm gate).",
    },
  ];
}

function summarize(checks: DoctorCheck[]): string {
  const marks: Record<DoctorCheck["status"], string> = { ok: "✓", warn: "⚠", fail: "✗" };
  return checks.map((check) => `${marks[check.status]} ${check.detail}`).join("\n");
}

/**
 * Creates the `connection_doctor` handler bound to its dependencies.
 *
 * @param deps - GraphQL executor, optional shell executor, read-only flag.
 * @returns An MCP handler that self-tests the server's connectivity.
 * @example
 * const handler = createConnectionDoctorHandler({ client, shell, readOnly: false });
 * await handler({ response_format: "concise" });
 */
/**
 * Runs every doctor check, reused by the tool and the unraid://doctor resource.
 *
 * @param deps - GraphQL executor, optional shell executor, read-only flag.
 * @returns The full check list (individual check failures become failed checks).
 */
export async function runConnectionDoctor(deps: DoctorDeps): Promise<{ checks: DoctorCheck[] }> {
  const graphql = await checkGraphql(deps.client);
  return {
    checks: [
      graphql.check,
      compareApiVersions(graphql.apiVersion, deps.schemaApiVersion),
      await checkSsh(deps.shell),
      ...configChecks(deps.readOnly),
    ],
  };
}

export function createConnectionDoctorHandler(deps: DoctorDeps) {
  return async (input: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { checks } = await runConnectionDoctor(deps);
      return formatResponse(input.response_format, summarize(checks), { checks });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`connection_doctor failed unexpectedly: ${message}`);
    }
  };
}

/**
 * Registers the read-only `connection_doctor` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param deps - The executors and mode the doctor inspects.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerConnectionDoctor(server: McpServer, deps: DoctorDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Connection Doctor",
      description:
        "Read-only self-test of this MCP server's plumbing: Unraid GraphQL endpoint reachability and latency, API key validity, server and API versions, schema skew between the vendored Unraid schema and the server's API version, optional SSH channel connectivity, client-side rate-limit configuration, and read-only mode. Safe to run anytime; run it first when any other tool misbehaves.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createConnectionDoctorHandler(deps),
  );
}
