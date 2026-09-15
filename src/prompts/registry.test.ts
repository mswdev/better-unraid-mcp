import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerAllPrompts } from "./registry.js";

interface RegisteredPrompt {
  name: string;
  config: { title?: string; description?: string; argsSchema?: unknown };
  callback: (args?: Record<string, string>) => Promise<{
    messages: Array<{ role: string; content: { type: string; text: string } }>;
  }>;
}

function fakeServer() {
  const prompts: RegisteredPrompt[] = [];
  const server = {
    registerPrompt: (
      name: string,
      config: RegisteredPrompt["config"],
      callback: RegisteredPrompt["callback"],
    ) => {
      prompts.push({ name, config, callback });
    },
  } as unknown as McpServer;
  return { server, prompts };
}

describe("registerAllPrompts", () => {
  it("registers the four guided workflows", () => {
    const { server, prompts } = fakeServer();

    registerAllPrompts(server);

    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "triage-array-problem",
      "find-resource-hog",
      "safe-container-update",
      "health-report",
    ]);
  });

  it("walks the triage workflow through the diagnostic tools", async () => {
    const { server, prompts } = fakeServer();
    registerAllPrompts(server);

    const result = await prompts[0].callback();
    const text = result.messages[0].content.text;

    for (const tool of [
      "system_health",
      "array_status",
      "disk_list",
      "notification_alerts",
      "parity_history",
    ]) {
      expect(text).toContain(tool);
    }
  });

  it("substitutes the container argument into safe-container-update", async () => {
    const { server, prompts } = fakeServer();
    registerAllPrompts(server);
    const prompt = prompts.find((entry) => entry.name === "safe-container-update");

    const result = await prompt?.callback({ container: "plex" });

    expect(result?.messages[0].content.text).toContain("target: plex");
  });

  it("notes when no container was specified", async () => {
    const { server, prompts } = fakeServer();
    registerAllPrompts(server);
    const prompt = prompts.find((entry) => entry.name === "safe-container-update");

    const result = await prompt?.callback({});

    expect(result?.messages[0].content.text).toContain("(not specified)");
  });
});
