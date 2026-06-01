import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerAllTools } from "./registry.js";

interface Registration {
  name: string;
  hasConfig: boolean;
  hasHandler: boolean;
}

function fakeServer() {
  const registrations: Registration[] = [];
  return {
    registrations,
    server: {
      registerTool: (name: string, config: unknown, handler: unknown) => {
        registrations.push({
          name,
          hasConfig: typeof config === "object" && config !== null,
          hasHandler: typeof handler === "function",
        });
      },
    },
  };
}

const noopClient: GraphQLExecutor = { execute: async () => ({}) as never };

describe("registerAllTools", () => {
  it("registers system_info with a config and handler", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const info = registrations.find((registration) => registration.name === "system_info");
    expect(info).toBeDefined();
    expect(info?.hasConfig).toBe(true);
    expect(info?.hasHandler).toBe(true);
  });
});
