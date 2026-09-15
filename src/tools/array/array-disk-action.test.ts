import { describe, expect, it } from "vitest";
import {
  ArrayDiskAddDocument,
  ArrayDiskClearStatsDocument,
  ArrayDiskMountDocument,
  ArrayDiskRemoveDocument,
  ArrayStateProbeDocument,
} from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  sequencedExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createArrayDiskActionHandler } from "./array-disk-action.js";

const stoppedProbe = { array: { state: "STOPPED" } };
const startedProbe = { array: { state: "STARTED" } };

const bothFlags = { confirm: true, acknowledge_risk: true };

describe("array_disk_action gates and validation", () => {
  it("refuses without both flags and runs zero queries", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createArrayDiskActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      action: "remove",
      id: "disk1",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("rejects slot outside add/remove before any query", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createArrayDiskActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      action: "mount",
      id: "disk1",
      slot: 3,
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("slot");
    expect(calls).toHaveLength(0);
  });
});

describe("array_disk_action state preconditions", () => {
  it("refuses remove while the array is started, issuing only the probe", async () => {
    const { executor, calls } = sequencedExecutor([startedProbe]);
    const handler = createArrayDiskActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      action: "remove",
      id: "disk1",
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("STOPPED array");
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(ArrayStateProbeDocument);
  });

  it("refuses mount while the array is stopped", async () => {
    const { executor, calls } = sequencedExecutor([stoppedProbe]);
    const handler = createArrayDiskActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      action: "mount",
      id: "disk1",
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("STARTED");
    expect(calls).toHaveLength(1);
  });
});

describe("array_disk_action happy paths", () => {
  it("adds a disk with its slot after a stopped-array probe", async () => {
    const { executor, calls } = sequencedExecutor([
      stoppedProbe,
      { array: { addDiskToArray: { state: "STOPPED" } } },
    ]);
    const handler = createArrayDiskActionHandler(executor);

    const result = await handler({
      response_format: "concise",
      action: "add",
      id: "disk3",
      slot: 3,
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls[1].document).toBe(ArrayDiskAddDocument);
    expect(calls[1].variables).toEqual({ input: { id: "disk3", slot: 3 } });
    expect(firstText(result)).toContain("verify");
  });

  it("removes a disk via the remove document", async () => {
    const { executor, calls } = sequencedExecutor([
      stoppedProbe,
      { array: { removeDiskFromArray: { state: "STOPPED" } } },
    ]);
    const handler = createArrayDiskActionHandler(executor);

    await handler({ response_format: "concise", action: "remove", id: "disk3", ...bothFlags });

    expect(calls[1].document).toBe(ArrayDiskRemoveDocument);
  });

  it("mounts a disk on a started array", async () => {
    const { executor, calls } = sequencedExecutor([
      startedProbe,
      { array: { mountArrayDisk: { id: "disk1", status: "DISK_OK" } } },
    ]);
    const handler = createArrayDiskActionHandler(executor);

    await handler({ response_format: "concise", action: "mount", id: "disk1", ...bothFlags });

    expect(calls[1].document).toBe(ArrayDiskMountDocument);
    expect(calls[1].variables).toEqual({ id: "disk1" });
  });

  it("clears statistics on a started array", async () => {
    const { executor, calls } = sequencedExecutor([
      startedProbe,
      { array: { clearArrayDiskStatistics: true } },
    ]);
    const handler = createArrayDiskActionHandler(executor);

    await handler({
      response_format: "concise",
      action: "clear_statistics",
      id: "disk1",
      ...bothFlags,
    });

    expect(calls[1].document).toBe(ArrayDiskClearStatsDocument);
  });
});

describe("array_disk_action failures", () => {
  it("maps executor failures to a clean error", async () => {
    const handler = createArrayDiskActionHandler(throwingExecutor("forbidden"));

    const result = await handler({
      response_format: "concise",
      action: "mount",
      id: "disk1",
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("forbidden");
  });
});
