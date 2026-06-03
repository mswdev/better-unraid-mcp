import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { VmListQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createVmListHandler } from "./vm-list.js";

const data = {
  vms: {
    domains: [
      { id: "srv:win11", name: "Windows 11", state: "RUNNING" },
      { id: "srv:ubuntu", name: "Ubuntu Server", state: "SHUTOFF" },
      { id: "srv:nameless", name: null, state: "PAUSED" },
    ],
  },
} satisfies VmListQuery;

function fakeExecutor(result: VmListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("vm_list handler", () => {
  it("summarizes each VM by name and state", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/^Windows 11 — RUNNING$/m);
    expect(firstText(result)).toMatch(/^Ubuntu Server — SHUTOFF$/m);
  });

  it("renders a null-name VM as its id in parentheses", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/^\(srv:nameless\) — PAUSED$/m);
  });

  it("filters by case-insensitive name substring", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({
      response_format: "concise",
      name: "UBUNTU",
    });

    expect(firstText(result)).toMatch(/Ubuntu Server/);
    expect(firstText(result)).not.toMatch(/Windows 11/);
  });

  it("reports when there are no VMs", async () => {
    const result = await createVmListHandler(fakeExecutor({ vms: { domains: [] } }))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/No VMs found/);
  });

  it("treats null domains as empty (No VMs found)", async () => {
    const result = await createVmListHandler(fakeExecutor({ vms: { domains: null } }))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/No VMs found/);
  });

  it("returns the full domains array in detailed format", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({ response_format: "detailed" });

    expect(JSON.parse(firstText(result))).toEqual(data.vms.domains);
  });

  it("returns an error result when the client throws (e.g. VM service disabled)", async () => {
    const result = await createVmListHandler(
      throwingExecutor("Failed to retrieve VM domains: VMs are not available"),
    )({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch VMs/);
    expect(firstText(result)).toMatch(/VMs are not available/);
  });

  it("coerces a non-Error rejection into the error message", async () => {
    const result = await createVmListHandler(rejectingExecutor("boom-string"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom-string/);
  });
});
