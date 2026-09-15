import { readFileSync } from "node:fs";

/**
 * Candidate locations of the vendored SDL relative to this module: the
 * bundled build lives at `dist/index.js` (schema one level up), while tests
 * import from `src/resources/` (schema two levels up).
 */
const SCHEMA_CANDIDATES = ["../schema/unraid.graphql", "../../schema/unraid.graphql"];

/** Reads one candidate URL; injectable for tests. */
export type SchemaFileReader = (path: URL) => string;

const defaultReader: SchemaFileReader = (path) => readFileSync(path, "utf8");

/**
 * Loads the vendored Unraid GraphQL SDL that ships inside this package.
 *
 * @param readFile - Injectable file reader (tests only).
 * @returns The SDL text.
 * @throws Error when the schema file cannot be found next to the package.
 */
export function loadSchemaSdl(readFile: SchemaFileReader = defaultReader): string {
  for (const candidate of SCHEMA_CANDIDATES) {
    try {
      return readFile(new URL(candidate, import.meta.url));
    } catch {
      // Try the next candidate location.
    }
  }
  throw new Error(
    "Vendored schema/unraid.graphql not found next to the package — the install may be corrupted.",
  );
}
