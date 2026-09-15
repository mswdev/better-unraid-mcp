import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * How long the human gets to answer a confirmation prompt. Deliberately far
 * above the SDK's 60 s default — people read blast-radius warnings slowly.
 */
export const ELICITATION_TIMEOUT_MS = 300_000;

/** What a gate asks the human. */
export interface ElicitationPrompt {
  message: string;
  requireRiskAcknowledgement: boolean;
}

/** The human's answer, or the channel admitting it could not ask. */
export type ElicitationOutcome = "accepted" | "declined" | "unavailable";

/** Seam the gates use to ask the human interactively; faked in tests. */
export interface ElicitationChannel {
  isAvailable(): boolean;
  confirm(prompt: ElicitationPrompt): Promise<ElicitationOutcome>;
}

/** One boolean form field in the elicitation's requested schema. */
interface BooleanField {
  type: "boolean";
  title: string;
  description: string;
}

/** The boolean fields a confirmation form requests. */
function confirmationSchema(requireRisk: boolean) {
  const properties: Record<string, BooleanField> = {
    confirm: {
      type: "boolean",
      title: "Confirm",
      description: "Set to true to proceed with this action.",
    },
  };
  if (requireRisk) {
    properties.acknowledge_risk = {
      type: "boolean",
      title: "Acknowledge risk",
      description: "Set to true to acknowledge the risk described above.",
    };
  }
  return {
    type: "object" as const,
    properties,
    required: Object.keys(properties),
  };
}

/** True when the accepted form answered every requested boolean with true. */
function allConfirmed(content: Record<string, unknown> | undefined, requireRisk: boolean): boolean {
  if (!content || content.confirm !== true) {
    return false;
  }
  return !requireRisk || content.acknowledge_risk === true;
}

/**
 * Builds the real elicitation channel bound to an MCP server. Availability
 * follows the connected client's declared capabilities; a failed elicitation
 * request (unsupported transport, protocol error) reports "unavailable" so
 * gates fall back to the argument path instead of failing the tool.
 *
 * @param server - The McpServer whose client connection is asked.
 * @returns A channel the interactive gates can query.
 */
export function createElicitationChannel(server: McpServer): ElicitationChannel {
  return {
    isAvailable: () => server.server.getClientCapabilities()?.elicitation !== undefined,
    confirm: async (prompt) => {
      try {
        const result = await server.server.elicitInput(
          {
            message: prompt.message,
            requestedSchema: confirmationSchema(prompt.requireRiskAcknowledgement),
          },
          { timeout: ELICITATION_TIMEOUT_MS },
        );
        if (result.action !== "accept") {
          return "declined";
        }
        return allConfirmed(
          result.content as Record<string, unknown> | undefined,
          prompt.requireRiskAcknowledgement,
        )
          ? "accepted"
          : "declined";
      } catch {
        return "unavailable";
      }
    },
  };
}
