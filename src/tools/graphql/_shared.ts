import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  type DocumentNode,
  type GraphQLSchema,
  Kind,
  type OperationTypeNode,
  buildSchema,
  parse,
  validate,
  visit,
} from "graphql";
import { loadSchemaSdl } from "../../resources/schema-sdl.js";
import { toolText } from "../_shared/respond.js";
import { truncateJsonPayload } from "../_shared/truncate-output.js";

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
 * Renders a raw GraphQL data payload as pretty-printed JSON. Oversized
 * payloads are replaced by a parseable truncation envelope carrying the head
 * of the serialization, so the output always survives JSON.parse.
 *
 * @param data - The operation's data payload.
 * @returns A successful tool result carrying the (possibly enveloped) JSON.
 */
export function renderJsonResult(data: unknown): CallToolResult {
  return toolText(truncateJsonPayload(JSON.stringify(data, null, JSON_INDENT_SPACES)));
}

/** Loads the SDL text the validation schema is built from (injectable for tests). */
export type SdlLoader = () => string;

/** Built schemas cached per loader, so the ~80 KB vendored SDL is parsed once per process. */
const schemaCache = new WeakMap<SdlLoader, GraphQLSchema>();

/** The default loader identity must be stable for the cache to hit — hence a module constant. */
const defaultSdlLoader: SdlLoader = () => loadSchemaSdl();

function schemaFor(loadSdl: SdlLoader): GraphQLSchema {
  const cached = schemaCache.get(loadSdl);
  if (cached) {
    return cached;
  }
  const schema = buildSchema(loadSdl());
  schemaCache.set(loadSdl, schema);
  return schema;
}

/**
 * Validates a parsed operation against the vendored Unraid schema without
 * sending it, returning graphql-js messages (which include did-you-mean hints).
 *
 * @param document - The parsed operation.
 * @param loadSdl - SDL source; defaults to the vendored schema.
 * @returns Validation messages; empty when the document is valid.
 * @example
 * validateAgainstSchema(parse("query { info { versionz } }")); // ['Cannot query field "versionz" … Did you mean "versions"?']
 */
export function validateAgainstSchema(
  document: DocumentNode,
  loadSdl: SdlLoader = defaultSdlLoader,
): string[] {
  return validate(schemaFor(loadSdl), document).map((error) => error.message);
}

/** The refusal text for a document that fails local validation (nothing was sent). */
export function validationFailure(messages: string[]): string {
  const bullets = messages.map((message) => `- ${message}`).join("\n");
  return `GraphQL validation failed against the vendored Unraid schema (nothing was sent):\n${bullets}`;
}

/** The success text for a `dry_run` that passed validation. */
export const DRY_RUN_VALID_TEXT =
  "Valid against the vendored Unraid schema; not sent (dry_run). Re-call without dry_run to execute.";
