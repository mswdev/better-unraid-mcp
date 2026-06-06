import { describe, expect, it } from "vitest";
import {
  ParityCheckCancelDocument,
  type ParityCheckCancelMutation,
  ParityCheckPauseDocument,
  type ParityCheckPauseMutation,
  ParityCheckResumeDocument,
  type ParityCheckResumeMutation,
  ParityCheckStartDocument,
  type ParityCheckStartMutation,
} from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createParityCheckHandler } from "./parity-check.js";

// Upstream returns a stale parity-history array as the JSON! payload
// (validated at v4.35.0) — the handler never reads it, fixtures mirror that.
const startResult = { parityCheck: { start: [] } } satisfies ParityCheckStartMutation;
const pauseResult = { parityCheck: { pause: [] } } satisfies ParityCheckPauseMutation;
const resumeResult = { parityCheck: { resume: [] } } satisfies ParityCheckResumeMutation;
const cancelResult = { parityCheck: { cancel: [] } } satisfies ParityCheckCancelMutation;

describe("parity_check validation and gate", () => {
  it("rejects correct with a non-start action before any GraphQL call", async () => {
    const { executor, calls } = recordingExecutor(cancelResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "cancel",
      correct: false,
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/only valid with action "start"/);
    expect(firstText(result)).toMatch(/No changes were made/);
    expect(calls).toHaveLength(0);
  });

  it("refuses without confirm and makes no calls", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/);
    expect(calls).toHaveLength(0);
  });

  it("names the correcting mode in the start refusal when correct is true", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      correct: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/correcting/);
    expect(calls).toHaveLength(0);
  });
});

describe("parity_check happy path", () => {
  it("starts read-only by default and reports requested, pointing to array_status", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Parity check start requested \(read-only\)/);
    expect(firstText(result)).toMatch(/array_status/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(ParityCheckStartDocument);
    expect(calls[0].variables).toEqual({ correct: false });
  });

  it("forwards correct: true and names the correcting mode", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      correct: true,
      confirm: true,
    });

    expect(firstText(result)).toMatch(/correcting — writes corrections to parity/);
    expect(calls[0].variables).toEqual({ correct: true });
  });

  it.each([
    ["pause", ParityCheckPauseDocument, pauseResult],
    ["resume", ParityCheckResumeDocument, resumeResult],
    ["cancel", ParityCheckCancelDocument, cancelResult],
  ] as const)(
    "dispatches %s and warns it may be a silent no-op",
    async (action, document, fixture) => {
      const { executor, calls } = recordingExecutor(fixture);

      const result = await createParityCheckHandler(executor)({
        response_format: "concise",
        action,
        confirm: true,
      });

      expect(result.isError).toBeUndefined();
      expect(firstText(result)).toMatch(new RegExp(`Parity check ${action} requested`));
      expect(firstText(result)).toMatch(/no effect/);
      expect(calls[0].document).toBe(document);
      expect(calls[0].variables).toBeUndefined();
    },
  );

  it("returns the structured outcome in detailed format", async () => {
    const { executor } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "detailed",
      action: "start",
      confirm: true,
    });

    expect(firstText(result)).toContain('"requested": "start"');
    expect(firstText(result)).toContain('"correct": false');
    expect(firstText(result)).toContain('"outcome": "requested"');
  });
});

describe("parity_check error mapping", () => {
  it("maps the start-while-running guard to a clear refusal", async () => {
    const executor = throwingExecutor("Invalid parity check state: start");

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/already running/);
    expect(firstText(result)).toMatch(/No changes were made/);
  });

  it("reports the post-command history-read failure as issued-but-unverified", async () => {
    const executor = throwingExecutor(
      "Parity history file not found: /boot/config/parity-checks.log",
    );

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/command was issued/);
    expect(firstText(result)).toMatch(/array_status/);
  });

  it("wraps unknown errors in the standard failure form", async () => {
    const executor = throwingExecutor("Forbidden resource");

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "cancel",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to cancel the parity check: Forbidden resource");
  });

  it("coerces non-Error rejections to strings", async () => {
    const executor = rejectingExecutor("denied");

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "pause",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to pause the parity check: denied");
  });
});
