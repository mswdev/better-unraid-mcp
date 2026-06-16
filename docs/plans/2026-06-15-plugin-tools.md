# Plugins Domain Tools — Implementation Plan (PR #9)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This repo builds via the Workflow tool (sequential TDD agents emitting RESULT markers + an independent verify agent); each task below is one such unit.

**Goal:** Add three MCP tools over the Unraid plugins surface — `plugin_list` (read), `plugin_add` and `plugin_remove` (confirm-gated api-plugin lifecycle) — source-validated against `unraid/api @ 264ddf0` (NOT live-verified).

**Architecture:** Mirror the established per-tool pattern: a `.graphql` operation file → committed codegen types → a `create*Handler(client)` factory + `register*(server, client)` wired in `registry.ts`, tested hermetically through the `GraphQLExecutor` seam with `satisfies` fixtures. `plugin_add`/`plugin_remove` reuse `requireConfirmation` and a shared `_shared.ts` (the `NAMES_SPEC` registry-name allowlist + report helpers). See the design doc `docs/plans/2026-06-15-plugin-tools-design.md` (revision 1) for the validated rationale.

**Tech Stack:** TypeScript (NodeNext, `.js` imports), MCP SDK v1.29, zod, graphql-codegen (`typescript-operations` + `typed-document-node`), vitest, Biome.

**Branch:** `feature/plugin-tools` (already created off `develop`).

**Conventions (hard rules):** no `any`; ≤25-line methods; ≤2 nesting levels; early returns; JSDoc on every export incl. `@returns` on `register*`; named constants (no magic numbers/strings); one export-per-file for the tool/handler; `satisfies <Op>Query/Mutation` on every fixture so codegen drift breaks the build.

**Quality gate (run before every commit):** `npm run typecheck && npm run build && npm test && npm run lint`.

---

## Task 0: GraphQL operations + regenerate types

**Files:**
- Create: `src/tools/plugin/plugin-list.graphql`
- Create: `src/tools/plugin/plugin-add.graphql`
- Create: `src/tools/plugin/plugin-remove.graphql`
- Modify (generated): `src/types/unraid/graphql.ts`

**Step 1: Write the three operation files**

`src/tools/plugin/plugin-list.graphql`:
```graphql
query PluginList {
  plugins {
    name
    version
    hasApiModule
    hasCliModule
  }
  installedUnraidPlugins
}
```

`src/tools/plugin/plugin-add.graphql`:
```graphql
mutation PluginAdd($input: PluginManagementInput!) {
  addPlugin(input: $input)
}
```

`src/tools/plugin/plugin-remove.graphql`:
```graphql
mutation PluginRemove($input: PluginManagementInput!) {
  removePlugin(input: $input)
}
```

**Step 2: Regenerate the committed types**

Run: `npm run generate`
Expected: `src/types/unraid/graphql.ts` now exports `PluginListDocument`, `PluginListQuery`, `PluginAddDocument`, `PluginAddMutation`, `PluginRemoveDocument`, `PluginRemoveMutation`, and a `PluginManagementInput` shape (with `bundled`/`restart` optional via their SDL defaults).

**Step 3: Verify codegen is idempotent and the tree typechecks**

Run: `npm run generate && git diff --exit-code src/types/unraid/graphql.ts && npm run typecheck`
Expected: no diff on the second generate; typecheck passes.

**Step 4: Commit**

```bash
git add src/tools/plugin/*.graphql src/types/unraid/graphql.ts
git commit -m "feat(plugin): add plugin list/add/remove GraphQL operations + codegen"
```

---

## Task 1: `_shared.ts` — names allowlist + report helpers

**Files:**
- Create: `src/tools/plugin/_shared.ts`
- Test: `src/tools/plugin/_shared.test.ts`

**Step 1: Write the failing tests**

`src/tools/plugin/_shared.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { NAMES_SPEC, firstInvalidName, invalidNameError, restartReport } from "./_shared.js";

describe("NAMES_SPEC / firstInvalidName", () => {
  it("accepts bare and scoped package names", () => {
    expect(firstInvalidName(["lodash", "@unraid/shared", "unraid-api-plugin-connect"])).toBeNull();
  });

  it("rejects version suffixes (breaks the remove round-trip)", () => {
    expect(firstInvalidName(["foo@1.2.3"])).toBe("foo@1.2.3");
    expect(firstInvalidName(["foo@latest"])).toBe("foo@latest");
  });

  it("rejects URLs, git refs, paths, and user/repo shorthand", () => {
    for (const bad of [
      "git+https://e/x",
      "https://e/x.tgz",
      "file:/x",
      "/abs/path",
      "./rel",
      "user/repo",
    ]) {
      expect(firstInvalidName([bad])).toBe(bad);
    }
  });

  it("returns the first offending entry, scanning in order", () => {
    expect(firstInvalidName(["ok", "git+https://e/x", "also-ok"])).toBe("git+https://e/x");
  });

  it("matches NAMES_SPEC directly for a bare name", () => {
    expect(NAMES_SPEC.test("unraid-api-plugin-connect")).toBe(true);
  });
});

describe("invalidNameError / restartReport", () => {
  it("names the rejected entry and the action", () => {
    expect(invalidNameError("add", "git+https://e/x")).toMatch(/Refusing to add "git\+https:\/\/e\/x"/);
    expect(invalidNameError("add", "x")).toMatch(/No changes were made/);
  });

  it("reports an auto-restart when no manual restart is required", () => {
    expect(restartReport("add", ["a", "b"], false)).toBe(
      "Add of a, b submitted; the Unraid API is restarting to apply it. Verify with plugin_list once it reconnects.",
    );
  });

  it("reports a required manual restart", () => {
    expect(restartReport("remove", ["a"], true)).toBe(
      "Remove of a submitted; a manual API restart is required to apply it. Verify with plugin_list after restarting.",
    );
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- src/tools/plugin/_shared.test.ts`
Expected: FAIL (module `./_shared.js` not found).

**Step 3: Write the implementation**

`src/tools/plugin/_shared.ts`:
```typescript
import { z } from "zod";
import type { ResponseFormat } from "../_shared/respond.js";

/**
 * Allowed form for a `names` entry: a bare or scoped npm package name with **no**
 * version suffix. `addPlugin` runs `npm i <name>` with lifecycle scripts enabled and
 * npm resolves any spec form (URL/git/tarball/path), so this allowlist confines
 * installs to named registry packages. The no-version rule also keeps
 * `plugin_list` ↔ `plugin_remove` composable: `removePlugin` exact-matches the
 * stored config string while `plugin_list` reports the parsed package name.
 * @see docs/plans/2026-06-15-plugin-tools-design.md
 */
export const NAMES_SPEC = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** Validated input shared by `plugin_add` and `plugin_remove`. */
export interface PluginNamesInput {
  response_format: ResponseFormat;
  names: string[];
  confirm?: boolean;
}

/** The zod input fields shared by `plugin_add` and `plugin_remove`. */
export const pluginNamesSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  names: z.array(z.string()).min(1),
  confirm: z.boolean().optional(),
};

/**
 * Returns the first `names` entry that is not a bare/scoped package name, or `null`
 * when all are valid. A non-null result MUST be refused — it could otherwise install
 * from an arbitrary URL/path/git source.
 *
 * @param names - The requested package names.
 * @returns The first invalid entry, or `null` if every entry is allowed.
 * @example firstInvalidName(["lodash", "git+https://e/x"]); // "git+https://e/x"
 */
export function firstInvalidName(names: string[]): string | null {
  return names.find((name) => !NAMES_SPEC.test(name)) ?? null;
}

/**
 * Builds the refusal message for an invalid `names` entry.
 *
 * @param action - The lifecycle verb, e.g. "add" or "remove".
 * @param name - The rejected entry.
 * @returns A refusal string naming the entry and stating no changes were made.
 */
export function invalidNameError(action: string, name: string): string {
  return `Refusing to ${action} "${name}": only bare or scoped npm package names are allowed (no URLs, git refs, paths, or version suffixes). No changes were made.`;
}

/** Capitalizes the first letter (verb → sentence-leading noun). */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Builds the report-and-point summary for a restart-triggering write. The mutation's
 * Boolean is restart-semantics, not success (`false` = the API auto-restarted to
 * apply; `true` = a manual restart is required); failures throw, so this is only
 * reached on success. It never asserts the plugins are installed.
 *
 * @param verb - The lifecycle verb, e.g. "add" or "remove".
 * @param names - The affected package names.
 * @param manualRestartRequired - The mutation's Boolean result.
 * @returns The concise report-and-point line.
 * @example restartReport("add", ["a"], false); // "Add of a submitted; the Unraid API is restarting..."
 */
export function restartReport(
  verb: string,
  names: string[],
  manualRestartRequired: boolean,
): string {
  const tail = manualRestartRequired
    ? "a manual API restart is required to apply it. Verify with plugin_list after restarting."
    : "the Unraid API is restarting to apply it. Verify with plugin_list once it reconnects.";
  return `${capitalize(verb)} of ${names.join(", ")} submitted; ${tail}`;
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- src/tools/plugin/_shared.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/tools/plugin/_shared.ts src/tools/plugin/_shared.test.ts
git commit -m "feat(plugin): add names allowlist + report helpers (_shared)"
```

---

## Task 2: `plugin_list` (read-only)

**Files:**
- Create: `src/tools/plugin/plugin-list.ts`
- Test: `src/tools/plugin/plugin-list.test.ts`

**Step 1: Write the failing test**

`src/tools/plugin/plugin-list.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { PluginListDocument, type PluginListQuery } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, rejectingExecutor } from "../_shared/test-support.js";
import { createPluginListHandler } from "./plugin-list.js";

const populated = {
  plugins: [
    { name: "unraid-api-plugin-connect", version: "4.5.0", hasApiModule: true, hasCliModule: false },
  ],
  installedUnraidPlugins: ["dynamix.plg", "ca.plg"],
} satisfies PluginListQuery;

const empty = { plugins: [], installedUnraidPlugins: [] } satisfies PluginListQuery;

describe("plugin_list", () => {
  it("selects both plugins and installedUnraidPlugins in one query", async () => {
    const { executor, calls } = recordingExecutor(populated);
    await createPluginListHandler(executor)({ response_format: "concise" });
    expect(calls[0]?.document).toBe(PluginListDocument);
  });

  it("summarizes api + OS plugins concisely", async () => {
    const { executor } = recordingExecutor(populated);
    const result = await createPluginListHandler(executor)({ response_format: "concise" });
    const text = firstText(result);
    expect(text).toMatch(/1 api plugin\(s\): unraid-api-plugin-connect/);
    expect(text).toMatch(/2 OS \.plg: dynamix\.plg, ca\.plg/);
  });

  it("never asserts a flat zero for an empty result (ambiguous upstream)", async () => {
    const { executor } = recordingExecutor(empty);
    const text = firstText(await createPluginListHandler(executor)({ response_format: "concise" }));
    expect(text).toMatch(/0 api plugins reported \(may also indicate safe mode/);
    expect(text).toMatch(/0 OS \.plg reported \(may also indicate an unreadable/);
  });

  it("returns detailed JSON when requested", async () => {
    const { executor } = recordingExecutor(populated);
    const text = firstText(await createPluginListHandler(executor)({ response_format: "detailed" }));
    expect(JSON.parse(text)).toEqual(populated);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createPluginListHandler(rejectingExecutor("boom"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list plugins: boom/);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- src/tools/plugin/plugin-list.test.ts`
Expected: FAIL (module not found).

**Step 3: Write the implementation**

`src/tools/plugin/plugin-list.ts`:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginListDocument, type PluginListQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "plugin_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Validated handler input. */
interface PluginListInput {
  response_format: ResponseFormat;
}

type ApiPlugin = PluginListQuery["plugins"][number];

/** Summarizes the api-plugin section; `[]` is reported as ambiguous, never a flat zero. */
function summarizeApi(plugins: ApiPlugin[]): string {
  if (plugins.length === 0) {
    return "0 api plugins reported (may also indicate safe mode or a load failure)";
  }
  return `${plugins.length} api plugin(s): ${plugins.map((plugin) => plugin.name).join(", ")}`;
}

/** Summarizes the OS `.plg` section; `[]` is reported as ambiguous, never a flat zero. */
function summarizeOsPlugins(filenames: string[]): string {
  if (filenames.length === 0) {
    return "0 OS .plg reported (may also indicate an unreadable plugin directory)";
  }
  return `${filenames.length} OS .plg: ${filenames.join(", ")}`;
}

/** Builds the concise two-section summary. */
function summarize(data: PluginListQuery): string {
  return `${summarizeApi(data.plugins)}. ${summarizeOsPlugins(data.installedUnraidPlugins)}.`;
}

/**
 * Creates the `plugin_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read plugin inventory.
 * @returns An MCP handler returning installed api plugins and OS `.plg` filenames.
 * @example
 * const handler = createPluginListHandler(client);
 * await handler({ response_format: "concise" });
 */
export function createPluginListHandler(client: GraphQLExecutor) {
  return async (input: PluginListInput): Promise<CallToolResult> => {
    try {
      const data = await client.execute(PluginListDocument);
      return formatResponse(input.response_format, summarize(data), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list plugins: ${message}`);
    }
  };
}

/**
 * Registers the read-only `plugin_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Plugins",
      description:
        "Read-only. Lists installed plugins. `plugins` are the API's active/loaded set (config-declared, installed, and schema-valid) captured as a boot snapshot that changes only after an API restart; `installedUnraidPlugins` are the live OS `.plg` filenames. An empty list is NOT a definitive zero — it can also mean safe mode (api plugins) or an unreadable plugin directory (OS `.plg`). Requires CONFIG read permission (any viewer-level key).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createPluginListHandler(client),
  );
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- src/tools/plugin/plugin-list.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/tools/plugin/plugin-list.ts src/tools/plugin/plugin-list.test.ts
git commit -m "feat(plugin): add plugin_list read tool"
```

---

## Task 3: `plugin_add` (confirm-gated, destructive)

**Files:**
- Create: `src/tools/plugin/plugin-add.ts`
- Test: `src/tools/plugin/plugin-add.test.ts`

**Step 1: Write the failing test**

`src/tools/plugin/plugin-add.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { PluginAddDocument, type PluginAddMutation } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createPluginAddHandler } from "./plugin-add.js";

const restarted = { addPlugin: false } satisfies PluginAddMutation;

describe("plugin_add gate + validation", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginAddHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-registry spec before confirming and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginAddHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect", "git+https://evil/x"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/git\+https:\/\/evil\/x/);
    expect(calls).toHaveLength(0);
  });
});

describe("plugin_add dispatch + reporting", () => {
  it("sends names with bundled:false, restart:true and reports the restart", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginAddHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
      confirm: true,
    });
    expect(calls[0]?.document).toBe(PluginAddDocument);
    expect(calls[0]?.variables).toEqual({
      input: { names: ["unraid-api-plugin-connect"], bundled: false, restart: true },
    });
    expect(firstText(result)).toMatch(/Add of unraid-api-plugin-connect submitted; the Unraid API is restarting/);
    expect(firstText(result)).not.toMatch(/installed/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createPluginAddHandler(throwingExecutor("E404"))({
      response_format: "concise",
      names: ["nope"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to add plugin\(s\) nope: E404/);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- src/tools/plugin/plugin-add.test.ts`
Expected: FAIL (module not found).

**Step 3: Write the implementation**

`src/tools/plugin/plugin-add.ts`:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginAddDocument } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { formatResponse, toolError } from "../_shared/respond.js";
import {
  type PluginNamesInput,
  firstInvalidName,
  invalidNameError,
  pluginNamesSchema,
  restartReport,
} from "./_shared.js";

const TOOL_NAME = "plugin_add";
/** Bundled plugins are a build-time/config-only path; this tool only does real installs. */
const BUNDLED = false;
/** Apply immediately: the resolver restarts the API to load the new plugin(s). */
const RESTART = true;

/**
 * Creates the `plugin_add` handler bound to a GraphQL executor. Validates each name
 * against the registry-name allowlist, then gates on `confirm`, then installs.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @returns An MCP handler that installs api (npm) plugins behind the confirm gate.
 * @example
 * const handler = createPluginAddHandler(client);
 * await handler({ response_format: "concise", names: ["unraid-api-plugin-x"], confirm: true });
 */
export function createPluginAddHandler(client: GraphQLExecutor) {
  return async (input: PluginNamesInput): Promise<CallToolResult> => {
    const invalid = firstInvalidName(input.names);
    if (invalid !== null) {
      return toolError(invalidNameError("add", invalid));
    }
    const refusal = requireConfirmation(input.confirm, `add plugin(s) ${input.names.join(", ")}`);
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(PluginAddDocument, {
        input: { names: input.names, bundled: BUNDLED, restart: RESTART },
      });
      const summary = restartReport("add", input.names, data.addPlugin);
      return formatResponse(input.response_format, summary, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to add plugin(s) ${input.names.join(", ")}: ${message}`);
    }
  };
}

/**
 * Registers the confirm-gated `plugin_add` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginAdd(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Add API Plugins",
      description:
        "⚠ Installs one or more Unraid API plugins by npm package name (`names`). This runs `npm install`, which executes the package's lifecycle scripts on the server (supply-chain / code-execution risk), then RESTARTS the Unraid API to load them — your connection will drop briefly. `names` must be bare or scoped package names (no URLs, git refs, paths, or version suffixes). Requires `confirm: true` and a key with CONFIG write permission (UPDATE_ANY). Reports submission; verify with plugin_list after the API reconnects.",
      inputSchema: pluginNamesSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    createPluginAddHandler(client),
  );
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- src/tools/plugin/plugin-add.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/tools/plugin/plugin-add.ts src/tools/plugin/plugin-add.test.ts
git commit -m "feat(plugin): add confirm-gated plugin_add tool"
```

---

## Task 4: `plugin_remove` (confirm-gated, destructive)

**Files:**
- Create: `src/tools/plugin/plugin-remove.ts`
- Test: `src/tools/plugin/plugin-remove.test.ts`

**Step 1: Write the failing test**

`src/tools/plugin/plugin-remove.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { PluginRemoveDocument, type PluginRemoveMutation } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createPluginRemoveHandler } from "./plugin-remove.js";

const restarted = { removePlugin: false } satisfies PluginRemoveMutation;

describe("plugin_remove gate + validation", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginRemoveHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-registry spec and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginRemoveHandler(executor)({
      response_format: "concise",
      names: ["/etc/passwd"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("plugin_remove dispatch + reporting", () => {
  it("sends names with bundled:false, restart:true and reports the restart", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginRemoveHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
      confirm: true,
    });
    expect(calls[0]?.document).toBe(PluginRemoveDocument);
    expect(calls[0]?.variables).toEqual({
      input: { names: ["unraid-api-plugin-connect"], bundled: false, restart: true },
    });
    expect(firstText(result)).toMatch(/Remove of unraid-api-plugin-connect submitted; the Unraid API is restarting/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createPluginRemoveHandler(throwingExecutor("boom"))({
      response_format: "concise",
      names: ["x"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to remove plugin\(s\) x: boom/);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- src/tools/plugin/plugin-remove.test.ts`
Expected: FAIL (module not found).

**Step 3: Write the implementation**

`src/tools/plugin/plugin-remove.ts` (mirror of `plugin-add.ts`):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { PluginRemoveDocument } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { formatResponse, toolError } from "../_shared/respond.js";
import {
  type PluginNamesInput,
  firstInvalidName,
  invalidNameError,
  pluginNamesSchema,
  restartReport,
} from "./_shared.js";

const TOOL_NAME = "plugin_remove";
/** Bundled plugins are a config-only path; this tool only does real uninstalls. */
const BUNDLED = false;
/** Apply immediately: the resolver restarts the API to unload the plugin(s). */
const RESTART = true;

/**
 * Creates the `plugin_remove` handler bound to a GraphQL executor. Validates each
 * name against the registry-name allowlist, then gates on `confirm`, then uninstalls.
 *
 * @param client - The GraphQL executor used to run the mutation.
 * @returns An MCP handler that uninstalls api (npm) plugins behind the confirm gate.
 * @example
 * const handler = createPluginRemoveHandler(client);
 * await handler({ response_format: "concise", names: ["unraid-api-plugin-x"], confirm: true });
 */
export function createPluginRemoveHandler(client: GraphQLExecutor) {
  return async (input: PluginNamesInput): Promise<CallToolResult> => {
    const invalid = firstInvalidName(input.names);
    if (invalid !== null) {
      return toolError(invalidNameError("remove", invalid));
    }
    const refusal = requireConfirmation(input.confirm, `remove plugin(s) ${input.names.join(", ")}`);
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(PluginRemoveDocument, {
        input: { names: input.names, bundled: BUNDLED, restart: RESTART },
      });
      const summary = restartReport("remove", input.names, data.removePlugin);
      return formatResponse(input.response_format, summary, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to remove plugin(s) ${input.names.join(", ")}: ${message}`);
    }
  };
}

/**
 * Registers the confirm-gated `plugin_remove` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 * @returns Nothing; registers the tool as a side effect.
 */
export function registerPluginRemove(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Remove API Plugins",
      description:
        "⚠ Uninstalls one or more Unraid API plugins by npm package name (`names`, as shown by plugin_list) and RESTARTS the Unraid API to unload them — your connection will drop briefly. Only plugins currently in the API config are affected (unknown names are a no-op). `names` must be bare or scoped package names. Requires `confirm: true` and a key with CONFIG write permission (DELETE_ANY). Reports submission; verify with plugin_list after the API reconnects.",
      inputSchema: pluginNamesSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createPluginRemoveHandler(client),
  );
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- src/tools/plugin/plugin-remove.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/tools/plugin/plugin-remove.ts src/tools/plugin/plugin-remove.test.ts
git commit -m "feat(plugin): add confirm-gated plugin_remove tool"
```

---

## Task 5: Register tools + registry test + README

**Files:**
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/registry.test.ts`
- Modify: `README.md`

**Step 1: Add registry-test assertions (failing first)**

Append to `src/tools/registry.test.ts` inside the `describe("registerAllTools", …)` block:
```typescript
  it("registers plugin_list as read-only", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    const reg = registrations.find((r) => r.name === "plugin_list");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("registers plugin_add/plugin_remove as destructive", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    for (const name of ["plugin_add", "plugin_remove"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });
```

Run: `npm test -- src/tools/registry.test.ts`
Expected: FAIL (plugin tools not registered yet).

**Step 2: Wire the tools in `registry.ts`**

Add imports (keep alphabetical grouping with the other domains):
```typescript
import { registerPluginAdd } from "./plugin/plugin-add.js";
import { registerPluginList } from "./plugin/plugin-list.js";
import { registerPluginRemove } from "./plugin/plugin-remove.js";
```
Add inside `registerAllTools`, after the notification block:
```typescript
  registerPluginList(server, client);
  registerPluginAdd(server, client);
  registerPluginRemove(server, client);
```

**Step 3: Run the registry test**

Run: `npm test -- src/tools/registry.test.ts`
Expected: PASS.

**Step 4: Document in README**

Add a "Plugins" subsection to the tool documentation in `README.md`, matching the format of the existing domain sections, documenting:
- `plugin_list` — read installed api plugins + OS `.plg` (note: empty ≠ definitive zero).
- `plugin_add` — ⚠ installs api plugins by npm name (runs lifecycle scripts, restarts API); `confirm: true`; bare/scoped names only; CONFIG UPDATE_ANY.
- `plugin_remove` — ⚠ uninstalls api plugins (restarts API); `confirm: true`; CONFIG DELETE_ANY.

Also bump any tool count mentioned in the README (27 → 30) if present.

**Step 5: Commit**

```bash
git add src/tools/registry.ts src/tools/registry.test.ts README.md
git commit -m "feat(plugin): register plugin tools + document in README"
```

---

## Task 6: Full verification gate (verify agent)

**Step 1: Quality gate**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all pass; the new tests are green and nothing else regressed.

**Step 2: Codegen idempotency**

Run: `npm run generate && git diff --exit-code src/types/unraid/graphql.ts`
Expected: clean (no diff).

**Step 3: stdio smoke — initialize → tools/list**

Start the built server over stdio, send an MCP `initialize` then `tools/list`, and confirm `plugin_list`, `plugin_add`, `plugin_remove` appear in the tool list (with `UNRAID_API_URL`/`UNRAID_API_KEY` set to dummy values — no network call is made just to list tools).
Expected: the three plugin tools are present; the process starts without error.

**Step 4: Final confirmation**

Confirm the working tree is clean and all tasks are committed. The PR will be drafted into `develop` with the standing release-gate note (source-validated against `unraid/api @ 264ddf0` + `main`, NOT live-verified).
