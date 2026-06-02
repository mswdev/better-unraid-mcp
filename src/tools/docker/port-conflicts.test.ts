import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerPortConflictsQuery } from "../../types/unraid/graphql.js";
import { firstText, throwingExecutor } from "../_shared/test-support.js";
import { createDockerPortConflictsHandler } from "./port-conflicts.js";

const data = {
  docker: {
    portConflicts: {
      containerPorts: [
        {
          privatePort: 8080,
          type: "TCP",
          containers: [
            { id: "srv:abc", name: "/plex" },
            { id: "srv:def", name: "/sonarr" },
          ],
        },
      ],
      lanPorts: [
        {
          lanIpPort: "192.168.1.10:443",
          publicPort: 443,
          type: "TCP",
          containers: [{ id: "srv:ghi", name: "/nginx" }],
        },
      ],
    },
  },
} satisfies DockerPortConflictsQuery;

function fakeExecutor(result: DockerPortConflictsQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("docker_port_conflicts handler", () => {
  it("names the offending ports and slash-stripped containers", async () => {
    const result = await createDockerPortConflictsHandler(fakeExecutor(data))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/conflict/i);
    expect(firstText(result)).toMatch(/8080\/TCP/);
    expect(firstText(result)).toMatch(/plex/);
    expect(firstText(result)).toMatch(/sonarr/);
    expect(firstText(result)).toMatch(/192\.168\.1\.10:443/);
    expect(firstText(result)).toMatch(/nginx/);
    // container names are slash-stripped for display.
    expect(firstText(result)).not.toMatch(/\/plex/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createDockerPortConflictsHandler(throwingExecutor("unauthorized"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch Docker port conflicts/);
  });

  it("reports when there are no port conflicts", async () => {
    const empty = {
      docker: { portConflicts: { containerPorts: [], lanPorts: [] } },
    } satisfies DockerPortConflictsQuery;

    const result = await createDockerPortConflictsHandler(fakeExecutor(empty))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/No port conflicts\./);
  });
});
