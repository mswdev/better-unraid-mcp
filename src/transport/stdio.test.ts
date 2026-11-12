import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { startStdio } from "./stdio.js";

describe("startStdio", () => {
  it("connects the server over a stdio transport and logs readiness", async () => {
    const connected: unknown[] = [];
    const infos: string[] = [];
    // The fake never starts the transport, so process stdin/stdout are not touched.
    const server = {
      connect: async (transport: unknown) => {
        connected.push(transport);
      },
    } as unknown as McpServer;
    const logger = { info: (message: string) => infos.push(message) } as unknown as Logger;

    await startStdio(server, logger);

    expect(connected).toHaveLength(1);
    expect(connected[0]).toBeInstanceOf(StdioServerTransport);
    expect(infos).toEqual(["better-unraid-mcp ready (stdio transport)"]);
  });
});
