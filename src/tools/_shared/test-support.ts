import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ShellExecutor, ShellResult } from "../../shell/executor.js";

/**
 * Returns the text of the first content block, asserting it is a text block.
 *
 * @param result - The tool result to read.
 * @returns The text of the first content block.
 * @throws Error when the first content block is missing or not text.
 */
export function firstText(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected a text content block");
  }
  return block.text;
}

/** A single recorded `execute` invocation. */
export interface RecordedCall {
  document: unknown;
  variables: unknown;
}

/**
 * Builds a fake executor that records every `execute` call and returns a canned
 * result. Use it to assert a confirm-gate short-circuited (no calls) or that a
 * tool dispatched the expected typed Document. Add a `satisfies <Operation>Query`/
 * `<Operation>Mutation` clause to the fixture literal at the call site so codegen
 * drift (a renamed selection field or dropped enum member) breaks the build —
 * that check happens at the call site and is independent of this signature.
 *
 * @param result - The value every `execute` call resolves to.
 * @returns The fake executor and the array of recorded calls.
 */
export function recordingExecutor(result: unknown): {
  executor: GraphQLExecutor;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const executor: GraphQLExecutor = {
    execute: async (document, variables) => {
      calls.push({ document, variables });
      return result as never;
    },
  };
  return { executor, calls };
}

/**
 * Builds a fake executor whose `execute` always throws an `Error`. Use it to
 * cover a handler's catch branch (the error path through the executor seam).
 *
 * @param message - The error message the thrown `Error` carries.
 * @returns A fake executor that rejects every call with an `Error`.
 */
export function throwingExecutor(message: string): GraphQLExecutor {
  return {
    execute: async () => {
      throw new Error(message);
    },
  };
}

/**
 * Builds a fake executor whose `execute` rejects with a non-`Error` value. Use
 * it to cover the `String(error)` coercion branch of a handler's catch block.
 *
 * @param reason - The non-`Error` rejection value.
 * @returns A fake executor that rejects every call with `reason`.
 */
export function rejectingExecutor(reason: unknown): GraphQLExecutor {
  return { execute: () => Promise.reject(reason) };
}

/**
 * Builds a fake executor that returns canned results in call order (one per
 * `execute` call) and records every call. A result that is an `Error` is thrown
 * instead of returned, so a multi-call handler can be exercised through both the
 * read and the mutate call (e.g. read succeeds, then the mutation throws).
 *
 * @param results - Canned results (or `Error`s to throw), consumed in order.
 * @returns The fake executor and the array of recorded calls.
 */
export function sequencedExecutor(results: unknown[]): {
  executor: GraphQLExecutor;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const executor: GraphQLExecutor = {
    execute: async (document, variables) => {
      calls.push({ document, variables });
      const result = results[index];
      index += 1;
      if (result instanceof Error) {
        throw result;
      }
      return result as never;
    },
  };
  return { executor, calls };
}

/** A single recorded `execute` invocation on a fake shell executor. */
export interface RecordedShellCall {
  command: string;
  timeoutMs: number;
}

/**
 * Builds a fake shell executor that records every call and returns a canned
 * result. Use it to assert the exact command a tool built (quoting included)
 * and that gates short-circuit before any command runs.
 *
 * @param result - The `ShellResult` every `execute` call resolves to.
 * @returns The fake executor and the array of recorded calls.
 */
export function recordingShell(result: ShellResult): {
  shell: ShellExecutor;
  calls: RecordedShellCall[];
} {
  const calls: RecordedShellCall[] = [];
  const shell: ShellExecutor = {
    execute: async (command, timeoutMs) => {
      calls.push({ command, timeoutMs });
      return result;
    },
  };
  return { shell, calls };
}

/**
 * Builds a fake shell executor whose `execute` always throws an `Error`. Use
 * it to cover a handler's catch branch (connection/auth/timeout failures).
 *
 * @param message - The error message the thrown `Error` carries.
 * @returns A fake executor that rejects every call.
 */
export function throwingShell(message: string): ShellExecutor {
  return {
    execute: async () => {
      throw new Error(message);
    },
  };
}
