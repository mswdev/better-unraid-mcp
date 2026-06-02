import { describe, expect, it } from "vitest";
import { DockerUpdateContainersDocument } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createDockerContainerUpdateHandler } from "./container-update.js";

describe("docker_container_update handler", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor({ docker: { updateContainers: [] } });

    const result = await createDockerContainerUpdateHandler(executor)({
      ids: ["srv:abc"],
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0); // gate short-circuits BEFORE execute
  });

  it("rejects providing both ids and all without calling the executor", async () => {
    const { executor, calls } = recordingExecutor({ docker: { updateContainers: [] } });

    const result = await createDockerContainerUpdateHandler(executor)({
      ids: ["srv:abc"],
      all: true,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/either|provide/i);
    expect(calls).toHaveLength(0); // validated BEFORE execute
  });

  it("rejects providing neither ids nor all without calling the executor", async () => {
    const { executor, calls } = recordingExecutor({ docker: { updateContainers: [] } });

    const result = await createDockerContainerUpdateHandler(executor)({
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/either|provide/i);
    expect(calls).toHaveLength(0); // validated BEFORE execute
  });

  it("dispatches ids to the update-containers mutation and reports a requested update", async () => {
    const { executor, calls } = recordingExecutor({
      docker: {
        updateContainers: [
          {
            id: "srv:abc",
            names: ["/plex"],
            state: "RUNNING",
            status: "Up",
            isUpdateAvailable: false,
          },
        ],
      },
    });

    const result = await createDockerContainerUpdateHandler(executor)({
      ids: ["srv:abc"],
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(DockerUpdateContainersDocument);
    expect(calls[0].variables).toEqual({ ids: ["srv:abc"] });
    expect(firstText(result)).toMatch(/Update requested/i);
    expect(firstText(result)).toMatch(/plex/);
  });

  it("reports an empty update-all result as success, not an error", async () => {
    const { executor } = recordingExecutor({ docker: { updateAllContainers: [] } });

    const result = await createDockerContainerUpdateHandler(executor)({
      all: true,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/No containers had an available update/);
  });
});
