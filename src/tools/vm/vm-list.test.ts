import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { VmListQuery } from "../../types/unraid/graphql.js";
import { VMS_UNAVAILABLE } from "../_shared/errors/require-service.js";
import { firstText, throwingExecutor } from "../_shared/test-support.js";
import { createVmListHandler } from "./vm-list.js";

/** A VM id as the API returns it: server prefix + libvirt domain uuid. */
const WINDOWS_ID = "srv:6f1c2b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b";

const data = {
  vms: {
    domains: [
      { id: WINDOWS_ID, name: "Windows 11", state: "RUNNING" },
      { id: "srv:ubuntu", name: "Ubuntu Server", state: "SHUTOFF" },
      { id: "srv:nameless", name: null, state: "PAUSED" },
    ],
  },
} satisfies VmListQuery;

function fakeExecutor(result: VmListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("vm_list handler", () => {
  it("summarizes each VM by name and state, ending with its full id", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({ response_format: "concise" });

    expect(firstText(result).split("\n")).toEqual([
      `Windows 11 — RUNNING [id: ${WINDOWS_ID}]`,
      "Ubuntu Server — SHUTOFF [id: srv:ubuntu]",
      "(unnamed) — PAUSED [id: srv:nameless]",
    ]);
  });

  it("renders a null-name VM as (unnamed), keeping its id in the tag", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/^\(unnamed\) — PAUSED \[id: srv:nameless\]$/m);
  });

  it("filters by case-insensitive name substring", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({
      response_format: "concise",
      name: "UBUNTU",
    });

    expect(firstText(result)).toMatch(/Ubuntu Server/);
    expect(firstText(result)).not.toMatch(/Windows 11/);
  });

  it("reports the filter when the name matches nothing (distinct from an empty host)", async () => {
    const result = await createVmListHandler(fakeExecutor(data))({
      response_format: "concise",
      name: "nonexistent",
    });

    expect(firstText(result)).toBe("No VMs match 'nonexistent'.");
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
});

describe("vm_list handler when the VM service is unavailable", () => {
  it("reports that the API returned no VM data", async () => {
    const handler = createVmListHandler(fakeExecutor({ vms: null }));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain(VMS_UNAVAILABLE);
  });
});
