import { describe, expect, it } from "vitest";
import { recordingExecutor } from "./test-support.js";

describe("recordingExecutor", () => {
  it("starts with no recorded calls", () => {
    const { calls } = recordingExecutor({ ok: true });

    expect(calls).toHaveLength(0);
  });

  it("records the document and variables of each execute call", async () => {
    const doc = { marker: "doc" };
    const { executor, calls } = recordingExecutor({ ok: true });

    const result = await executor.execute(doc as never, { id: "x" } as never);

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ document: doc, variables: { id: "x" } });
  });
});
