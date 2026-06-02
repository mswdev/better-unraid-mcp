# Docker Autostart Tool (PR #3.5) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `docker_autostart_set`, a merge-safe read-modify-write MCP tool that sets per-container Docker autostart over the REPLACE-all `updateAutostartConfiguration` mutation.

**Architecture:** The handler confirm-gates, **reads** every container's current autostart, **validates** the requested changes (duplicate/unknown ids) before mutating, **merges** them into a full snapshot of all containers, **sorts** by `autoStartOrder` (mandatory — preserves boot order), and **submits** the complete set. Because it makes two `execute` calls (read then mutate), it needs a new `sequencedExecutor` test fake.

**Tech Stack:** TypeScript (NodeNext, `.js` specifiers), MCP SDK, Zod, GraphQL via vendored SDL + graphql-codegen, Vitest with hand-written fakes, Biome.

---

## Conventions every task follows

- NodeNext imports end in `.js`. No `any`. Methods ≤25 lines, ≤2 nesting, JSDoc on exports, no magic numbers.
- Fixtures typed `satisfies <Operation>Query`/`<Operation>Mutation` (the `satisfies` clause at the call site is what catches codegen drift).
- After adding/editing `.graphql`: `npm run generate`, commit the regenerated `src/types/unraid/graphql.ts`.
- Per-task gate before commit: `npm run typecheck && npm test && npm run lint`.
- Patterns to copy: `src/tools/docker/container-update.ts` (gate + handler-side validation), `src/tools/docker/container-action.ts` (mutation nesting `data.docker.*`), `src/tools/docker/_shared.ts` (`stripLeadingSlash`), `src/tools/_shared/test-support.ts` (fakes), `src/tools/registry.ts`.

---

## Task 1: `sequencedExecutor` test helper

`docker_autostart_set` is the first handler making **two** `execute` calls, so the single-result `recordingExecutor` can't serve a read result and a mutation result (each `satisfies`-typed). Add a fake that returns canned results in call order and can throw (for error-path tests).

**Files:** Modify `src/tools/_shared/test-support.ts`; Test `src/tools/_shared/test-support.test.ts`.

**Step 1 — failing test** (append to `test-support.test.ts`):

```typescript
import { sequencedExecutor } from "./test-support.js";

describe("sequencedExecutor", () => {
  it("returns canned results in call order and records each call", async () => {
    const { executor, calls } = sequencedExecutor([{ a: 1 }, { b: 2 }]);

    const first = await executor.execute({ d: 1 } as never, { v: 1 } as never);
    const second = await executor.execute({ d: 2 } as never);

    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ b: 2 });
    expect(calls).toEqual([
      { document: { d: 1 }, variables: { v: 1 } },
      { document: { d: 2 }, variables: undefined },
    ]);
  });

  it("throws when the sequenced result is an Error", async () => {
    const { executor } = sequencedExecutor([new Error("boom")]);

    await expect(executor.execute({} as never)).rejects.toThrow("boom");
  });
});
```

**Step 2 — run, expect FAIL:** `npx vitest run src/tools/_shared/test-support.test.ts` → "sequencedExecutor is not a function".

**Step 3 — implement** (append to `test-support.ts`):

```typescript
/**
 * Builds a fake executor that returns canned results in call order (one per
 * `execute` call) and records every call. A result that is an `Error` is thrown
 * instead of returned, so a multi-call handler can be exercised through both the
 * read and the mutate call (e.g. read succeeds, then the mutation throws).
 *
 * @param results - Canned results (or `Error`s to throw), consumed in order.
 * @returns The fake executor and the array of recorded calls.
 */
export function sequencedExecutor(results: unknown[]): {
  executor: GraphQLExecutor;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const executor: GraphQLExecutor = {
    execute: async (document, variables) => {
      calls.push({ document, variables });
      const result = results[index];
      index += 1;
      if (result instanceof Error) {
        throw result;
      }
      return result as never;
    },
  };
  return { executor, calls };
}
```

**Step 4 — run, expect PASS. Step 5 — commit:**
```bash
git add src/tools/_shared/test-support.ts src/tools/_shared/test-support.test.ts
git commit -m "test: add sequencedExecutor fake for multi-call handlers"
```

---

## Task 2: `docker_autostart_set` tool

**Files:** Create `src/tools/docker/autostart-set.graphql`, `autostart-set.ts`, `autostart-set.test.ts`; Modify `src/tools/registry.ts`, `src/types/unraid/graphql.ts` (regenerated).

**Step 1 — operations** (`autostart-set.graphql`):
```graphql
query DockerAutostartState {
  docker {
    containers {
      id
      names
      autoStart
      autoStartOrder
      autoStartWait
    }
  }
}

mutation DockerSetAutostart($entries: [DockerAutostartEntryInput!]!, $persist: Boolean) {
  docker {
    updateAutostartConfiguration(entries: $entries, persistUserPreferences: $persist)
  }
}
```

**Step 2 — `npm run generate`**, confirm `DockerAutostartStateDocument`, `DockerSetAutostartDocument`, and the input type `DockerAutostartEntryInput` exist:
`grep -n "DockerAutostartStateDocument\|DockerSetAutostartDocument\|DockerAutostartEntryInput" src/types/unraid/graphql.ts`.

**Step 3 — failing test** (`autostart-set.test.ts`):

```typescript
import { describe, expect, it } from "vitest";
import {
  DockerAutostartStateDocument,
  type DockerAutostartStateQuery,
  DockerSetAutostartDocument,
  type DockerSetAutostartMutation,
} from "../../types/unraid/graphql.js";
import { firstText, sequencedExecutor } from "../_shared/test-support.js";
import { createDockerAutostartSetHandler } from "./autostart-set.js";

const state = {
  docker: {
    containers: [
      { id: "srv:db", names: ["/db"], autoStart: true, autoStartOrder: 0, autoStartWait: 10 },
      { id: "srv:app", names: ["/app"], autoStart: true, autoStartOrder: 1, autoStartWait: 0 },
      { id: "srv:idle", names: ["/idle"], autoStart: false, autoStartOrder: null, autoStartWait: null },
    ],
  },
} satisfies DockerAutostartStateQuery;

const ok = { docker: { updateAutostartConfiguration: true } } satisfies DockerSetAutostartMutation;

describe("docker_autostart_set handler", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = sequencedExecutor([]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("merges one change into the full snapshot, preserving the others", async () => {
    const { executor, calls } = sequencedExecutor([state, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].document).toBe(DockerAutostartStateDocument);
    expect(calls[1].document).toBe(DockerSetAutostartDocument);
    expect(calls[1].variables).toEqual({
      persist: false,
      entries: [
        { id: "srv:db", autoStart: true, wait: 10 },
        { id: "srv:app", autoStart: false, wait: 0 },
        { id: "srv:idle", autoStart: false, wait: undefined },
      ],
    });
  });

  it("sorts the snapshot by autoStartOrder, not daemon order", async () => {
    const reordered = {
      docker: {
        containers: [
          { id: "srv:app", names: ["/app"], autoStart: true, autoStartOrder: 1, autoStartWait: 0 },
          { id: "srv:db", names: ["/db"], autoStart: true, autoStartOrder: 0, autoStartWait: 10 },
        ],
      },
    } satisfies DockerAutostartStateQuery;
    const { executor, calls } = sequencedExecutor([reordered, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:db", auto_start: true }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    const { entries } = calls[1].variables as { entries: { id: string }[] };
    expect(entries.map((entry) => entry.id)).toEqual(["srv:db", "srv:app"]);
  });

  it("rejects an unknown id and never calls the mutation", async () => {
    const { executor, calls } = sequencedExecutor([state]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:nope", auto_start: true }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Unknown container id/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(DockerAutostartStateDocument);
  });

  it("rejects duplicate ids without mutating", async () => {
    const { executor, calls } = sequencedExecutor([state]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [
        { id: "srv:app", auto_start: true },
        { id: "srv:app", auto_start: false },
      ],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Duplicate/);
    expect(calls).toHaveLength(1);
  });

  it("applies a provided wait and preserves an omitted one", async () => {
    const { executor, calls } = sequencedExecutor([state, ok]);

    await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:db", auto_start: true, wait: 30 }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    const { entries } = calls[1].variables as { entries: { id: string; wait?: number }[] };
    expect(entries.find((entry) => entry.id === "srv:db")?.wait).toBe(30);
    expect(entries.find((entry) => entry.id === "srv:app")?.wait).toBe(0);
  });

  it("passes persist through and notes it in the summary", async () => {
    const { executor, calls } = sequencedExecutor([state, ok]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: true,
      confirm: true,
      response_format: "concise",
    });

    expect((calls[1].variables as { persist: boolean }).persist).toBe(true);
    expect(firstText(result)).toMatch(/WebGUI/);
  });

  it("summarizes changes by slash-stripped name", async () => {
    const { executor } = sequencedExecutor([state, ok]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/app OFF/);
    expect(firstText(result)).not.toMatch(/\/app/);
  });

  it("returns the resolved changes (id, name, autoStart, wait) in detailed format", async () => {
    const { executor } = sequencedExecutor([state, ok]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false, wait: 5 }],
      persist: true,
      confirm: true,
      response_format: "detailed",
    });

    expect(JSON.parse(firstText(result))).toEqual({
      ok: true,
      persisted: true,
      changes: [{ id: "srv:app", name: "app", autoStart: false, wait: 5 }],
    });
  });

  it("returns an error result when the read throws", async () => {
    const { executor } = sequencedExecutor([new Error("daemon down")]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to update Docker autostart/);
    expect(firstText(result)).toMatch(/daemon down/);
  });

  it("returns an error result when the mutation throws after a successful read", async () => {
    const { executor, calls } = sequencedExecutor([state, new Error("flag off")]);

    const result = await createDockerAutostartSetHandler(executor)({
      changes: [{ id: "srv:app", auto_start: false }],
      persist: false,
      confirm: true,
      response_format: "concise",
    });

    expect(calls).toHaveLength(2);
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/flag off/);
  });
});
```

Run → FAIL (handler not defined).

**Step 4 — implement** `autostart-set.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  type DockerAutostartEntryInput,
  DockerAutostartStateDocument,
  type DockerAutostartStateQuery,
  DockerSetAutostartDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_autostart_set";

type Containers = DockerAutostartStateQuery["docker"]["containers"];
type Container = Containers[number];

const changeSchema = z.object({
  id: z.string(),
  auto_start: z.boolean(),
  wait: z.number().int().nonnegative().optional(),
});

type Change = z.infer<typeof changeSchema>;

/** A merged autostart entry plus its current order, used only for sorting. */
interface MergedEntry {
  id: string;
  autoStart: boolean;
  wait: number | undefined;
  order: number | null;
}

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  changes: z.array(changeSchema).nonempty(),
  persist: z.boolean().default(false),
  confirm: z.boolean().optional(),
};

/** Rejects duplicate ids and ids absent from the live container set. */
function validateChanges(changes: Change[], containers: Containers): string | null {
  const ids = changes.map((change) => change.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) {
    return `Duplicate container id(s) in changes: ${duplicates.join(", ")}. No changes were made.`;
  }
  const known = new Set(containers.map((container) => container.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return `Unknown container id(s): ${unknown.join(", ")}. No changes were made.`;
  }
  return null;
}

/** Merges a container's current autostart with its requested change, if any. */
function mergeEntry(container: Container, change: Change | undefined): MergedEntry {
  return {
    id: container.id,
    autoStart: change ? change.auto_start : container.autoStart,
    wait: change?.wait ?? container.autoStartWait ?? undefined,
    order: container.autoStartOrder ?? null,
  };
}

/** Orders entries by autostart position ascending, with unordered ones last. */
function compareByOrder(a: MergedEntry, b: MergedEntry): number {
  if (a.order === null) {
    return b.order === null ? 0 : 1;
  }
  if (b.order === null) {
    return -1;
  }
  return a.order - b.order;
}

/** Builds the full, order-preserving autostart snapshot to resubmit. */
function buildEntries(containers: Containers, changes: Change[]): DockerAutostartEntryInput[] {
  const changeById = new Map(changes.map((change) => [change.id, change]));
  return containers
    .map((container) => mergeEntry(container, changeById.get(container.id)))
    .sort(compareByOrder)
    .map((entry) => ({ id: entry.id, autoStart: entry.autoStart, wait: entry.wait }));
}

/** Describes one requested change for the concise summary. */
function describeChange(change: Change, name: string): string {
  const state = change.auto_start ? "ON" : "OFF";
  const wait = change.auto_start && change.wait ? ` (wait ${change.wait}s)` : "";
  return `${name} ${state}${wait}`;
}

/** Maps each container id to its slash-stripped display name. */
function buildNameById(containers: Containers): Map<string, string> {
  return new Map(
    containers.map((container) => [container.id, stripLeadingSlash(container.names[0], container.id)]),
  );
}

/** Resolves each requested change to a detailed record for the detailed payload. */
function detailChanges(
  changes: Change[],
  containers: Containers,
): { id: string; name: string; autoStart: boolean; wait: number | null }[] {
  const nameById = buildNameById(containers);
  return changes.map((change) => ({
    id: change.id,
    name: nameById.get(change.id) ?? change.id,
    autoStart: change.auto_start,
    wait: change.wait ?? null,
  }));
}

/** Builds the concise summary of the requested changes. */
function summarize(changes: Change[], containers: Containers, persist: boolean): string {
  const nameById = buildNameById(containers);
  const parts = changes.map((change) => describeChange(change, nameById.get(change.id) ?? change.id));
  const target = persist ? "autostart file + WebGUI prefs" : "autostart file only";
  return `Autostart updated: ${parts.join(", ")} — ${target}; effective next array/Docker start.`;
}

/**
 * Creates the `docker_autostart_set` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read containers and write autostart.
 * @returns An MCP handler that merge-safely sets container autostart on boot.
 */
export function createDockerAutostartSetHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    changes,
    persist,
    confirm,
  }: {
    response_format: ResponseFormat;
    changes: Change[];
    persist: boolean;
    confirm?: boolean;
  }): Promise<CallToolResult> => {
    const refusal = requireConfirmation(confirm, "change Docker autostart configuration");
    if (refusal) {
      return refusal;
    }
    try {
      const { docker } = await client.execute(DockerAutostartStateDocument);
      const validationError = validateChanges(changes, docker.containers);
      if (validationError) {
        return toolError(validationError);
      }
      const entries = buildEntries(docker.containers, changes);
      const result = await client.execute(DockerSetAutostartDocument, { entries, persist });
      const detailed = {
        ok: result.docker.updateAutostartConfiguration,
        persisted: persist,
        changes: detailChanges(changes, docker.containers),
      };
      return formatResponse(response_format, summarize(changes, docker.containers, persist), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to update Docker autostart: ${message}`);
    }
  };
}

/**
 * Registers the destructive `docker_autostart_set` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerAutostartSet(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Set Docker Container Autostart",
      description:
        "Sets which containers auto-start on boot. Merge-safe: reads the current autostart config, applies your changes, and resubmits the complete set (sorted to preserve boot order) so unlisted containers are untouched. Boot-time only — does not start/stop running containers now; takes effect on the next array/Docker start. `persist: true` also writes the WebGUI's saved prefs but ⚠ reorders the Docker-page container list irreversibly — leave it false unless you want that. Requires `confirm: true`. Needs Unraid OS 7.3+ (ENABLE_NEXT_DOCKER_RELEASE).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createDockerAutostartSetHandler(client),
  );
}
```

**Step 5 — register** in `src/tools/registry.ts`: add `import { registerDockerAutostartSet } from "./docker/autostart-set.js";` and call `registerDockerAutostartSet(server, client);`.

**Step 6 — gate:** `npm run typecheck && npm test && npm run lint` (and `npm run format` if biome wants wrapping).

**Step 7 — commit:**
```bash
git add src/tools/docker/autostart-set.* src/tools/registry.ts src/types/unraid/graphql.ts
git commit -m "feat(docker): add gated, merge-safe docker_autostart_set tool"
```

---

## Task 3: README

**Files:** Modify `README.md`.

- In the **Docker** section, change "Four read-only tools and three destructive mutations" → "Four read-only tools and four destructive mutations", and add a `docker_autostart_set` row to the destructive table:
  > `docker_autostart_set` | **destructive** | Sets which containers auto-start on boot (merge-safe; resubmits the full set sorted to preserve boot order). Boot-time only. `persist: true` also updates the WebGUI prefs but reorders the Docker-page list irreversibly. Requires `confirm: true`. Needs Unraid OS **7.3+**.
- Remove `docker_autostart_set` from the **Planned** note (it's now shipped); keep the live-verification caveat.

**Commit:** `docs: document docker_autostart_set`.

---

## Task 4: Full gate + smoke

**Step 1 — codegen idempotency:** `npm run generate` then `git diff --exit-code src/types/unraid/graphql.ts` → no diff.

**Step 2 — full gate:** `npm run typecheck && npm run build && npm test && npm run lint` → all pass.

**Step 3 — stdio smoke** (maintainer-run, per the dev workflow): `initialize`→`tools/list` handshake; confirm `docker_autostart_set` registers with `destructiveHint: true` (5 docker mutations? no — 4: action/remove/update/autostart_set). See the PR #3 plan's smoke command.

---

## Build orchestration (for the executor)

- Build tasks **sequentially**; after each: `npm run typecheck && npm test && npm run lint`; **stop on first failure**.
- Each task through a fresh subagent with an **adversarial verify** (re-run tests + skeptic diff read against this plan and `.claude/rules/`).
- Do **not** claim live verification — hermetic tests only.
- After Task 4: push, open a **draft** PR into `develop`, then run a multi-agent code review and fix everything including nits.
