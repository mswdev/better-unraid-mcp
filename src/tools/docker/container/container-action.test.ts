import { describe, expect, it } from "vitest";
import {
  DockerPauseDocument,
  type DockerPauseMutation,
  DockerStartDocument,
  type DockerStartMutation,
  DockerStopDocument,
  type DockerStopMutation,
  DockerUnpauseDocument,
  type DockerUnpauseMutation,
} from "../../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  sequencedExecutor,
  throwingExecutor,
} from "../../_shared/test-support.js";
import { createDockerContainerActionHandler } from "./container-action.js";

// Per-action fixtures are typed `satisfies <Op>Mutation` so codegen/selection
// drift (a renamed field or changed ContainerState member) breaks the build.
const cases = [
  {
    action: "start",
    document: DockerStartDocument,
    verb: /Started/,
    result: {
      docker: { start: { id: "srv:abc", names: ["/plex"], state: "RUNNING", status: "Up" } },
    } satisfies DockerStartMutation,
  },
  {
    action: "stop",
    document: DockerStopDocument,
    verb: /Stopped/,
    result: {
      docker: { stop: { id: "srv:abc", names: ["/plex"], state: "EXITED", status: "Exited" } },
    } satisfies DockerStopMutation,
  },
  {
    action: "pause",
    document: DockerPauseDocument,
    verb: /Paused/,
    result: {
      docker: { pause: { id: "srv:abc", names: ["/plex"], state: "PAUSED", status: "Paused" } },
    } satisfies DockerPauseMutation,
  },
  {
    action: "unpause",
    document: DockerUnpauseDocument,
    verb: /Unpaused/,
    result: {
      docker: { unpause: { id: "srv:abc", names: ["/plex"], state: "RUNNING", status: "Up" } },
    } satisfies DockerUnpauseMutation,
  },
] as const;

describe("docker_container_action handler", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor({});
    const result = await createDockerContainerActionHandler(executor)({
      id: "srv:abc",
      action: "stop",
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0); // gate short-circuits BEFORE execute
  });

  for (const c of cases) {
    it(`dispatches ${c.action} to its mutation document and reports past-tense`, async () => {
      const { executor, calls } = recordingExecutor(c.result);

      const result = await createDockerContainerActionHandler(executor)({
        id: "srv:abc",
        action: c.action,
        confirm: true,
        response_format: "concise",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].document).toBe(c.document);
      expect(calls[0].variables).toEqual({ id: "srv:abc" });
      expect(firstText(result)).toMatch(c.verb);
      expect(firstText(result)).toMatch(/plex/);
    });
  }

  it("returns an error result when the mutation throws (after the gate passes)", async () => {
    const result = await createDockerContainerActionHandler(throwingExecutor("daemon down"))({
      id: "srv:abc",
      action: "stop",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to stop container srv:abc/);
    expect(firstText(result)).toMatch(/daemon down/);
  });
});

describe("docker_container_action restart", () => {
  const containerFixture = { id: "srv:abc", names: ["/plex"], state: "RUNNING", status: "Up" };
  const stopResult = { docker: { stop: containerFixture } };
  const startResult = { docker: { start: containerFixture } };

  it("dispatches stop then start", async () => {
    const { executor, calls } = sequencedExecutor([stopResult, startResult]);
    const handler = createDockerContainerActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      id: "srv:abc",
      action: "restart",
      confirm: true,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].document).toBe(DockerStopDocument);
    expect(calls[1].document).toBe(DockerStartDocument);
    expect(firstText(result)).toContain("Restarted");
  });

  it("tolerates the stop read-back quirk and still starts", async () => {
    const { executor, calls } = sequencedExecutor([
      new Error("Container abc not found after stopping"),
      startResult,
    ]);
    const handler = createDockerContainerActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      id: "srv:abc",
      action: "restart",
      confirm: true,
    });

    expect(calls).toHaveLength(2);
    expect(result.isError).toBeUndefined();
  });

  it("aborts before start when stop genuinely fails", async () => {
    const { executor, calls } = sequencedExecutor([new Error("permission denied")]);
    const handler = createDockerContainerActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      id: "srv:abc",
      action: "restart",
      confirm: true,
    });

    expect(calls).toHaveLength(1);
    expect(result.isError).toBe(true);
  });

  it("refuses without confirm and touches nothing", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createDockerContainerActionHandler(executor);

    const result = await handler({ response_format: "concise", id: "srv:abc", action: "restart" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("docker_container_action read-back quirk", () => {
  it("reports issued-but-unverified instead of failure on 'not found after' errors", async () => {
    const handler = createDockerContainerActionHandler(
      throwingExecutor("Container Dozzle not found after stopping"),
    );

    const result = await handler({
      response_format: "concise",
      id: "Dozzle",
      action: "stop",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/very likely succeeded/);
    expect(firstText(result)).toMatch(/docker_container_list/);
  });
});

describe("docker_container_action elicitation", () => {
  const startResult = {
    docker: { start: { id: "srv:abc", names: ["/plex"], state: "RUNNING", status: "Up" } },
  };

  function scriptedChannel(outcome: "accepted" | "declined") {
    return {
      isAvailable: () => true,
      confirm: async () => outcome,
    };
  }

  it("runs the action when the human accepts the prompt", async () => {
    const { executor, calls } = recordingExecutor(startResult);
    const handler = createDockerContainerActionHandler(executor, scriptedChannel("accepted"));

    const result = await handler({ response_format: "concise", id: "srv:abc", action: "start" });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("runs nothing when the human declines", async () => {
    const { executor, calls } = recordingExecutor(startResult);
    const handler = createDockerContainerActionHandler(executor, scriptedChannel("declined"));

    const result = await handler({ response_format: "concise", id: "srv:abc", action: "start" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
