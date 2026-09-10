import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerContainerListQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createDockerContainerListHandler } from "./container-list.js";

const data = {
  docker: {
    containers: [
      {
        id: "srv:abc",
        names: ["/plex"],
        image: "linuxserver/plex",
        state: "RUNNING",
        status: "Up 2 days",
        autoStart: true,
        isUpdateAvailable: true,
      },
      {
        id: "srv:def",
        names: ["/sonarr"],
        image: "linuxserver/sonarr",
        state: "EXITED",
        status: "Exited (0)",
        autoStart: false,
        isUpdateAvailable: false,
      },
    ],
  },
} satisfies DockerContainerListQuery;

function fakeExecutor(result: DockerContainerListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("docker_container_list handler", () => {
  it("summarizes each container by stripped name, state and image", async () => {
    const result = await createDockerContainerListHandler(fakeExecutor(data))({
      response_format: "concise",
    });

    // Name is slash-stripped: the container's line starts with "plex", not "/plex".
    // (A bare /\/plex/ would wrongly match the image "linuxserver/plex" too.)
    expect(firstText(result)).toMatch(/^plex /m);
    expect(firstText(result)).not.toMatch(/^\/plex/m);
    expect(firstText(result)).toMatch(/RUNNING/);
    expect(firstText(result)).toMatch(/linuxserver\/plex/);
    expect(firstText(result)).toMatch(/update available/i);
  });

  it("filters by case-insensitive name substring on the stripped name", async () => {
    const result = await createDockerContainerListHandler(fakeExecutor(data))({
      response_format: "concise",
      name: "SON",
    });

    expect(firstText(result)).toMatch(/sonarr/);
    expect(firstText(result)).not.toMatch(/plex/);
  });

  it("reports when there are no containers", async () => {
    const result = await createDockerContainerListHandler(
      fakeExecutor({ docker: { containers: [] } }),
    )({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No Docker containers/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createDockerContainerListHandler(throwingExecutor("unauthorized"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch Docker containers/);
    expect(firstText(result)).toMatch(/unauthorized/);
  });

  it("coerces a non-Error rejection into the error message", async () => {
    const result = await createDockerContainerListHandler(rejectingExecutor("boom-string"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom-string/);
  });
});
