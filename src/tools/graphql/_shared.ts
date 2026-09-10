import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { Kind, type OperationTypeNode, parse } from "graphql";

/** A parsed raw operation ready to hand to the GraphQL executor. */
export interface ParsedOperation {
  document: TypedDocumentNode<unknown, Record<string, unknown> | undefined>;
  operation: OperationTypeNode;
}

/**
 * Parses a raw GraphQL source string into exactly one executable operation.
 * Rejects invalid syntax and documents with zero or multiple operations, so
 * callers can then enforce the operation type (query vs mutation).
 *
 * @param source - The raw GraphQL operation text.
 * @returns The parsed document and its operation type.
 * @throws Error with a readable message on syntax errors or operation-count problems.
 */
export function parseSingleOperation(source: string): ParsedOperation {
  const document = parse(source);
  const operations = document.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  const first = operations[0];
  if (!first || operations.length !== 1) {
    throw new Error(`Expected exactly one GraphQL operation, found ${operations.length}.`);
  }
  return {
    document: document as ParsedOperation["document"],
    operation: first.operation,
  };
}
