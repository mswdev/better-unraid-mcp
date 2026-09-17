import type { DoctorCheck } from "../tools/system/connection-doctor.js";

/** The CLI sub-command that runs the connection doctor and exits. */
export const DOCTOR_COMMAND = "doctor";

/** Index of the first user argument in `process.argv` (after node and the script). */
const FIRST_ARGUMENT_INDEX = 2;

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

const STATUS_MARKS: Record<DoctorCheck["status"], string> = { ok: "✓", warn: "⚠", fail: "✗" };

/** What the CLI needs: a doctor runner and a line writer (both injectable for tests). */
export interface DoctorCliDeps {
  runDoctor: () => Promise<{ checks: DoctorCheck[] }>;
  write: (line: string) => void;
}

/**
 * True when the process was started as `better-unraid-mcp doctor`.
 *
 * @param argv - The raw `process.argv`.
 * @returns Whether the doctor sub-command was requested.
 * @example
 * isDoctorInvocation(["node", "dist/index.js", "doctor"]); // true
 */
export function isDoctorInvocation(argv: string[]): boolean {
  return argv[FIRST_ARGUMENT_INDEX] === DOCTOR_COMMAND;
}

/** Renders the closing verdict line. */
function verdictLine(failed: number): string {
  return failed === 0 ? "doctor: OK" : `doctor: FAILED (${failed} check(s) failed)`;
}

/**
 * Runs the connection doctor for the CLI, printing one line per check plus a
 * verdict, and returns the process exit code (non-zero when any check failed).
 *
 * @param deps - The doctor runner and the output writer.
 * @returns 0 when no check failed, 1 otherwise (including a doctor crash).
 * @example
 * process.exit(await runDoctorCli({ runDoctor, write: console.log }));
 */
export async function runDoctorCli(deps: DoctorCliDeps): Promise<number> {
  try {
    const { checks } = await deps.runDoctor();
    for (const check of checks) {
      deps.write(`${STATUS_MARKS[check.status]} ${check.detail}`);
    }
    const failed = checks.filter((check) => check.status === "fail").length;
    deps.write(verdictLine(failed));
    return failed === 0 ? EXIT_SUCCESS : EXIT_FAILURE;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.write(`✗ doctor crashed: ${message}`);
    deps.write(verdictLine(1));
    return EXIT_FAILURE;
  }
}
