import { describe, expect, it } from "vitest";
import {
  DockerAutostartStateDocument,
  type DockerAutostartStateQuery,
  DockerSetAutostartDocument,
  type DockerSetAutostartMutation,
} from "../../types/unraid/graphql.js";
import { firstText, sequencedExecutor } from "../_shared/test-support.js";
import { createDockerAutostartSetHandler } from "./autostart-set.js";

const state = {
  docker: {
    containers: [
      { id: "srv:db", names: ["/db"], autoStart: true, autoStartOrder: 0, autoStartWait: 10 },
      { id: "srv:app", names: ["/app"], autoStart: true, autoStartOrder: 1, autoStartWait: 0 },
      {
        id: "srv:idle",
        names: ["/idle"],
        autoStart: false,
        autoStartOrder: null,
        autoStartWait: null,
      },
    ],
  },
} satisfies DockerAutostartStateQuery;

const ok = { docker: { updateAutostartConfiguration: true } } satisfies DockerSetAutostartMutation;

describe("docker_autostart_set handler", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = sequencedExecutor([]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("merges one change into the full snapshot, preserving the others", async () => {
    const { executor, calls } = sequencedExecutor([state, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].document).toBe(DockerAutostartStateDocument);
    expect(calls[1].document).toBe(DockerSetAutostartDocument);
    expect(calls[1].variables).toEqual({
      persist: false,
      entries: [
        { id: "srv:db", autoStart: true, wait: 10 },
        { id: "srv:app", autoStart: false, wait: 0 },
        { id: "srv:idle", autoStart: false, wait: undefined },
      ],
    });
  });

  it("sorts the snapshot by autoStartOrder, not daemon order", async () => {
    const reordered = {
      docker: {
        containers: [
          { id: "srv:app", names: ["/app"], autoStart: true, autoStartOrder: 1, autoStartWait: 0 },
          { id: "srv:db", names: ["/db"], autoStart: true, autoStartOrder: 0, autoStartWait: 10 },
        ],
      },
    } satisfies DockerAutostartStateQuery;
    const { executor, calls } = sequencedExecutor([reordered, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:db", auto_start: true }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    const { entries } = calls[1].variables as { entries: { id: string }[] };
    expect(entries.map((entry) => entry.id)).toEqual(["srv:db", "srv:app"]);
  });

  it("keeps unordered (null autoStartOrder) containers last and stable among themselves", async () => {
    const withNulls = {
      docker: {
        containers: [
          {
            id: "srv:idleA",
            names: ["/idleA"],
            autoStart: false,
            autoStartOrder: null,
            autoStartWait: null,
          },
          { id: "srv:db", names: ["/db"], autoStart: true, autoStartOrder: 0, autoStartWait: 10 },
          {
            id: "srv:idleB",
            names: ["/idleB"],
            autoStart: false,
            autoStartOrder: null,
            autoStartWait: null,
          },
        ],
      },
    } satisfies DockerAutostartStateQuery;
    const { executor, calls } = sequencedExecutor([withNulls, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:db", auto_start: true }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    const { entries } = calls[1].variables as { entries: { id: string }[] };
    expect(entries.map((entry) => entry.id)).toEqual(["srv:db", "srv:idleA", "srv:idleB"]);
  });

  it("reports a false mutation result instead of asserting success", async () => {
    const notOk = {
      docker: { updateAutostartConfiguration: false },
    } satisfies DockerSetAutostartMutation;
    const { executor } = sequencedExecutor([state, notOk]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/not updated/i);
    expect(firstText(result)).not.toMatch(/Autostart updated:/);
  });

  it("reflects a false mutation result in the detailed payload", async () => {
    const notOk = {
      docker: { updateAutostartConfiguration: false },
    } satisfies DockerSetAutostartMutation;
    const { executor } = sequencedExecutor([state, notOk]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "detailed",
    });

    expect(JSON.parse(firstText(result)).ok).toBe(false);
  });

  it("rejects an unknown id and never calls the mutation", async () => {
    const { executor, calls } = sequencedExecutor([state]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:nope", auto_start: true }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Unknown container id/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(DockerAutostartStateDocument);
  });

  it("rejects duplicate ids without mutating", async () => {
    const { executor, calls } = sequencedExecutor([state]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [
        { id: "srv:app", auto_start: true },
        { id: "srv:app", auto_start: false },
      ],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Duplicate/);
    expect(calls).toHaveLength(1);
  });

  it("applies a provided wait and preserves an omitted one", async () => {
    const { executor, calls } = sequencedExecutor([state, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:db", auto_start: true, wait: 30 }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    const { entries } = calls[1].variables as { entries: { id: string; wait?: number }[] };
    expect(entries.find((entry) => entry.id === "srv:db")?.wait).toBe(30);
    expect(entries.find((entry) => entry.id === "srv:app")?.wait).toBe(0);
  });

  it("passes persist through and notes it in the summary", async () => {
    const { executor, calls } = sequencedExecutor([state, ok]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: true,
      confirm: true,
      response_format: "concise",
    });

    expect((calls[1].variables as { persist: boolean }).persist).toBe(true);
    expect(firstText(result)).toMatch(/WebGUI/);
  });

  it("summarizes changes by slash-stripped name", async () => {
    const { executor } = sequencedExecutor([state, ok]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/app OFF/);
    expect(firstText(result)).not.toMatch(/\/app/);
  });

  it("returns the resolved changes (id, name, autoStart, wait) in detailed format", async () => {
    const { executor } = sequencedExecutor([state, ok]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false, wait: 5 }],
      persist: true,
      confirm: true,
      response_format: "detailed",
    });

    expect(JSON.parse(firstText(result))).toEqual({
      ok: true,
      persisted: true,
      changes: [{ id: "srv:app", name: "app", autoStart: false, wait: 5 }],
    });
  });

  it("returns an error result when the read throws", async () => {
    const { executor } = sequencedExecutor([new Error("daemon down")]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to update Docker autostart/);
    expect(firstText(result)).toMatch(/daemon down/);
  });

  it("returns an error result when the mutation throws after a successful read", async () => {
    const { executor, calls } = sequencedExecutor([state, new Error("flag off")]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(2);
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/flag off/);
  });
});
