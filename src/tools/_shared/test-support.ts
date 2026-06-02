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
 * tool dispatched the expected typed Document.
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
