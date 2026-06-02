import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerNetworkListQuery } from "../../types/unraid/graphql.js";
import { firstText, throwingExecutor } from "../_shared/test-support.js";
import { createDockerNetworkListHandler } from "./network-list.js";

const data = {
  docker: {
    networks: [
      {
        id: "srv:net1",
        name: "br0",
        driver: "macvlan",
        scope: "local",
        enableIPv6: true,
        internal: false,
        attachable: true,
      },
      {
        id: "srv:net2",
        name: "bridge",
        driver: "bridge",
        scope: "local",
        enableIPv6: false,
        internal: true,
        attachable: false,
      },
    ],
  },
} satisfies DockerNetworkListQuery;

function fakeExecutor(result: DockerNetworkListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("docker_network_list handler", () => {
  it("summarizes each network by name, driver and scope", async () => {
    const result = await createDockerNetworkListHandler(fakeExecutor(data))({
      response_format: "concise",
    });

    // Each network gets its own line: name + driver are both present.
    expect(firstText(result)).toMatch(/^br0 .*macvlan/m);
    expect(firstText(result)).toMatch(/^bridge .*bridge/m);
    expect(firstText(result)).toMatch(/local/);
  });

  it("appends an IPv6 marker only to IPv6-enabled networks", async () => {
    const result = await createDockerNetworkListHandler(fakeExecutor(data))({
      response_format: "concise",
    });

    // Line-anchored so the v6 network's marker does not leak onto the other line.
    expect(firstText(result)).toMatch(/^br0 .*IPv6/m);
    expect(firstText(result)).not.toMatch(/^bridge .*IPv6/m);
  });

  it("appends an internal marker only to internal networks", async () => {
    const result = await createDockerNetworkListHandler(fakeExecutor(data))({
      response_format: "concise",
    });

    // bridge is internal:true, br0 is internal:false — line-anchored to avoid leakage.
    expect(firstText(result)).toMatch(/^bridge .*internal/m);
    expect(firstText(result)).not.toMatch(/^br0 .*internal/m);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createDockerNetworkListHandler(throwingExecutor("unauthorized"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch Docker networks/);
  });

  it("reports when there are no networks", async () => {
    const result = await createDockerNetworkListHandler(fakeExecutor({ docker: { networks: [] } }))(
      { response_format: "concise" },
    );

    expect(firstText(result)).toMatch(/No Docker networks/);
  });
});
