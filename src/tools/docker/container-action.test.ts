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
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
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
