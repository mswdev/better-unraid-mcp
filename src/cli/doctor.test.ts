import { describe, expect, it } from "vitest";
import type { DoctorCheck } from "../tools/system/connection-doctor.js";
import { isDoctorInvocation, runDoctorCli } from "./doctor.js";

function cliWith(checks: DoctorCheck[]): { run: () => Promise<number>; lines: string[] } {
  const lines: string[] = [];
  const run = () =>
    runDoctorCli({ runDoctor: async () => ({ checks }), write: (line) => lines.push(line) });
  return { run, lines };
}

describe("runDoctorCli", () => {
  it("prints every check and exits 0 when nothing failed", async () => {
    const { run, lines } = cliWith([
      { check: "graphql", status: "ok", detail: "Reachable in 9 ms" },
      { check: "ssh", status: "warn", detail: "SSH: not configured (optional)." },
    ]);

    const code = await run();

    expect(code).toBe(0);
    expect(lines).toEqual([
      "✓ Reachable in 9 ms",
      "⚠ SSH: not configured (optional).",
      "doctor: OK",
    ]);
  });

  it("exits 1 and counts the failures when any check failed", async () => {
    const { run, lines } = cliWith([
      { check: "graphql", status: "fail", detail: "Endpoint unreachable" },
      { check: "ssh", status: "fail", detail: "SSH: failed" },
    ]);

    const code = await run();

    expect(code).toBe(1);
    expect(lines.at(-1)).toBe("doctor: FAILED (2 check(s) failed)");
  });

  it("reports an unexpected doctor crash as a failure", async () => {
    const lines: string[] = [];
    const code = await runDoctorCli({
      runDoctor: async () => {
        throw new Error("boom");
      },
      write: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("boom");
  });
});

describe("isDoctorInvocation", () => {
  it("is true only when the first CLI argument is doctor", () => {
    expect(isDoctorInvocation(["node", "dist/index.js", "doctor"])).toBe(true);
    expect(isDoctorInvocation(["node", "dist/index.js"])).toBe(false);
    expect(isDoctorInvocation(["node", "dist/index.js", "serve"])).toBe(false);
  });
});
