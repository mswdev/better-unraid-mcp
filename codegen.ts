import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Generates a single committed TypeScript file of typed operation documents
 * from the vendored Unraid SDL. Native-fetch friendly (typed-document-node),
 * NodeNext friendly (single file, no relative imports). Refresh with
 * `npm run generate` after editing any *.graphql operation.
 *
 * Only the `typescript-operations` plugin is used (not the base `typescript`
 * plugin): in codegen v6 both plugins emit the schema enums an operation
 * selects, which produces duplicate-identifier errors in a single-file output.
 * `typescript-operations` already self-emits exactly the schema types the
 * operations reference, which is all this operations-only file needs.
 */
const config: CodegenConfig = {
  schema: "schema/unraid.graphql",
  documents: ["src/**/*.graphql"],
  generates: {
    "src/types/unraid/graphql.ts": {
      plugins: ["typescript-operations", "typed-document-node"],
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        defaultScalarType: "unknown",
        scalars: {
          DateTime: "string",
          PrefixedID: "string",
          JSON: "unknown",
          BigInt: "string",
          Long: "number",
          Port: "number",
          URL: "string",
        },
      },
    },
  },
};

export default config;
