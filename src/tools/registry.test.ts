import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerAllTools } from "./registry.js";

function fakeServer() {
  const names: string[] = [];
  return {
    names,
    server: {
      registerTool: (name: string) => {
        names.push(name);
      },
    },
  };
}

const noopClient: GraphQLExecutor = { execute: async () => ({}) as never };

describe("registerAllTools", () => {
  it("registers get_system_info", () => {
    const { server, names } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    expect(names).toContain("get_system_info");
  });
});
