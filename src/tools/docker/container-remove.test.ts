import { describe, expect, it } from "vitest";
import { DockerRemoveContainerDocument } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createDockerContainerRemoveHandler } from "./container-remove.js";

describe("docker_container_remove handler", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor({ docker: { removeContainer: true } });

    const result = await createDockerContainerRemoveHandler(executor)({
      id: "srv:abc",
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0); // gate short-circuits BEFORE execute
  });

  it("removes the container and dispatches the mutation with withImage undefined", async () => {
    const { executor, calls } = recordingExecutor({ docker: { removeContainer: true } });

    const result = await createDockerContainerRemoveHandler(executor)({
      id: "srv:abc",
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(DockerRemoveContainerDocument);
    expect(calls[0].variables).toEqual({ id: "srv:abc", withImage: undefined });
    expect(firstText(result)).toMatch(/Removed/);
    expect(result.isError).toBeUndefined();
  });

  it("notes a best-effort image removal attempt without claiming the image was deleted", async () => {
    const { executor, calls } = recordingExecutor({ docker: { removeContainer: true } });

    const result = await createDockerContainerRemoveHandler(executor)({
      id: "srv:abc",
      with_image: true,
      confirm: true,
      response_format: "concise",
    });

    expect(calls[0].variables).toEqual({ id: "srv:abc", withImage: true });
    expect(firstText(result)).toMatch(/Image removal attempted/);
    expect(firstText(result)).not.toMatch(/image deleted|deleted the image/i);
  });

  it("reports a success result of false as not removed (not an error)", async () => {
    const { executor } = recordingExecutor({ docker: { removeContainer: false } });

    const result = await createDockerContainerRemoveHandler(executor)({
      id: "srv:abc",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/not removed/);
  });
});
