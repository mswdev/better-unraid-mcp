import { readFileSync } from "node:fs";

/** Candidate locations relative to this module: from `src/resources/` and from the bundled `dist/`. */
const SCHEMA_CANDIDATES = ["../schema/unraid.graphql", "../../schema/unraid.graphql"];
const VERSION_CANDIDATES = ["../schema/schema-version.json", "../../schema/schema-version.json"];

/** Reads a file by URL; injectable for tests. */
export type SchemaFileReader = (path: URL) => string;

const defaultReader: SchemaFileReader = (path) => readFileSync(path, "utf8");

/** Returns the contents of the first candidate that can be read, or null. */
function readFirst(candidates: string[], readFile: SchemaFileReader): string | null {
  for (const candidate of candidates) {
    try {
      return readFile(new URL(candidate, import.meta.url));
    } catch {
      // Try the next candidate location.
    }
  }
  return null;
}

/**
 * Loads the vendored Unraid GraphQL SDL shipped next to the package.
 *
 * @param readFile - File reader (injectable for tests).
 * @returns The SDL text.
 * @throws Error when the schema file is missing from every candidate location.
 */
export function loadSchemaSdl(readFile: SchemaFileReader = defaultReader): string {
  const sdl = readFirst(SCHEMA_CANDIDATES, readFile);
  if (sdl === null) {
    throw new Error(
      "Vendored schema/unraid.graphql not found next to the package — the install may be corrupted.",
    );
  }
  return sdl;
}

/** Extracts `apiVersion` from the sidecar JSON, or null when absent or malformed. */
function parseApiVersion(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const version = (parsed as Record<string, unknown>).apiVersion;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The upstream unraid/api version the vendored SDL was fetched from, as
 * recorded by `npm run schema:update` in schema/schema-version.json.
 *
 * @param readFile - File reader (injectable for tests).
 * @returns The version string (e.g. "4.37.4"), or null when not recorded.
 * @example
 * loadSchemaVersion(); // "4.37.4"
 */
export function loadSchemaVersion(readFile: SchemaFileReader = defaultReader): string | null {
  const raw = readFirst(VERSION_CANDIDATES, readFile);
  return raw === null ? null : parseApiVersion(raw);
}
