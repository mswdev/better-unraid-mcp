import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerContainerLogsQuery } from "../../types/unraid/graphql.js";
import { firstText, recordingShell, throwingExecutor } from "../_shared/test-support.js";
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
    const result = await createDockerContainerLogsHandler(
      fakeExecutor(data),
      null,
    )({
      id: "srv:abc",
      response_format: "concise",
      tail: 200,
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
    const result = await createDockerContainerLogsHandler(
      fakeExecutor(noCursor),
      null,
    )({
      id: "srv:abc",
      response_format: "concise",
      tail: 200,
    });

    expect(firstText(result)).toMatch(/only line/);
    expect(firstText(result)).not.toMatch(/more available/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createDockerContainerLogsHandler(
      throwingExecutor("no such container"),
      null,
    )({
      id: "srv:abc",
      response_format: "concise",
      tail: 200,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch logs for srv:abc/);
    expect(firstText(result)).toMatch(/no such container/);
  });

  it("reports when there are no log lines", async () => {
    const empty = {
      docker: { logs: { containerId: "srv:abc", lines: [], cursor: null } },
    } satisfies DockerContainerLogsQuery;
    const result = await createDockerContainerLogsHandler(
      fakeExecutor(empty),
      null,
    )({
      id: "srv:abc",
      response_format: "concise",
      tail: 200,
    });

    expect(firstText(result)).toMatch(/No log lines/);
  });

  it("re-accepts a returned cursor as a valid `since` and rejects free text", () => {
    // The documented paging loop re-passes the returned `cursor` as `since`.
    expect(sinceSchema.safeParse(data.docker.logs.cursor).success).toBe(true);
    expect(sinceSchema.safeParse("yesterday").success).toBe(false);
  });
});

describe("docker_container_logs SSH fallback", () => {
  const empty = {
    docker: { logs: { containerId: "srv:abc", lines: [], cursor: null } },
  } satisfies DockerContainerLogsQuery;

  it("falls back to docker logs over SSH when the API returns no lines", async () => {
    const { shell, calls } = recordingShell({
      stdout: "2026-09-10T00:00:00Z Dozzle starting\n",
      stderr: "",
      exitCode: 0,
    });
    const result = await createDockerContainerLogsHandler(
      fakeExecutor(empty),
      shell,
    )({
      id: "Dozzle",
      response_format: "concise",
      tail: 50,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Dozzle starting/);
    expect(firstText(result)).toMatch(/docker logs over SSH/);
    expect(calls[0]?.command).toBe("docker logs --timestamps --tail 50 'Dozzle' 2>&1");
  });

  it("passes since through to the fallback command", async () => {
    const { shell, calls } = recordingShell({ stdout: "line\n", stderr: "", exitCode: 0 });
    await createDockerContainerLogsHandler(
      fakeExecutor(empty),
      shell,
    )({
      id: "Dozzle",
      response_format: "concise",
      tail: 10,
      since: "2026-09-10T00:00:00Z",
    });

    expect(calls[0]?.command).toBe(
      "docker logs --timestamps --tail 10 --since '2026-09-10T00:00:00Z' 'Dozzle' 2>&1",
    );
  });

  it("keeps the no-lines message when the fallback also returns nothing", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 0 });
    const result = await createDockerContainerLogsHandler(
      fakeExecutor(empty),
      shell,
    )({
      id: "Dozzle",
      response_format: "concise",
      tail: 50,
    });

    expect(firstText(result)).toMatch(/No log lines/);
  });

  it("keeps the no-lines message when the fallback command fails", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "no such container", exitCode: 1 });
    const result = await createDockerContainerLogsHandler(
      fakeExecutor(empty),
      shell,
    )({
      id: "Dozzle",
      response_format: "concise",
      tail: 50,
    });

    expect(firstText(result)).toMatch(/No log lines/);
  });

  it("never invokes the shell when the API returned lines", async () => {
    const { shell, calls } = recordingShell({ stdout: "x", stderr: "", exitCode: 0 });
    await createDockerContainerLogsHandler(
      fakeExecutor(data),
      shell,
    )({
      id: "srv:abc",
      response_format: "concise",
      tail: 200,
    });

    expect(calls).toHaveLength(0);
  });
});
