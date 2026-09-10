import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type DocumentNode, Kind, type OperationTypeNode, parse, visit } from "graphql";
import { toolText } from "../_shared/respond.js";
import { truncateOutputKeepingHead } from "../_shared/truncate-output.js";

const JSON_INDENT_SPACES = 2;

/**
 * Mutation fields whose blast radius warrants the same acknowledge_risk
 * double-gate the dedicated tools enforce: setState can stop the array
 * (taking every share, container, and VM offline), forceStop/reset hard-kill
 * a VM, and configureUps rewrites the system shutdown configuration. Exact
 * name matches only; similarly named fields (resetOnboarding,
 * resetDockerTemplateMappings) are distinct identifiers and not caught.
 */
const RISKY_MUTATION_FIELDS = new Set(["setState", "forceStop", "reset", "configureUps"]);

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

/**
 * Collects the high-risk field names a document selects (at any depth), so
 * the mutation tool can demand acknowledge_risk before running them.
 *
 * @param document - The parsed operation document to inspect.
 * @returns The risky field names found, empty when the document is benign.
 */
export function findRiskyFields(document: DocumentNode): string[] {
  const found = new Set<string>();
  visit(document, {
    Field(node) {
      if (RISKY_MUTATION_FIELDS.has(node.name.value)) {
        found.add(node.name.value);
      }
    },
  });
  return [...found];
}

/**
 * Renders a raw GraphQL data payload as pretty-printed JSON, head-truncated
 * so oversized results keep their top-level structure.
 *
 * @param data - The operation's data payload.
 * @returns A successful tool result carrying the (possibly capped) JSON.
 */
export function renderJsonResult(data: unknown): CallToolResult {
  return toolText(truncateOutputKeepingHead(JSON.stringify(data, null, JSON_INDENT_SPACES)));
}
