import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { recordingExecutor } from "../tools/_shared/test-support.js";
import type { ConnectionDoctorQuery } from "../types/unraid/graphql.js";
import { registerAllResources } from "./registry.js";
import { loadSchemaSdl } from "./schema-sdl.js";

interface RegisteredResource {
  name: string;
  uri: string;
  metadata: { mimeType?: string };
  read: () => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>;
}

function fakeServer() {
  const resources: RegisteredResource[] = [];
  const server = {
    registerResource: (
      name: string,
      uri: string,
      metadata: { mimeType?: string },
      read: RegisteredResource["read"],
    ) => {
      resources.push({ name, uri, metadata, read });
    },
  } as unknown as McpServer;
  return { server, resources };
}

const doctorFixture = {
  online: true,
  info: { versions: { core: { unraid: "7.0.1", api: "4.35.0" } } },
} satisfies ConnectionDoctorQuery;

describe("loadSchemaSdl", () => {
  it("loads the vendored SDL from a candidate path", () => {
    const sdl = loadSchemaSdl();

    expect(sdl).toContain("type Query");
  });

  it("throws a descriptive error when no candidate exists", () => {
    expect(() =>
      loadSchemaSdl(() => {
        throw new Error("ENOENT");
      }),
    ).toThrow(/not found/);
  });
});

describe("registerAllResources", () => {
  it("registers the four unraid:// resources", () => {
    const { server, resources } = fakeServer();
    const { executor } = recordingExecutor(doctorFixture);

    registerAllResources(server, {
      client: executor,
      shell: null,
      readOnly: false,
      schemaApiVersion: null,
    });

    expect(resources.map((resource) => resource.uri)).toEqual([
      "unraid://schema",
      "unraid://health",
      "unraid://doctor",
      "unraid://live/history",
    ]);
  });

  it("serves the SDL with a graphql mime type", async () => {
    const { server, resources } = fakeServer();
    const { executor } = recordingExecutor(doctorFixture);
    registerAllResources(server, {
      client: executor,
      shell: null,
      readOnly: false,
      schemaApiVersion: null,
    });

    const result = await resources[0].read();

    expect(result.contents[0].mimeType).toBe("application/graphql");
    expect(result.contents[0].text).toContain("type Query");
  });

  it("serves the doctor checks as JSON", async () => {
    const { server, resources } = fakeServer();
    const { executor } = recordingExecutor(doctorFixture);
    registerAllResources(server, {
      client: executor,
      shell: null,
      readOnly: true,
      schemaApiVersion: null,
    });

    const result = await resources[2].read();
    const parsed = JSON.parse(result.contents[0].text) as { checks: Array<{ check: string }> };

    expect(parsed.checks.length).toBeGreaterThanOrEqual(4);
  });
});
