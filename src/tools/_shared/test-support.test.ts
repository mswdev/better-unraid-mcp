import { describe, expect, it } from "vitest";
import { recordingExecutor, sequencedExecutor } from "./test-support.js";

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

describe("sequencedExecutor", () => {
  it("returns canned results in call order and records each call", async () => {
    const { executor, calls } = sequencedExecutor([{ a: 1 }, { b: 2 }]);

    const first = await executor.execute({ d: 1 } as never, { v: 1 } as never);
    const second = await executor.execute({ d: 2 } as never);

    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ b: 2 });
    expect(calls).toEqual([
      { document: { d: 1 }, variables: { v: 1 } },
      { document: { d: 2 }, variables: undefined },
    ]);
  });

  it("throws when the sequenced result is an Error", async () => {
    const { executor } = sequencedExecutor([new Error("boom")]);

    await expect(executor.execute({} as never)).rejects.toThrow("boom");
  });
});
