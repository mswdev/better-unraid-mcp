import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerAllTools } from "./registry.js";

interface Registration {
  name: string;
  hasConfig: boolean;
  hasHandler: boolean;
  annotations: unknown;
}

function fakeServer() {
  const registrations: Registration[] = [];
  return {
    registrations,
    server: {
      registerTool: (name: string, config: { annotations?: unknown }, handler: unknown) => {
        registrations.push({
          name,
          hasConfig: typeof config === "object" && config !== null,
          hasHandler: typeof handler === "function",
          annotations: config?.annotations,
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

  it("registers vm_list as read-only", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const list = registrations.find((registration) => registration.name === "vm_list");
    expect(list?.hasHandler).toBe(true);
    expect(list?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("registers vm_action as destructive", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const action = registrations.find((registration) => registration.name === "vm_action");
    expect(action?.hasHandler).toBe(true);
    expect(action?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("registers array_action as destructive and not read-only", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const action = registrations.find((registration) => registration.name === "array_action");
    expect(action?.hasHandler).toBe(true);
    expect(action?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });
});
