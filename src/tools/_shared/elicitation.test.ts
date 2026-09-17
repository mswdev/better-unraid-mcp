import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { ELICITATION_TIMEOUT_MS, createElicitationChannel } from "./elicitation.js";

interface RecordedElicit {
  params: {
    message: string;
    requestedSchema: { properties: Record<string, unknown>; required?: string[] };
  };
  options?: { timeout?: number };
}

function fakeMcpServer(config: {
  capabilities?: Record<string, unknown>;
  result?: { action: string; content?: Record<string, unknown> };
  throwOnElicit?: boolean;
}) {
  const recorded: RecordedElicit[] = [];
  const server = {
    server: {
      getClientCapabilities: () => config.capabilities,
      elicitInput: async (params: RecordedElicit["params"], options?: { timeout?: number }) => {
        recorded.push({ params, options });
        if (config.throwOnElicit) {
          throw new Error("Method not found");
        }
        return config.result ?? { action: "cancel" };
      },
    },
  } as unknown as McpServer;
  return { server, recorded };
}

describe("createElicitationChannel availability", () => {
  it("is available when the client declares elicitation", () => {
    const { server } = fakeMcpServer({ capabilities: { elicitation: {} } });

    expect(createElicitationChannel(server).isAvailable()).toBe(true);
  });

  it("is unavailable without the capability", () => {
    const { server } = fakeMcpServer({ capabilities: {} });

    expect(createElicitationChannel(server).isAvailable()).toBe(false);
  });

  it("is unavailable when capabilities are unknown", () => {
    const { server } = fakeMcpServer({ capabilities: undefined });

    expect(createElicitationChannel(server).isAvailable()).toBe(false);
  });
});

describe("createElicitationChannel confirm", () => {
  const prompt = { message: "Stop the array?", requireRiskAcknowledgement: false };

  it("accepts when the user confirms", async () => {
    const { server, recorded } = fakeMcpServer({
      capabilities: { elicitation: {} },
      result: { action: "accept", content: { confirm: true } },
    });

    const outcome = await createElicitationChannel(server).confirm(prompt);

    expect(outcome).toBe("accepted");
    expect(recorded[0].params.message).toBe("Stop the array?");
    expect(recorded[0].params.requestedSchema.required).toContain("confirm");
    expect(recorded[0].options?.timeout).toBe(ELICITATION_TIMEOUT_MS);
  });

  it("requires both booleans for tier-2 prompts", async () => {
    const { server, recorded } = fakeMcpServer({
      capabilities: { elicitation: {} },
      result: { action: "accept", content: { confirm: true, acknowledge_risk: true } },
    });

    const outcome = await createElicitationChannel(server).confirm({
      message: "Reboot?",
      requireRiskAcknowledgement: true,
    });

    expect(outcome).toBe("accepted");
    expect(recorded[0].params.requestedSchema.required).toEqual(["confirm", "acknowledge_risk"]);
  });

  it("declines when an accepted form answers false", async () => {
    const { server } = fakeMcpServer({
      capabilities: { elicitation: {} },
      result: { action: "accept", content: { confirm: false } },
    });

    expect(await createElicitationChannel(server).confirm(prompt)).toBe("declined");
  });

  it("declines on explicit decline and on cancel", async () => {
    const declined = fakeMcpServer({
      capabilities: { elicitation: {} },
      result: { action: "decline" },
    });
    const cancelled = fakeMcpServer({
      capabilities: { elicitation: {} },
      result: { action: "cancel" },
    });

    expect(await createElicitationChannel(declined.server).confirm(prompt)).toBe("declined");
    expect(await createElicitationChannel(cancelled.server).confirm(prompt)).toBe("declined");
  });

  it("reports unavailable when the request itself fails", async () => {
    const { server } = fakeMcpServer({ capabilities: { elicitation: {} }, throwOnElicit: true });

    expect(await createElicitationChannel(server).confirm(prompt)).toBe("unavailable");
  });
});
