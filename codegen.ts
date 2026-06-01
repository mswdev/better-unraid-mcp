import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Generates a single committed TypeScript file of typed operation documents
 * from the vendored Unraid SDL. Native-fetch friendly (typed-document-node),
 * NodeNext friendly (single file, no relative imports). Refresh with
 * `npm run generate` after editing any *.graphql operation.
 */
const config: CodegenConfig = {
  schema: "schema/unraid.graphql",
  documents: ["src/**/*.graphql"],
  generates: {
    "src/types/unraid/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        defaultScalarType: "unknown",
        scalars: {
          DateTime: "string",
          PrefixedID: "string",
          JSON: "unknown",
          Long: "number",
          Port: "number",
          URL: "string",
        },
      },
    },
  },
};

export default config;
