import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerPortConflictsQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
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
  it("summarizes the conflict counts", async () => {
    const result = await createDockerPortConflictsHandler(fakeExecutor(data))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/conflict/i);
    expect(firstText(result)).toMatch(/1 container-port/);
    expect(firstText(result)).toMatch(/1 LAN-port/);
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
