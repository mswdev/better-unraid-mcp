import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";

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
 * tool dispatched the expected typed Document. The result type parameter lets
 * callers pass a `satisfies <Operation>Query`/`<Operation>Mutation` fixture so
 * codegen drift breaks the build.
 *
 * @param result - The value every `execute` call resolves to.
 * @returns The fake executor and the array of recorded calls.
 */
export function recordingExecutor<T>(result: T): {
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
