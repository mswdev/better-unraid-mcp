import { describe, expect, it } from "vitest";
import { ArraySetStateDocument, type ArraySetStateMutation } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { DESIRED_STATE, createArrayActionHandler } from "./array-action.js";

/** Pre-mutation snapshot: a start issued against a stopped array (finding 1). */
const setStateResult = {
  array: { setState: { id: "array", state: "STOPPED" } },
} satisfies ArraySetStateMutation;

describe("DESIRED_STATE", () => {
  it("maps lowercase tool actions to SDL enum values", () => {
    expect(DESIRED_STATE.start).toBe("START");
    expect(DESIRED_STATE.stop).toBe("STOP");
  });
});

describe("array_action gate", () => {
  it("refuses start without confirm and makes no GraphQL calls", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/);
    expect(firstText(result)).toMatch(/No changes were made/);
    expect(calls).toHaveLength(0);
  });

  it("refuses stop with confirm alone, naming both flags, with no calls", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/acknowledge_risk/);
    expect(firstText(result)).toMatch(/share.*Docker container.*VM/);
    expect(calls).toHaveLength(0);
  });

  it("refuses stop with acknowledge_risk alone", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("array_action happy path", () => {
  it("dispatches START and reports the action as requested, pointing to array_status", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Array start requested/);
    expect(firstText(result)).toMatch(/array_status/);
    expect(firstText(result)).not.toMatch(/Started/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(ArraySetStateDocument);
    expect(calls[0].variables).toEqual({ input: { desiredState: "START" } });
  });

  it("dispatches STOP behind the two-tier gate and names the blast radius", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Array stop requested/);
    expect(firstText(result)).toMatch(/offline/);
    expect(calls[0].variables).toEqual({ input: { desiredState: "STOP" } });
  });

  it("labels the echoed state preMutationState in detailed output", async () => {
    const { executor } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "detailed",
      action: "start",
      confirm: true,
    });

    expect(firstText(result)).toContain('"preMutationState": "STOPPED"');
    expect(firstText(result)).toContain('"outcome": "requested"');
  });
});

describe("array_action error mapping", () => {
  it("maps start-when-already-STARTED to a benign no-op, not an error", async () => {
    const executor = throwingExecutor("The array is already STARTED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/already STARTED/);
    expect(firstText(result)).toMatch(/no action was taken/);
  });

  it("hedges stop-when-already-STOPPED: error states produce the same message", async () => {
    const executor = throwingExecutor("The array is already STOPPED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/already stopped/);
    expect(firstText(result)).toMatch(/error state/);
    expect(firstText(result)).toMatch(/array_status/);
  });

  it("does NOT map the other action's same-state message (start vs already STOPPED)", async () => {
    const executor = throwingExecutor("The array is already STOPPED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to start the array/);
  });

  it("maps the in-flight guard to a transient retry error", async () => {
    const executor = throwingExecutor("Array state is still being updated. Changing to STARTED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/still in progress/);
    expect(firstText(result)).toMatch(/Retry shortly/);
  });

  it("reports state-not-loaded as issued-but-unverified, not failure", async () => {
    const executor = throwingExecutor("Attempt to get Array Data, but state was not loaded");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/command was issued/);
    expect(firstText(result)).toMatch(/array_status/);
  });

  it("exposes the outcome in detailed format for mapped no-ops", async () => {
    const executor = throwingExecutor("The array is already STARTED");

    const result = await createArrayActionHandler(executor)({
      response_format: "detailed",
      action: "start",
      confirm: true,
    });

    expect(firstText(result)).toContain('"outcome": "already-in-state"');
  });

  it("wraps unknown errors in the standard failure form", async () => {
    const executor = throwingExecutor("Forbidden resource");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to start the array: Forbidden resource");
  });

  it("coerces non-Error rejections to strings", async () => {
    const executor = rejectingExecutor("denied");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to start the array: denied");
  });
});
