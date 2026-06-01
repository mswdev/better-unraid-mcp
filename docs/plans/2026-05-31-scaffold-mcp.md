# better-unraid-mcp Scaffold Implementation Plan (PR #1)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up `better-unraid-mcp` — a standalone TypeScript MCP server (npm/`npx`) that talks to Unraid's GraphQL API — with the full framework in place and one working read-only proof-of-concept tool (`get_system_info`), plus the ported/customized LLM agent kit, CI, and install docs.

**Architecture:** A single-package ESM TypeScript MCP server built on `@modelcontextprotocol/sdk` v1.29 (stdio + Streamable HTTP transports). Tools are discrete, resource-namespaced, self-registering modules grouped one directory per Unraid resource (`tools/system/` for now). The GraphQL layer uses graphql-codegen to turn a vendored Unraid SDL into committed TypeScript types, executed over native (undici) `fetch` with `print()` — zero GraphQL client dependency. Everything is hermetically unit-tested behind a `GraphQLExecutor` interface seam (hand-written fakes, no network).

**Tech Stack:** TypeScript 5 (strict, ESM, NodeNext), Node ≥20, `@modelcontextprotocol/sdk` ^1.29, `zod` ^3.25, `pino` ^9, `undici` (native fetch + scoped self-signed TLS), `graphql` + graphql-codegen (typed-document-node, single committed file), `tsup` (bundle to `dist/index.js` with shebang), `tsx`, `@biomejs/biome` ^1.9, `vitest`.

---

## Conventions (read before every task)

These are **hard rules** — the ported `.claude/rules/` enforce them and the PR review will check them:

1. **NodeNext means `.js` import extensions.** Every relative import in source uses the `.js` extension even though the file is `.ts` (e.g. `import { loadEnv } from "./config/env.js"`). tsc will error without it.
2. **stdio mode owns stdout.** In stdio transport, stdout is the MCP wire protocol. **Never** `console.log` / write to stdout. All logging goes through pino to **stderr** (fd 2). A stray stdout write corrupts the protocol.
3. **No `any`.** Use `unknown` + narrowing. graphql-codegen is configured with `defaultScalarType: 'unknown'` so unmapped scalars never become `any`.
4. **≤25-line methods, ≤2 nesting levels, ≤3 params, early returns, no magic numbers, JSDoc on exports.**
5. **Tests are hermetic.** No network. Inject hand-written fakes through the `GraphQLExecutor` / `fetchImpl` seams.
6. **Conventional commits**, one logical change per commit, commit after each green step. We are on branch `feature/scaffold-mcp` (already created off `develop`). Never commit to `main`/`develop` directly.

**Quality gate (run before every commit that touches code):**
```bash
npm run typecheck && npm run build && npm test && npm run lint
```

---

## Task 0: Verify starting state

**Step 1:** Confirm branch and clean tree.
Run: `git rev-parse --abbrev-ref HEAD && git status --porcelain`
Expected: `feature/scaffold-mcp` and only the untracked/committed design docs (no stray files).

**Step 2:** Confirm Node version.
Run: `node --version`
Expected: `v20.x` or higher. If lower, stop and tell the user.

---

## Task 1: Base project tooling (package.json, tsconfig, biome, tsup, vitest, gitignore)

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `tsup.config.ts`, `vitest.config.ts`, `.gitignore`, `.npmrc`
- Create: `src/index.ts` (temporary stub so build/typecheck have an entry)

**Step 1: Create `.gitignore`**
```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
.env.*
!.env.example
```

**Step 2: Create `package.json`** (deps are added by install commands in Step 4 — leave them empty here)
```json
{
  "name": "better-unraid-mcp",
  "version": "0.1.0",
  "description": "A complete, maintained Model Context Protocol server for the Unraid GraphQL API.",
  "license": "MIT",
  "author": "Matt White (mswdev)",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "better-unraid-mcp": "dist/index.js" },
  "files": ["dist", "schema"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome check --write .",
    "generate": "graphql-codegen --config codegen.ts",
    "schema:update": "curl -fsSL https://raw.githubusercontent.com/unraid/api/main/api/generated-schema.graphql -o schema/unraid.graphql",
    "prepare": "npm run build",
    "prepublishOnly": "npm run typecheck && npm run build && npm test && npm run lint"
  }
}
```

**Step 3: Create config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "codegen.ts", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

`biome.json` (v1.9 schema — matches the Mealie stack; v2 bump is future work):
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double" } },
  "files": { "ignore": ["dist", "node_modules", "coverage", "src/types/unraid/**"] }
}
```

`.npmrc`:
```
save-exact=false
```

`src/index.ts` (temporary stub, replaced in Task 9):
```ts
export {};
```

**Step 4: Install dependencies**
Run:
```bash
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^3.25.0 pino@^9 graphql@^16 @graphql-typed-document-node/core@^3.2.0 undici@^6
npm install -D typescript@^5 tsup@^8 tsx@^4 vitest@^3 @types/node@^22 @biomejs/biome@^1.9.4 @graphql-codegen/cli@latest @graphql-codegen/typescript@latest @graphql-codegen/typescript-operations@latest @graphql-codegen/typed-document-node@latest
```
Expected: installs succeed; `package.json` now lists resolved versions; `package-lock.json` created.

**Step 5: Verify tooling runs**
Run: `npm run typecheck && npm run build && npm run lint`
Expected: typecheck passes (stub), tsup emits `dist/index.js` with a `#!/usr/bin/env node` first line, biome reports no errors (it may auto-format the configs — if so run `npm run format` then re-run lint).

**Step 6: Commit**
```bash
git add -A
git commit -m "chore: scaffold project tooling (ts, tsup, biome, vitest)"
```

---

## Task 2: Vendor the Unraid schema and wire graphql-codegen

**Files:**
- Create: `schema/unraid.graphql` (vendored SDL)
- Create: `codegen.ts`
- Create: `src/tools/system/get-system-info.graphql` (first operation — needed so codegen's documents glob is non-empty)
- Generated: `src/types/unraid/graphql.ts` (committed)

**Step 1: Vendor the schema**
Run: `mkdir -p schema && npm run schema:update`
Expected: `schema/unraid.graphql` exists, ~3,700 lines. Add a provenance note at the very top of the file (above `# This file was generated...` if present):
```graphql
# Vendored from https://github.com/unraid/api (api/generated-schema.graphql).
# DO NOT EDIT BY HAND. Refresh with `npm run schema:update`.
```

**Step 2: Create the first operation** `src/tools/system/get-system-info.graphql`:
```graphql
query GetSystemInfo {
  info {
    time
    os {
      platform
      distro
      release
      kernel
      uptime
      hostname
    }
    cpu {
      manufacturer
      brand
      cores
      threads
    }
  }
}
```

**Step 3: Create `codegen.ts`**
```ts
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
```

**Step 4: Generate types**
Run: `npm run generate`
Expected: `src/types/unraid/graphql.ts` created, exporting `GetSystemInfoQuery`, `GetSystemInfoQueryVariables`, and `GetSystemInfoDocument: TypedDocumentNode<GetSystemInfoQuery, GetSystemInfoQueryVariables>`.

**Step 5: Add a banner to the generated file** — prepend:
```ts
/* eslint-disable */
// GENERATED by graphql-codegen. DO NOT EDIT. Run `npm run generate` to refresh.
```
(graphql-codegen normally adds its own banner; only add this if missing.)

**Step 6: Verify it typechecks**
Run: `npm run typecheck`
Expected: passes (the generated file imports only `@graphql-typed-document-node/core` / `graphql` — no `.js`-extension issues).

**Step 7: Commit**
```bash
git add schema/ codegen.ts src/tools/system/get-system-info.graphql src/types/unraid/
git commit -m "feat(graphql): vendor Unraid SDL and generate typed documents"
```

---

## Task 3: Environment config (zod)

**Files:**
- Create: `src/config/env.ts`
- Test: `src/config/env.test.ts`

**Step 1: Write the failing test** `src/config/env.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

const valid = {
  UNRAID_API_URL: "https://tower.local/graphql",
  UNRAID_API_KEY: "secret-key",
};

describe("loadEnv", () => {
  it("parses a valid environment with defaults applied", () => {
    const env = loadEnv(valid);

    expect(env.UNRAID_API_URL).toBe("https://tower.local/graphql");
    expect(env.MCP_TRANSPORT).toBe("stdio");
    expect(env.MCP_HTTP_PORT).toBe(3000);
    expect(env.UNRAID_ALLOW_SELF_SIGNED).toBe(false);
  });

  it("coerces UNRAID_ALLOW_SELF_SIGNED to a boolean", () => {
    const env = loadEnv({ ...valid, UNRAID_ALLOW_SELF_SIGNED: "true" });

    expect(env.UNRAID_ALLOW_SELF_SIGNED).toBe(true);
  });

  it("throws a descriptive error when the API key is missing", () => {
    expect(() => loadEnv({ UNRAID_API_URL: valid.UNRAID_API_URL })).toThrow(/UNRAID_API_KEY/);
  });

  it("throws when the URL is not a valid URL", () => {
    expect(() => loadEnv({ ...valid, UNRAID_API_URL: "tower.local" })).toThrow(/UNRAID_API_URL/);
  });
});
```

**Step 2: Run to verify it fails**
Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — cannot resolve `./env.js`.

**Step 3: Implement** `src/config/env.ts`:
```ts
import { z } from "zod";

const TRANSPORTS = ["stdio", "http"] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const DEFAULT_HTTP_PORT = 3000;

const EnvSchema = z.object({
  UNRAID_API_URL: z.string().url(),
  UNRAID_API_KEY: z.string().min(1),
  MCP_TRANSPORT: z.enum(TRANSPORTS).default("stdio"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(DEFAULT_HTTP_PORT),
  UNRAID_ALLOW_SELF_SIGNED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

/** Validated server configuration. */
export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates and returns the server configuration, throwing a descriptive
 * error listing every invalid field. Fail-fast at startup.
 *
 * @param source - Raw environment record (defaults to `process.env`).
 * @returns The parsed, typed configuration.
 * @throws Error when any field is missing or invalid.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}
```

**Step 4: Run to verify it passes**
Run: `npx vitest run src/config/env.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**
```bash
git add src/config/
git commit -m "feat(config): add zod-validated environment loading"
```

---

## Task 4: GraphQL execution + UnraidClient (the network seam)

**Files:**
- Create: `src/graphql/execute.ts` (low-level fetch, injectable `fetchImpl`)
- Create: `src/graphql/client.ts` (`GraphQLExecutor` interface, `UnraidClient`, `UnraidApiError`)
- Test: `src/graphql/execute.test.ts`, `src/graphql/client.test.ts`

**Step 1: Write the failing test** `src/graphql/execute.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { executeGraphQL } from "./execute.js";

// Minimal typed document for the test (no extra deps — build it with `parse`).
const PingDoc = parse("query Ping { online }") as unknown as TypedDocumentNode<{ online: boolean }, never>;

function fakeFetch(status: number, body: unknown) {
  return async () =>
    ({ ok: status >= 200 && status < 300, status, statusText: "x", json: async () => body }) as Response;
}

describe("executeGraphQL", () => {
  it("returns parsed data on a 200 response", async () => {
    const res = await executeGraphQL(
      { endpoint: "http://x/graphql", apiKey: "k", fetchImpl: fakeFetch(200, { data: { online: true } }) },
      PingDoc,
    );

    expect(res.data?.online).toBe(true);
  });

  it("throws on a non-2xx response", async () => {
    await expect(
      executeGraphQL(
        { endpoint: "http://x/graphql", apiKey: "k", fetchImpl: fakeFetch(401, {}) },
        PingDoc,
      ),
    ).rejects.toThrow(/401/);
  });
});
```
> Implementation note: to avoid adding `graphql-tag`, the test may instead build the document with `import { parse } from "graphql"` and cast: `parse("query Ping { online }") as TypedDocumentNode<...>`. Pick one and keep it consistent; do **not** add a runtime dep just for tests.

**Step 2: Run to verify it fails**
Run: `npx vitest run src/graphql/execute.test.ts`
Expected: FAIL — cannot resolve `./execute.js`.

**Step 3: Implement** `src/graphql/execute.ts`:
```ts
import { print } from "graphql";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { Agent, fetch as undiciFetch } from "undici";

/** Subset of the fetch signature we depend on (lets tests inject a fake). */
export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<Response>;

/** Options for a single GraphQL request. */
export interface GraphQLExecuteOptions {
  endpoint: string;
  apiKey: string;
  allowSelfSigned?: boolean;
  fetchImpl?: FetchLike;
}

/** Raw GraphQL response envelope. */
export interface GraphQLResponse<TData> {
  data?: TData | null;
  errors?: Array<{ message: string }>;
}

const selfSignedDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

function defaultFetch(allowSelfSigned: boolean): FetchLike {
  return (url, init) =>
    undiciFetch(url, {
      ...init,
      dispatcher: allowSelfSigned ? selfSignedDispatcher : undefined,
    }) as unknown as Promise<Response>;
}

/**
 * POSTs a typed GraphQL operation to the Unraid endpoint over native fetch.
 *
 * @param options - Endpoint, API key, TLS and fetch overrides.
 * @param document - A typed-document-node operation.
 * @param variables - Operation variables, if any.
 * @returns The raw GraphQL response envelope (`data` and/or `errors`).
 * @throws Error when the HTTP response is not 2xx.
 */
export async function executeGraphQL<TData, TVariables>(
  options: GraphQLExecuteOptions,
  document: TypedDocumentNode<TData, TVariables>,
  variables?: TVariables,
): Promise<GraphQLResponse<TData>> {
  const doFetch = options.fetchImpl ?? defaultFetch(options.allowSelfSigned ?? false);
  const response = await doFetch(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": options.apiKey },
    body: JSON.stringify({ query: print(document), variables: variables ?? undefined }),
  });
  if (!response.ok) {
    throw new Error(`Unraid API HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as GraphQLResponse<TData>;
}
```

**Step 4: Run to verify it passes**
Run: `npx vitest run src/graphql/execute.test.ts`
Expected: PASS.

**Step 5: Write the failing test** `src/graphql/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { parse } from "graphql";
import { UnraidClient, UnraidApiError } from "./client.js";

const PingDoc = parse("query Ping { online }") as unknown as TypedDocumentNode<{ online: boolean }, never>;

function clientWith(body: unknown) {
  return new UnraidClient({
    endpoint: "http://x/graphql",
    apiKey: "k",
    allowSelfSigned: false,
    fetchImpl: async () => ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response,
  });
}

describe("UnraidClient.execute", () => {
  it("returns data when the response has no errors", async () => {
    const data = await clientWith({ data: { online: true } }).execute(PingDoc);

    expect(data.online).toBe(true);
  });

  it("throws UnraidApiError when the response contains GraphQL errors", async () => {
    const client = clientWith({ errors: [{ message: "forbidden" }] });

    await expect(client.execute(PingDoc)).rejects.toThrow(UnraidApiError);
  });
});
```

**Step 6: Run to verify it fails**
Run: `npx vitest run src/graphql/client.test.ts`
Expected: FAIL — cannot resolve `./client.js`.

**Step 7: Implement** `src/graphql/client.ts`:
```ts
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { executeGraphQL, type FetchLike } from "./execute.js";

/** Anything that can run a typed Unraid operation. Tools depend on this. */
export interface GraphQLExecutor {
  execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData>;
}

/** Raised when the Unraid API returns GraphQL errors or no data. */
export class UnraidApiError extends Error {}

/** Configuration for a live Unraid GraphQL client. */
export interface UnraidClientConfig {
  endpoint: string;
  apiKey: string;
  allowSelfSigned: boolean;
  fetchImpl?: FetchLike;
}

/** Live client that executes typed operations against an Unraid server. */
export class UnraidClient implements GraphQLExecutor {
  constructor(private readonly config: UnraidClientConfig) {}

  /**
   * Executes a typed operation and returns its data.
   *
   * @param document - A typed-document-node operation.
   * @param variables - Operation variables, if any.
   * @returns The typed `data` payload.
   * @throws UnraidApiError when the response has errors or null data.
   */
  async execute<TData, TVariables>(
    document: TypedDocumentNode<TData, TVariables>,
    variables?: TVariables,
  ): Promise<TData> {
    const response = await executeGraphQL(this.config, document, variables);
    if (response.errors?.length) {
      throw new UnraidApiError(response.errors.map((error) => error.message).join("; "));
    }
    if (response.data == null) {
      throw new UnraidApiError("Unraid API returned no data");
    }
    return response.data;
  }
}
```

**Step 8: Run to verify it passes**
Run: `npx vitest run src/graphql/`
Expected: PASS (all graphql tests).

**Step 9: Commit**
```bash
git add src/graphql/
git commit -m "feat(graphql): add native-fetch executor and UnraidClient seam"
```

---

## Task 5: Shared tool helpers (response formatting + confirm gate)

**Files:**
- Create: `src/tools/_shared/test-support.ts` (typed helper for reading text blocks in tests)
- Create: `src/tools/_shared/respond.ts`, `src/tools/_shared/confirm.ts`
- Test: `src/tools/_shared/respond.test.ts`, `src/tools/_shared/confirm.test.ts`

**Step 0: Create the test helper** `src/tools/_shared/test-support.ts` (the SDK's `content` is a union, so reading `.text` needs narrowing — this keeps `tsc --noEmit` over test files green):
```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Returns the text of the first content block, asserting it is a text block. */
export function firstText(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected a text content block");
  }
  return block.text;
}
```

**Step 1: Write failing tests** `src/tools/_shared/respond.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatResponse, toolError } from "./respond.js";
import { firstText } from "./test-support.js";

describe("formatResponse", () => {
  it("returns the concise string for the concise format", () => {
    const result = formatResponse("concise", "short summary", { a: 1 });

    expect(firstText(result)).toBe("short summary");
    expect(result.isError).toBeUndefined();
  });

  it("returns pretty JSON for the detailed format", () => {
    const result = formatResponse("detailed", "short summary", { a: 1 });

    expect(firstText(result)).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
});

describe("toolError", () => {
  it("marks the result as an error", () => {
    const result = toolError("boom");

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("boom");
  });
});
```

**Step 2: Run to verify it fails**
Run: `npx vitest run src/tools/_shared/respond.test.ts`
Expected: FAIL — cannot resolve `./respond.js`.

**Step 3: Implement** `src/tools/_shared/respond.ts`:
```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** How verbose a tool response should be. */
export type ResponseFormat = "concise" | "detailed";

/** Wraps plain text as a successful tool result. */
export function toolText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Wraps a message as an error tool result (sets `isError`). */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Formats a tool response, returning a human summary for `concise` and
 * pretty-printed JSON for `detailed`.
 *
 * @param format - Requested verbosity.
 * @param concise - Pre-built one-line/short human summary.
 * @param detailed - The full structured payload.
 * @returns A successful tool result.
 */
export function formatResponse(
  format: ResponseFormat,
  concise: string,
  detailed: unknown,
): CallToolResult {
  if (format === "detailed") {
    return toolText(JSON.stringify(detailed, null, 2));
  }
  return toolText(concise);
}
```

**Step 4: Run to verify it passes**
Run: `npx vitest run src/tools/_shared/respond.test.ts`
Expected: PASS.

**Step 5: Write failing test** `src/tools/_shared/confirm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { requireConfirmation } from "./confirm.js";
import { firstText } from "./test-support.js";

describe("requireConfirmation", () => {
  it("returns null when confirm is true", () => {
    expect(requireConfirmation(true, "stop the array")).toBeNull();
  });

  it("returns an error result when confirm is not true", () => {
    const result = requireConfirmation(undefined, "stop the array");

    expect(result).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by the assertion above.
    expect(result!.isError).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: guarded by the assertion above.
    expect(firstText(result!)).toMatch(/destructive/i);
  });
});
```

**Step 6: Run to verify it fails**
Run: `npx vitest run src/tools/_shared/confirm.test.ts`
Expected: FAIL.

**Step 7: Implement** `src/tools/_shared/confirm.ts`:
```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolError } from "./respond.js";

/**
 * Gate for destructive operations. Returns `null` when the caller explicitly
 * confirmed; otherwise returns an error result and the caller must abort.
 *
 * @param confirm - The tool's `confirm` argument.
 * @param actionDescription - Human description of the destructive action.
 * @returns `null` to proceed, or an error `CallToolResult` to return as-is.
 */
export function requireConfirmation(
  confirm: boolean | undefined,
  actionDescription: string,
): CallToolResult | null {
  if (confirm === true) {
    return null;
  }
  return toolError(
    `Refusing to ${actionDescription}: this is a destructive action. Re-call with "confirm": true to proceed. No changes were made.`,
  );
}
```

**Step 8: Run to verify it passes**
Run: `npx vitest run src/tools/_shared/`
Expected: PASS.

**Step 9: Commit**
```bash
git add src/tools/_shared/
git commit -m "feat(tools): add shared response-format and confirm-gate helpers"
```

---

## Task 6: The `get_system_info` PoC tool

**Files:**
- Create: `src/tools/system/get-system-info.ts`
- Test: `src/tools/system/get-system-info.test.ts`

**Step 1: Write the failing test** `src/tools/system/get-system-info.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { createGetSystemInfoHandler } from "./get-system-info.js";
import type { GetSystemInfoQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";

const sample = {
  info: {
    time: "2026-05-31T00:00:00Z",
    os: {
      platform: "linux",
      distro: "Unraid",
      release: "7.2.0",
      kernel: "6.6.0",
      uptime: "2026-05-20T00:00:00Z",
      hostname: "tower",
    },
    cpu: { manufacturer: "AMD", brand: "Ryzen 9 5950X", cores: 16, threads: 32 },
  },
} as unknown as GetSystemInfoQuery;

function fakeExecutor(result: GetSystemInfoQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

function throwingExecutor(message: string): GraphQLExecutor {
  return {
    execute: async () => {
      throw new Error(message);
    },
  };
}

describe("get_system_info handler", () => {
  it("returns a concise summary mentioning the distro and CPU", async () => {
    const handler = createGetSystemInfoHandler(fakeExecutor(sample));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Unraid/);
    expect(firstText(result)).toMatch(/Ryzen 9 5950X/);
  });

  it("returns full JSON for the detailed format", async () => {
    const handler = createGetSystemInfoHandler(fakeExecutor(sample));

    const result = await handler({ response_format: "detailed" });

    expect(firstText(result)).toContain("\"kernel\": \"6.6.0\"");
  });

  it("returns an error result when the client throws", async () => {
    const handler = createGetSystemInfoHandler(throwingExecutor("unauthorized"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/unauthorized/);
  });
});
```

**Step 2: Run to verify it fails**
Run: `npx vitest run src/tools/system/get-system-info.test.ts`
Expected: FAIL — cannot resolve `./get-system-info.js`.

**Step 3: Implement** `src/tools/system/get-system-info.ts`:
```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { GetSystemInfoDocument, type GetSystemInfoQuery } from "../../types/unraid/graphql.js";
import { formatResponse, toolError, type ResponseFormat } from "../_shared/respond.js";

const TOOL_NAME = "get_system_info";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Builds a one-line human summary of the system info payload. */
function summarize(data: GetSystemInfoQuery): string {
  const { os, cpu } = data.info;
  const osPart = `${os.distro ?? "Unraid"} ${os.release ?? ""}`.trim();
  const cpuPart = `${cpu.brand ?? cpu.manufacturer ?? "CPU"} (${cpu.cores ?? "?"}C/${cpu.threads ?? "?"}T)`;
  return `${osPart}, kernel ${os.kernel ?? "?"}, host ${os.hostname ?? "?"}. ${cpuPart}.`;
}

/**
 * Creates the `get_system_info` handler bound to a GraphQL executor.
 * Exposed separately from registration so it can be unit-tested directly.
 */
export function createGetSystemInfoHandler(client: GraphQLExecutor) {
  return async ({ response_format }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(GetSystemInfoDocument);
      return formatResponse(response_format, summarize(data), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch system info: ${message}`);
    }
  };
}

/** Registers the read-only `get_system_info` tool on the server. */
export function registerGetSystemInfo(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Unraid System Info",
      description:
        "Read-only. Returns the Unraid server's OS, distro, release, kernel, uptime, hostname, and a CPU summary.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createGetSystemInfoHandler(client),
  );
}
```

**Step 4: Run to verify it passes**
Run: `npx vitest run src/tools/system/get-system-info.test.ts`
Expected: PASS (3 tests).

**Step 5: Typecheck** (catches any mismatch between the generated `GetSystemInfoQuery` shape and `summarize`)
Run: `npm run typecheck`
Expected: passes. If the generated field types are `string | null | undefined`, the `?? "?"` guards already handle it.

**Step 6: Commit**
```bash
git add src/tools/system/
git commit -m "feat(tools): add read-only get_system_info proof-of-concept tool"
```

---

## Task 7: Tool registry + server factory

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/server.ts`
- Create: `src/version.ts`
- Test: `src/tools/registry.test.ts`

**Step 1: Write the failing test** `src/tools/registry.test.ts` (uses a fake server that records registrations):
```ts
import { describe, it, expect } from "vitest";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerAllTools } from "./registry.js";

function fakeServer() {
  const names: string[] = [];
  return {
    names,
    server: {
      registerTool: (name: string) => {
        names.push(name);
      },
    },
  };
}

const noopClient: GraphQLExecutor = { execute: async () => ({}) as never };

describe("registerAllTools", () => {
  it("registers get_system_info", () => {
    const { server, names } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    expect(names).toContain("get_system_info");
  });
});
```

**Step 2: Run to verify it fails**
Run: `npx vitest run src/tools/registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js`.

**Step 3: Implement** `src/version.ts`:
```ts
/** Server version reported to MCP clients. Keep in sync with package.json. */
export const SERVER_VERSION = "0.1.0";
```

`src/tools/registry.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerGetSystemInfo } from "./system/get-system-info.js";

/**
 * Registers every tool on the server. New tools are added here as the API
 * surface grows — one `register*` call per tool module.
 */
export function registerAllTools(server: McpServer, client: GraphQLExecutor): void {
  registerGetSystemInfo(server, client);
}
```

`src/server.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLExecutor } from "./graphql/client.js";
import { registerAllTools } from "./tools/registry.js";
import { SERVER_VERSION } from "./version.js";

/**
 * Builds a fully-configured MCP server bound to a GraphQL executor.
 * Called once for stdio, and once per request for stateless HTTP.
 */
export function buildServer(client: GraphQLExecutor): McpServer {
  const server = new McpServer({ name: "better-unraid-mcp", version: SERVER_VERSION });
  registerAllTools(server, client);
  return server;
}
```

**Step 4: Run to verify it passes**
Run: `npx vitest run src/tools/registry.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/tools/registry.ts src/server.ts src/version.ts src/tools/registry.test.ts
git commit -m "feat(server): add tool registry and server factory"
```

---

## Task 8: Logging + transports + entrypoint

**Files:**
- Create: `src/logging.ts`
- Create: `src/transport/stdio.ts`, `src/transport/http.ts`
- Replace: `src/index.ts`

**Step 1: Implement** `src/logging.ts` (pino → stderr; critical for stdio):
```ts
import pino, { type Logger } from "pino";

const STDERR_FD = 2;

/**
 * Creates a structured logger that writes to stderr only. stdout is reserved
 * for the MCP stdio transport — logging there would corrupt the protocol.
 */
export function createLogger(level: string): Logger {
  return pino({ level }, pino.destination(STDERR_FD));
}
```

**Step 2: Implement** `src/transport/stdio.ts`:
```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";

/** Connects the server over stdio (the universal local transport). */
export async function startStdio(server: McpServer, logger: Logger): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("better-unraid-mcp ready (stdio transport)");
}
```

**Step 3: Implement** `src/transport/http.ts` (stateless Streamable HTTP over `node:http`, no express dep):
```ts
import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";

const MCP_PATH = "/mcp";
const NOT_FOUND = 404;

/** Reads and JSON-parses a request body. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

/**
 * Starts a stateless Streamable HTTP server. Each POST /mcp builds a fresh
 * server + transport (no session state) and returns a single JSON response.
 */
export async function startHttp(
  buildServer: () => McpServer,
  port: number,
  logger: Logger,
): Promise<void> {
  const httpServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== MCP_PATH) {
      response.writeHead(NOT_FOUND).end();
      return;
    }
    const body = await readJsonBody(request);
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  });
  httpServer.listen(port, () => logger.info(`better-unraid-mcp ready (http transport on :${port}${MCP_PATH})`));
}
```
> Note: `readJsonBody` + the handler keep nesting ≤2 and the handler body short. If biome/lint flags complexity, extract the request-guard into a named helper.

**Step 4: Replace** `src/index.ts`:
```ts
import { loadEnv } from "./config/env.js";
import { UnraidClient } from "./graphql/client.js";
import { createLogger } from "./logging.js";
import { buildServer } from "./server.js";
import { startHttp } from "./transport/http.js";
import { startStdio } from "./transport/stdio.js";

/** Wires config → client → server → transport and starts the MCP server. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const client = new UnraidClient({
    endpoint: env.UNRAID_API_URL,
    apiKey: env.UNRAID_API_KEY,
    allowSelfSigned: env.UNRAID_ALLOW_SELF_SIGNED,
  });

  if (env.MCP_TRANSPORT === "http") {
    await startHttp(() => buildServer(client), env.MCP_HTTP_PORT, logger);
    return;
  }
  await startStdio(buildServer(client), logger);
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
```

**Step 5: Full gate**
Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all pass; `dist/index.js` emitted with shebang.

**Step 6: Manual smoke test (stdio)** — verify the server lists the tool over a real stdio handshake:
```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | UNRAID_API_URL=https://example.invalid/graphql UNRAID_API_KEY=dummy node dist/index.js
```
Expected: JSON responses on stdout; the `tools/list` result includes `get_system_info` with its annotations. (No Unraid server is contacted — listing tools doesn't call the API.) Logs appear on stderr, not stdout.

**Step 7: Commit**
```bash
git add src/logging.ts src/transport/ src/index.ts
git commit -m "feat(server): add stderr logging, stdio + stateless http transports, entrypoint"
```

---

## Task 9: Port and customize the LLM agent kit

**Files:**
- Create: `.claude/CLAUDE.md`, `.claude/rules/{code-style,testing,security,file-organization}.md`
- Create: `AGENTS.md` (symlink → `.claude/CLAUDE.md`)

**Step 1: Clone the kit for reference**
Run: `gh repo clone mswdev/llm-agent-kit /tmp/llm-agent-kit-port -- --depth 1`

**Step 2: Copy the four rule files verbatim, then edit:**
```bash
mkdir -p .claude/rules
cp /tmp/llm-agent-kit-port/.claude/rules/{code-style,testing,security,file-organization}.md .claude/rules/
```
- `code-style.md`: under "Linting", replace the commented examples with: `Biome — run \`npm run lint\` (check) and \`npm run format\` (write). Config in \`biome.json\`.`
- `security.md`: **remove** the "ALL MONETARY VALUES ARE IN CENTS" bullet. **Add** an Unraid "No-Touch Zones" list:
  - `schema/unraid.graphql` — vendored SDL, regenerate via `npm run schema:update`, never hand-edit.
  - `src/types/unraid/**` — generated, never hand-edit (run `npm run generate`).
  - Never log `UNRAID_API_KEY` or include it in tool output/errors.
  - Never execute a destructive GraphQL mutation without the `requireConfirmation` gate.
- `testing.md`: change the quality-gate command to `npm run typecheck && npm run build && npm test && npm run lint`.
- `file-organization.md`: leave as-is (the 10-file cap stands; `tools/<domain>/` subdirectories are the scaling mechanism).

**Step 3: Create `.claude/CLAUDE.md`** — start from the kit's file but **drop §6 Figma-to-Code entirely** and **do not** copy `tailwind-plus-components.md`. Fill placeholders:
- Owner: Matt White (mswdev). Product: "better-unraid-mcp — a Model Context Protocol server exposing the Unraid GraphQL API." Repo: single-package TS MCP.
- §1 Project Overview: add an Unraid domain-terms table: **array** (the protected disk set), **parity** (redundancy disk), **share** (user share / disk share), **cache pool** (fast pool), **mover** (cache→array migration), **Docker** (containers), **VM** (libvirt VMs), **flash** (the USB boot device). Note the API is GraphQL at `/graphql`, auth via `x-api-key`.
- §4 Infrastructure table: Unraid GraphQL API (data source), npm registry (distribution), GitHub Actions (CI/assistants).
- §5 Git Workflow: branches off `develop`; **always draft PRs into `develop`**; never commit to `main`/`develop`.
- Keep the "Quick Reference" rule links pointing at `.claude/rules/*`.
- Remove the Component Resolution Order subsection (frontend-only).

**Step 4: Create the `AGENTS.md` symlink (Codex mirror)**
Run: `ln -s .claude/CLAUDE.md AGENTS.md`
Verify: `readlink AGENTS.md` → `.claude/CLAUDE.md`.

**Step 5: Sanity check** there are no Tailwind/Figma references left:
Run: `grep -ri "tailwind\|figma" .claude AGENTS.md || echo "clean"`
Expected: `clean`.

**Step 6: Commit**
```bash
git add .claude/ AGENTS.md
git commit -m "docs: port and customize LLM agent kit for Unraid MCP"
```

---

## Task 10: Port GitHub workflows + add CI

**Files:**
- Create: `.github/workflows/{claude,claude-review,openai-assistant,openai-review,ci}.yml`
- Create: `.github/actions/claude-stats/action.yml`
- Create: `.github/prompts/review.md`

**Step 1: Copy the kit's `.github` assets verbatim:**
```bash
mkdir -p .github/workflows .github/actions .github/prompts
cp /tmp/llm-agent-kit-port/.github/workflows/{claude,claude-review,openai-assistant,openai-review}.yml .github/workflows/
cp -r /tmp/llm-agent-kit-port/.github/actions/claude-stats .github/actions/
cp /tmp/llm-agent-kit-port/.github/prompts/review.md .github/prompts/
```

**Step 2:** In `.github/prompts/review.md`, leave the package-specific rules section empty/commented (single package, no extra rule files yet).

**Step 3: Create `.github/workflows/ci.yml`** (the one addition beyond the kit):
```yaml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  build-test-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Verify generated types are up to date
        run: |
          npm run generate
          git diff --exit-code src/types/unraid/ \
            || (echo "::error::Generated types are stale. Run 'npm run generate' and commit." && exit 1)
      - run: npm run typecheck
      - run: npm run build
      - run: npm test
      - run: npm run lint
```

**Step 4:** (Optional, recommended) Bump the `--model` / `model:` values in `claude.yml` and `claude-review.yml` to a current model if the user wants; otherwise leave the kit defaults. Note this to the user rather than guessing.

**Step 5: Validate workflow YAML**
Run: `for f in .github/workflows/*.yml; do echo "== $f =="; python3 -c "import yaml,sys; yaml.safe_load(open('$f'))" && echo ok; done`
Expected: every file prints `ok`.

**Step 6: Commit**
```bash
git add .github/
git commit -m "ci: port agent-kit workflows and add build/test/lint CI"
```

---

## Task 11: README + `.env.example`

**Files:**
- Replace: `README.md`
- Create: `.env.example`

**Step 1: Create `.env.example`:**
```
# Full Unraid GraphQL endpoint, including /graphql
UNRAID_API_URL=https://tower.local/graphql
# API key from Settings -> Management Access -> API Keys (or `unraid-api apikey --create`)
UNRAID_API_KEY=replace-me
# stdio (default, for local clients) or http (for remote/hosted clients)
MCP_TRANSPORT=stdio
# Port for http transport
MCP_HTTP_PORT=3000
# Set true only if your Unraid server uses a self-signed TLS cert on the LAN
UNRAID_ALLOW_SELF_SIGNED=false
LOG_LEVEL=info
```

**Step 2: Write `README.md`** covering, in order:
1. One-paragraph intro: complete, maintained MCP for the Unraid GraphQL API; works with any MCP client.
2. **Status:** scaffold + one tool (`get_system_info`); full API coverage is in progress.
3. **Requirements:** Unraid 7.2+ (or Connect plugin), an API key, Node ≥20 (only if running from source; `npx` needs none beyond Node).
4. **Get an API key:** Settings → Management Access → API Keys, or `unraid-api apikey --create`.
5. **Install / run:** `npx better-unraid-mcp` with the env vars above.
6. **Client config** — copy-paste blocks for:
   - **Claude Desktop** (`claude_desktop_config.json` `mcpServers` entry with `command: "npx"`, `args: ["-y","better-unraid-mcp"]`, `env: {...}`).
   - **Claude Code** (`claude mcp add better-unraid -- npx -y better-unraid-mcp`, plus how to pass env).
   - **Codex** and **Gemini CLI** (their MCP config stanzas, stdio command form).
7. **Remote / HTTP transport:** set `MCP_TRANSPORT=http`; endpoint is `POST http://host:3000/mcp`.
8. **ChatGPT caveat (be explicit, don't over-promise):** ChatGPT connectors require the MCP server to be reachable from OpenAI's cloud. A LAN Unraid box is not, unless you self-host/tunnel the HTTP transport (e.g. behind a reverse proxy with auth). stdio + HTTP both ship; cloud reachability is the user's responsibility.
9. **Security note:** the API key grants server control — scope it, never commit it.
10. **Development:** clone, `npm install`, `npm run generate`, the quality gate, and the contribution workflow (feature branch off `develop` → draft PR).
11. **License:** MIT.

**Step 3: Verify links/blocks** render (skim the markdown). No build step.

**Step 4: Commit**
```bash
git add README.md .env.example
git commit -m "docs: add README with per-client install and ChatGPT caveat"
```

---

## Task 12: Final verification + draft PR

**Step 1: Full gate from a clean install**
Run:
```bash
rm -rf node_modules dist
npm ci
npm run generate && git diff --exit-code src/types/unraid/
npm run typecheck && npm run build && npm test && npm run lint
```
Expected: everything passes; generated types unchanged.

**Step 2: Confirm the package would publish cleanly (dry run)**
Run: `npm pack --dry-run`
Expected: the tarball includes `dist/**` and `schema/**` only (per `files`), plus `package.json`, `README.md`, `LICENSE`.

**Step 3: Push the branch**
Run: `git push -u origin feature/scaffold-mcp`

**Step 4: Open a DRAFT PR into `develop`**
Run:
```bash
gh pr create --draft --base develop --head feature/scaffold-mcp \
  --title "Scaffold better-unraid-mcp (PR #1)" \
  --body "Scaffolds the MCP server framework, GraphQL type-gen pipeline, the read-only get_system_info proof-of-concept tool, ported LLM agent kit, CI, and install docs. See docs/plans/2026-05-31-scaffold-mcp-design.md. Out of scope: the rest of the Unraid API surface (future PRs)."
```
Expected: a draft PR is created targeting `develop`.

**Step 5: Report** the PR URL and the green quality-gate output to the user.

---

## Notes / decisions baked in

- **Pinned to stable `@modelcontextprotocol/sdk` v1.29**, not the v2.0.0-alpha. Imports: `server/mcp.js`, `server/stdio.js`, `server/streamableHttp.js`, `types.js`. (`@modelcontextprotocol/node` / `@modelcontextprotocol/express` / `NodeStreamableHTTPServerTransport` are v2-only — do not use.)
- **No GraphQL client dependency** and **no express dependency** — native `undici` fetch + `print()`, and `node:http` for the HTTP transport. `undici` is used directly only to type the scoped self-signed TLS dispatcher.
- **graphql-codegen emits a single committed file** via `typescript` + `typescript-operations` + `typed-document-node` (not `client-preset`) — simpler, NodeNext-clean, native-fetch-friendly, mirrors Mealie's single committed type file.
- **`defaultScalarType: "unknown"`** keeps the "no `any`" rule intact for unmapped scalars.
- **Tools are tested through the `GraphQLExecutor` seam** with hand-written fakes; the only un-unit-tested code is the network/HTTP boundary, smoke-tested manually.
```
