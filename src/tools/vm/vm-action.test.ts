import { describe, expect, it } from "vitest";
import {
  VmForceStopDocument,
  type VmForceStopMutation,
  VmPauseDocument,
  type VmPauseMutation,
  VmRebootDocument,
  type VmRebootMutation,
  VmResetDocument,
  type VmResetMutation,
  VmResolveDocument,
  type VmResolveQuery,
  VmResumeDocument,
  type VmResumeMutation,
  VmStartDocument,
  type VmStartMutation,
  VmStopDocument,
  type VmStopMutation,
} from "../../types/unraid/graphql.js";
import { firstText, sequencedExecutor } from "../_shared/test-support.js";
import { createVmActionHandler, stripServerPrefix } from "./vm-action.js";

describe("stripServerPrefix", () => {
  it("strips a server-id prefix when there are exactly two colon parts", () => {
    expect(stripServerPrefix("srv:4dea22b3")).toBe("4dea22b3");
  });

  it("returns a bare id (no colon) unchanged", () => {
    expect(stripServerPrefix("4dea22b3")).toBe("4dea22b3");
  });

  it("recovers the id even when the server id is empty", () => {
    expect(stripServerPrefix(":4dea22b3")).toBe("4dea22b3");
  });

  it("leaves a value with more than two parts unchanged", () => {
    expect(stripServerPrefix("a:b:c")).toBe("a:b:c");
  });
});

const resolve = {
  vms: {
    domains: [
      { id: "srv:win11", name: "Windows 11" },
      { id: "srv:ubuntu", name: "Ubuntu Server" },
    ],
  },
} satisfies VmResolveQuery;

// One typed fixture per action so codegen/selection drift breaks the build.
const cases = [
  {
    action: "start",
    document: VmStartDocument,
    verb: /Started/,
    result: { vm: { start: true } } satisfies VmStartMutation,
    danger: false,
  },
  {
    action: "stop",
    document: VmStopDocument,
    verb: /Stopped/,
    result: { vm: { stop: true } } satisfies VmStopMutation,
    danger: false,
  },
  {
    action: "pause",
    document: VmPauseDocument,
    verb: /Paused/,
    result: { vm: { pause: true } } satisfies VmPauseMutation,
    danger: false,
  },
  {
    action: "resume",
    document: VmResumeDocument,
    verb: /Resumed/,
    result: { vm: { resume: true } } satisfies VmResumeMutation,
    danger: false,
  },
  {
    action: "reboot",
    document: VmRebootDocument,
    verb: /Rebooted/,
    result: { vm: { reboot: true } } satisfies VmRebootMutation,
    danger: false,
  },
  {
    action: "forceStop",
    document: VmForceStopDocument,
    verb: /Force-stopped/,
    result: { vm: { forceStop: true } } satisfies VmForceStopMutation,
    danger: true,
  },
  {
    action: "reset",
    document: VmResetDocument,
    verb: /Reset/,
    result: { vm: { reset: true } } satisfies VmResetMutation,
    danger: true,
  },
] as const;

describe("vm_action handler", () => {
  it("refuses a graceful action without confirm and never calls the executor", async () => {
    const { executor, calls } = sequencedExecutor([]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "stop",
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("refuses an ungraceful action with confirm but no acknowledge_risk", async () => {
    const { executor, calls } = sequencedExecutor([]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "forceStop",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/acknowledge_risk/);
    expect(calls).toHaveLength(0);
  });

  it("names both gates in the combined refusal for an ungraceful action with neither flag", async () => {
    const { executor } = sequencedExecutor([]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "reset",
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/);
    expect(firstText(result)).toMatch(/acknowledge_risk/);
  });

  for (const c of cases) {
    it(`dispatches ${c.action} to its mutation and reports completed past-tense`, async () => {
      const { executor, calls } = sequencedExecutor([resolve, c.result]);

      const result = await createVmActionHandler(executor)({
        vm: "Windows 11",
        action: c.action,
        confirm: true,
        acknowledge_risk: c.danger ? true : undefined,
        response_format: "concise",
      });

      expect(calls).toHaveLength(2);
      expect(calls[0].document).toBe(VmResolveDocument);
      expect(calls[1].document).toBe(c.document);
      expect(calls[1].variables).toEqual({ id: "srv:win11" });
      expect(firstText(result)).toMatch(c.verb);
      expect(firstText(result)).toMatch(/Windows 11/);
    });
  }

  it("matches a bare uuid against a prefixed read id and mutates with the prefixed id", async () => {
    const prefixed = {
      vms: { domains: [{ id: "srv:abc123", name: "Box" }] },
    } satisfies VmResolveQuery;
    const { executor, calls } = sequencedExecutor([
      prefixed,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    await createVmActionHandler(executor)({
      vm: "abc123",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(calls[1].variables).toEqual({ id: "srv:abc123" });
  });

  it("matches a prefixed input against a bare read id (empty server identifier)", async () => {
    const bare = { vms: { domains: [{ id: "abc123", name: "Box" }] } } satisfies VmResolveQuery;
    const { executor, calls } = sequencedExecutor([
      bare,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    await createVmActionHandler(executor)({
      vm: "srv:abc123",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(calls[1].variables).toEqual({ id: "abc123" });
  });

  it("prefers an id match over a colliding name match", async () => {
    // Domain A's NAME equals Domain B's ID. Input equal to B's id must resolve to B (id wins).
    const collide = {
      vms: {
        domains: [
          { id: "srv:aaa", name: "srv:bbb" },
          { id: "srv:bbb", name: "Bee" },
        ],
      },
    } satisfies VmResolveQuery;
    const { executor, calls } = sequencedExecutor([
      collide,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    await createVmActionHandler(executor)({
      vm: "srv:bbb",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(calls[1].variables).toEqual({ id: "srv:bbb" });
  });

  it("resolves a name case-insensitively", async () => {
    const { executor, calls } = sequencedExecutor([
      resolve,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    await createVmActionHandler(executor)({
      vm: "windows 11",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(calls[1].variables).toEqual({ id: "srv:win11" });
  });

  it("requires an exact name (a substring does not match) and never calls the mutation", async () => {
    const { executor, calls } = sequencedExecutor([resolve]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/No VM matches 'Windows'/);
    expect(calls).toHaveLength(1);
  });

  it("errors with no match and never calls the mutation", async () => {
    const { executor, calls } = sequencedExecutor([resolve]);

    const result = await createVmActionHandler(executor)({
      vm: "ghost",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/No VM matches 'ghost'/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(VmResolveDocument);
  });

  it("errors on duplicate name matches (defensive) and never calls the mutation", async () => {
    const dupes = {
      vms: {
        domains: [
          { id: "srv:a", name: "Clone" },
          { id: "srv:b", name: "Clone" },
        ],
      },
    } satisfies VmResolveQuery;
    const { executor, calls } = sequencedExecutor([dupes]);

    const result = await createVmActionHandler(executor)({
      vm: "Clone",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Multiple VMs named 'Clone'/);
    expect(firstText(result)).toMatch(/srv:a/);
    expect(calls).toHaveLength(1);
  });

  it("never matches a null-name VM by name (falls through to no match)", async () => {
    const nameless = {
      vms: { domains: [{ id: "srv:uuid", name: null }] },
    } satisfies VmResolveQuery;
    const { executor } = sequencedExecutor([nameless]);

    const result = await createVmActionHandler(executor)({
      vm: "ghost",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/No VM matches/);
  });

  it("reports a false mutation result with the defensive guard copy (not a success claim)", async () => {
    const { executor } = sequencedExecutor([
      resolve,
      { vm: { stop: false } } satisfies VmStopMutation,
    ]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "stop",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/returned false/);
    expect(firstText(result)).toMatch(/Run vm_list/);
    expect(firstText(result)).not.toMatch(/^Stopped VM/);
  });

  it("returns ok/action/id/name in detailed format", async () => {
    const { executor } = sequencedExecutor([
      resolve,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "start",
      confirm: true,
      response_format: "detailed",
    });

    expect(JSON.parse(firstText(result))).toEqual({
      ok: true,
      action: "start",
      id: "srv:win11",
      name: "Windows 11",
    });
  });

  it("labels a resolved null-name VM by its id in the concise summary", async () => {
    const nameless = {
      vms: { domains: [{ id: "srv:uuid", name: null }] },
    } satisfies VmResolveQuery;
    const { executor } = sequencedExecutor([
      nameless,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    const result = await createVmActionHandler(executor)({
      vm: "srv:uuid",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(firstText(result)).toBe("Started VM srv:uuid.");
  });

  it("returns name: null in detailed format for a resolved null-name VM", async () => {
    const nameless = {
      vms: { domains: [{ id: "srv:uuid", name: null }] },
    } satisfies VmResolveQuery;
    const { executor } = sequencedExecutor([
      nameless,
      { vm: { start: true } } satisfies VmStartMutation,
    ]);

    const result = await createVmActionHandler(executor)({
      vm: "srv:uuid",
      action: "start",
      confirm: true,
      response_format: "detailed",
    });

    expect(JSON.parse(firstText(result))).toEqual({
      ok: true,
      action: "start",
      id: "srv:uuid",
      name: null,
    });
  });

  it("returns an error result when the resolve read throws", async () => {
    const { executor } = sequencedExecutor([new Error("VMs are not available")]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "stop",
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to stop VM Windows 11/);
    expect(firstText(result)).toMatch(/VMs are not available/);
  });

  it("returns an error result when the mutation throws after a successful resolve", async () => {
    const { executor, calls } = sequencedExecutor([resolve, new Error("Invalid state transition")]);

    const result = await createVmActionHandler(executor)({
      vm: "Windows 11",
      action: "start",
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(2);
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Invalid state transition/);
  });
});
