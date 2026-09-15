import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import { createProcessListHandler } from "./process-list.js";

const psOutput = {
  stdout: [
    "  PID %CPU %MEM   RSS     ELAPSED COMMAND",
    " 1234 45.0  2.1 345678  1-02:03:04 qemu-system-x86",
    " 5678 12.5  8.0 987654    03:04:05 java",
  ].join("\n"),
  stderr: "",
  exitCode: 0,
};

describe("process_list", () => {
  it("parses the top processes and reports them", async () => {
    const { shell, calls } = recordingShell(psOutput);
    const handler = createProcessListHandler(shell);

    const result = await handler({ response_format: "concise", sort_by: "cpu", count: 15 });
    const text = firstText(result);

    expect(calls[0].command).toContain("--sort=-pcpu");
    expect(calls[0].command).toContain("head -n 16");
    expect(text).toContain("qemu-system-x86");
    expect(text).toContain("45% CPU");
  });

  it("sorts by memory when asked", async () => {
    const { shell, calls } = recordingShell(psOutput);
    const handler = createProcessListHandler(shell);

    await handler({ response_format: "concise", sort_by: "memory", count: 10 });

    expect(calls[0].command).toContain("--sort=-pmem");
  });

  it("maps SSH failures to a clean error", async () => {
    const handler = createProcessListHandler(throwingShell("gone"));

    const result = await handler({ response_format: "concise", sort_by: "cpu", count: 15 });

    expect(result.isError).toBe(true);
  });
});
