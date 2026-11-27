import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { quoteForShell } from "../_shared/quote-shell.js";
import {
  formatScriptArguments,
  MAX_SCRIPT_ARGUMENT_LENGTH,
  MAX_SCRIPT_ARGUMENTS,
  MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH,
  scriptArgumentsSchema,
} from "./script-arguments.js";

/**
 * The largest tail the bounds allow: 32 arguments of 512 single quotes, each
 * quote expanding to 4 bytes, plus 2 wrapping quotes per argument and 31
 * separating spaces: 32 * (512 * 4 + 2) + 31.
 */
const WORST_CASE_TAIL_BYTES = 65_631;

/** How many arguments the total-length cases spread their characters over. */
const TOTAL_CASE_ARGUMENT_COUNT = 5;

/** Builds `count` arguments of `length` characters each. */
function argumentsOf(count: number, length: number): string[] {
  return Array.from({ length: count }, () => "x".repeat(length));
}

/**
 * Arguments whose lengths add up to exactly `total`, spread over several
 * arguments that each stay under the per-argument cap.
 */
function argumentsTotalling(total: number): string[] {
  const shortLength = Math.floor(total / TOTAL_CASE_ARGUMENT_COUNT);
  const short = argumentsOf(TOTAL_CASE_ARGUMENT_COUNT - 1, shortLength);
  const rest = total - shortLength * (TOTAL_CASE_ARGUMENT_COUNT - 1);
  return [...short, "x".repeat(rest)];
}

describe("scriptArgumentsSchema", () => {
  it("defaults to no arguments when omitted", () => {
    const parsed = scriptArgumentsSchema.parse(undefined);

    expect(parsed).toEqual([]);
  });

  it("accepts the maximum number of arguments and rejects one more", () => {
    const atLimit = argumentsOf(MAX_SCRIPT_ARGUMENTS, 1);
    const overLimit = argumentsOf(MAX_SCRIPT_ARGUMENTS + 1, 1);

    const accepted = scriptArgumentsSchema.safeParse(atLimit);
    const rejected = scriptArgumentsSchema.safeParse(overLimit);

    expect(accepted.success).toBe(true);
    expect(rejected.error?.issues[0].message).toBe(
      `A user script can receive at most ${MAX_SCRIPT_ARGUMENTS} arguments.`,
    );
  });

  it("accepts an argument at the per-argument cap and rejects one character more", () => {
    const atLimit = argumentsOf(1, MAX_SCRIPT_ARGUMENT_LENGTH);
    const overLimit = argumentsOf(1, MAX_SCRIPT_ARGUMENT_LENGTH + 1);

    const accepted = scriptArgumentsSchema.safeParse(atLimit);
    const rejected = scriptArgumentsSchema.safeParse(overLimit);

    expect(accepted.success).toBe(true);
    expect(rejected.error?.issues[0].message).toBe(
      `A script argument can be at most ${MAX_SCRIPT_ARGUMENT_LENGTH} characters.`,
    );
  });

  it("accepts arguments totalling the cap and rejects one character more", () => {
    const atLimit = argumentsTotalling(MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH);
    const overLimit = argumentsTotalling(MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH + 1);

    const accepted = scriptArgumentsSchema.safeParse(atLimit);
    const rejected = scriptArgumentsSchema.safeParse(overLimit);

    expect(Math.max(...overLimit.map((item) => item.length))).toBeLessThan(
      MAX_SCRIPT_ARGUMENT_LENGTH,
    );
    expect(accepted.success).toBe(true);
    expect(rejected.error?.issues[0].message).toBe(
      `Script arguments can total at most ${MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH} characters.`,
    );
  });

  it("rejects an argument containing a NUL character", () => {
    const withNul = ["before\0after"];

    const rejected = scriptArgumentsSchema.safeParse(withNul);

    expect(rejected.error?.issues[0].message).toBe(
      "A script argument cannot contain a NUL character (\\0): a POSIX argument cannot carry one.",
    );
  });

  it("accepts an empty-string argument", () => {
    const parsed = scriptArgumentsSchema.parse(["", "second"]);

    expect(parsed).toEqual(["", "second"]);
  });
});

describe("formatScriptArguments", () => {
  it("renders no arguments as an empty string", () => {
    const tail = formatScriptArguments([]);

    expect(tail).toBe("");
  });

  it("quotes each argument on its own and escapes embedded single quotes", () => {
    const tail = formatScriptArguments(["it's", "a b", ""]);

    expect(tail).toBe("'it'\\''s' 'a b' ''");
  });

  it("keeps the largest tail the bounds allow at 65,631 bytes", () => {
    const perArgument = MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH / MAX_SCRIPT_ARGUMENTS;
    const allQuotes = Array.from({ length: MAX_SCRIPT_ARGUMENTS }, () => "'".repeat(perArgument));

    const tail = formatScriptArguments(scriptArgumentsSchema.parse(allQuotes));

    expect(Buffer.byteLength(tail, "utf8")).toBe(WORST_CASE_TAIL_BYTES);
  });
});

/**
 * Prints the argv it receives as JSON. Run as a script file (like the
 * runner's `bash "$T"`), so node stops parsing its own options at the file
 * name and a leading `--wait` reaches the script untouched.
 */
const ARGV_PRINTER = "process.stdout.write(JSON.stringify(process.argv.slice(2)));";

/** Arguments that would be mangled, split, or executed if quoting were wrong. */
const HOSTILE_ARGUMENTS = [
  "",
  "two words",
  "it's",
  'say "hi"',
  "$(id)",
  "`id`",
  "a; echo injected",
  "true && echo injected",
  "a | cat",
  "*",
  "$HOME",
  "line one\nline two",
  "-",
  "--wait",
  "back\\slash",
  "héllo 🚀",
];

describe("formatScriptArguments through a real shell", () => {
  const printerDirectory = mkdtempSync(join(tmpdir(), "script-arguments-"));
  const printerPath = join(printerDirectory, "print-argv.mjs");
  writeFileSync(printerPath, ARGV_PRINTER);

  afterAll(() => {
    rmSync(printerDirectory, { recursive: true, force: true });
  });

  /** Parses `<node> <printer> <tail>` with `shellPath -c` and returns the argv the printer saw. */
  function receivedArguments(shellPath: string, scriptArguments: string[]): string[] {
    const printer = `${quoteForShell(process.execPath)} ${quoteForShell(printerPath)}`;
    const command = `${printer} ${formatScriptArguments(scriptArguments)}`;
    const run = spawnSync(shellPath, ["-c", command], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(run.stdout) as string[];
  }

  it.each(["/bin/sh", "/bin/bash"])(
    "%s receives every argument literally and in order",
    (shellPath) => {
      const received = receivedArguments(shellPath, HOSTILE_ARGUMENTS);

      expect(received).toEqual(HOSTILE_ARGUMENTS);
    },
  );

  it.each(["/bin/sh", "/bin/bash"])("%s receives no arguments for an empty list", (shellPath) => {
    const received = receivedArguments(shellPath, []);

    expect(received).toEqual([]);
  });
});
