import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerContainerLogsQuery } from "../../types/unraid/graphql.js";
import { firstText, throwingExecutor } from "../_shared/test-support.js";
import { createDockerContainerLogsHandler, sinceSchema } from "./container-logs.js";

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
  it("renders each log line and a paging hint when a cursor is present", async () => {
    const result = await createDockerContainerLogsHandler(fakeExecutor(data))({
      id: "srv:abc",
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/starting up/);
    expect(firstText(result)).toMatch(/ready/);
    expect(firstText(result)).toMatch(/more available/);
    expect(firstText(result)).toMatch(/de-dupe/);
  });

  it("omits the paging hint when there are lines but no cursor", async () => {
    const noCursor = {
      docker: {
        logs: {
          containerId: "srv:abc",
          lines: [{ timestamp: "2026-06-01T00:00:00Z", message: "only line" }],
          cursor: null,
        },
      },
    } satisfies DockerContainerLogsQuery;
    const result = await createDockerContainerLogsHandler(fakeExecutor(noCursor))({
      id: "srv:abc",
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/only line/);
    expect(firstText(result)).not.toMatch(/more available/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createDockerContainerLogsHandler(throwingExecutor("no such container"))({
      id: "srv:abc",
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch logs for srv:abc/);
    expect(firstText(result)).toMatch(/no such container/);
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

  it("re-accepts a returned cursor as a valid `since` and rejects free text", () => {
    // The documented paging loop re-passes the returned `cursor` as `since`.
    expect(sinceSchema.safeParse(data.docker.logs.cursor).success).toBe(true);
    expect(sinceSchema.safeParse("yesterday").success).toBe(false);
  });
});
