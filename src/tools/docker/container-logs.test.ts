import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerContainerLogsQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createDockerContainerLogsHandler } from "./container-logs.js";

const data = {
  docker: {
    logs: {
      containerId: "srv:abc",
      lines: [
        { timestamp: "2026-06-01T00:00:00Z", message: "starting up" },
        { timestamp: "2026-06-01T00:00:01Z", message: "ready" },
      ],
      cursor: "2026-06-01T00:00:01Z",
    },
  },
} satisfies DockerContainerLogsQuery;

function fakeExecutor(result: DockerContainerLogsQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("docker_container_logs handler", () => {
  it("renders each log line", async () => {
    const result = await createDockerContainerLogsHandler(fakeExecutor(data))({
      id: "srv:abc",
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/starting up/);
    expect(firstText(result)).toMatch(/ready/);
  });

  it("reports when there are no log lines", async () => {
    const empty = {
      docker: { logs: { containerId: "srv:abc", lines: [], cursor: null } },
    } satisfies DockerContainerLogsQuery;
    const result = await createDockerContainerLogsHandler(fakeExecutor(empty))({
      id: "srv:abc",
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/No log lines/);
  });
});
