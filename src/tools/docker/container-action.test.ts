import { describe, expect, it } from "vitest";
import {
  DockerPauseDocument,
  DockerStartDocument,
  DockerStopDocument,
  DockerUnpauseDocument,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createDockerContainerActionHandler } from "./container-action.js";

const cases = [
  { action: "start", document: DockerStartDocument, field: "start", verb: /Started/ },
  { action: "stop", document: DockerStopDocument, field: "stop", verb: /Stopped/ },
  { action: "pause", document: DockerPauseDocument, field: "pause", verb: /Paused/ },
  { action: "unpause", document: DockerUnpauseDocument, field: "unpause", verb: /Unpaused/ },
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
      const { executor, calls } = recordingExecutor({
        docker: { [c.field]: { id: "srv:abc", names: ["/plex"], state: "RUNNING", status: "Up" } },
      });

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
});
