# Docker Tools (PR #3) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the Docker domain to better-unraid-mcp — 7 MCP tools (4 read-only, 3 confirm-gated mutations) over `Query.docker` / `Mutation.docker`.

**Architecture:** Each tool is a module under `src/tools/docker/` following the established seam: a `create<Tool>Handler(client: GraphQLExecutor)` factory returning an MCP handler, plus a `register<Tool>(server, client)`. Reads mirror `share_list`/`array_status`. Mutations add a confirm-gate (`requireConfirmation`) that short-circuits **before** `client.execute`, the first `destructiveHint: true` annotations, the first GraphQL **mutations** (nested under `data.docker.*`), and the first operations that take **variables**.

**Tech Stack:** TypeScript (NodeNext, `.js` import specifiers), MCP SDK v1.29, Zod input schemas, GraphQL via vendored SDL + graphql-codegen (single committed `src/types/unraid/graphql.ts`), Vitest with hand-written fakes, Biome.

---

## Conventions every task follows

- **NodeNext imports:** always end relative imports with `.js` (e.g. `"./_shared.js"`).
- **No `any`.** Fixtures are typed `satisfies <Operation>Query`/`<Operation>Mutation` so codegen drift breaks the build.
- **One handler param:** the MCP args object (destructured). Methods ≤25 lines, ≤2 nesting levels, JSDoc on every export.
- **Codegen is generated, never hand-edited.** After adding/-editing any `.graphql`, run `npm run generate` and commit the regenerated `src/types/unraid/graphql.ts`.
- **Test seam:** import the `create<Tool>Handler` factory directly with a fake `GraphQLExecutor` (no server, no network). `firstText(result)` reads the first text block.
- **Per-task gate (run before each commit):** `npm run typecheck && npm test && npm run lint`. Final task runs the full gate + build + smoke.

Reference files to copy patterns from: `src/tools/share/share-list.ts` (read tool w/ filter), `src/tools/array/array-status.ts` (richer concise summary), `src/tools/_shared/confirm.ts` (gate), `src/tools/_shared/respond.ts` (`formatResponse`/`toolError`), `src/tools/disk/disk-list.test.ts` (fake-executor test shape), `src/tools/registry.ts` (registration).

---

## Task 1: `stripLeadingSlash` helper (`docker/_shared.ts`)

Docker container `names` carry a leading `/` (e.g. `/plex`). Strip it for display and name filtering.

**Files:**
- Create: `src/tools/docker/_shared.ts`
- Test: `src/tools/docker/_shared.test.ts`

**Step 1 — failing test:**

```typescript
import { describe, expect, it } from "vitest";
import { stripLeadingSlash } from "./_shared.js";

describe("stripLeadingSlash", () => {
  it("removes a single leading slash", () => {
    expect(stripLeadingSlash("/plex")).toBe("plex");
  });

  it("leaves an unprefixed name unchanged", () => {
    expect(stripLeadingSlash("plex")).toBe("plex");
  });

  it("strips only the first slash", () => {
    expect(stripLeadingSlash("//weird")).toBe("/weird");
  });

  it("returns the fallback for undefined", () => {
    expect(stripLeadingSlash(undefined, "(unnamed)")).toBe("(unnamed)");
  });
});
```

**Step 2 — run, expect FAIL:** `npx vitest run src/tools/docker/_shared.test.ts` → fails (module not found).

**Step 3 — implement:**

```typescript
/**
 * Strips the single leading slash Docker prepends to container names.
 *
 * @param name - A Docker container name (may be undefined).
 * @param fallback - Value returned when `name` is undefined. Defaults to "".
 * @returns The name without its leading slash, or the fallback.
 */
export function stripLeadingSlash(name: string | undefined, fallback = ""): string {
  if (name === undefined) {
    return fallback;
  }
  return name.startsWith("/") ? name.slice(1) : name;
}
```

**Step 4 — run, expect PASS.**

**Step 5 — commit:**
```bash
git add src/tools/docker/_shared.ts src/tools/docker/_shared.test.ts
git commit -m "feat(docker): add stripLeadingSlash name helper"
```

---

## Task 2: `docker_container_list` (read)

**Files:**
- Create: `src/tools/docker/container-list.graphql`, `container-list.ts`, `container-list.test.ts`
- Modify: `src/tools/registry.ts`, `src/types/unraid/graphql.ts` (regenerated)

**Step 1 — write the operation:**

`src/tools/docker/container-list.graphql`:
```graphql
query DockerContainerList {
  docker {
    containers {
      id
      names
      image
      state
      status
      autoStart
      isUpdateAvailable
    }
  }
}
```

**Step 2 — generate types:** `npm run generate` then confirm `DockerContainerListDocument` / `DockerContainerListQuery` exist:
`grep -n "DockerContainerListDocument" src/types/unraid/graphql.ts` → Expected: a match.

**Step 3 — failing test:**

```typescript
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerContainerListQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createDockerContainerListHandler } from "./container-list.js";

const data = {
  docker: {
    containers: [
      { id: "srv:abc", names: ["/plex"], image: "linuxserver/plex", state: "RUNNING", status: "Up 2 days", autoStart: true, isUpdateAvailable: true },
      { id: "srv:def", names: ["/sonarr"], image: "linuxserver/sonarr", state: "EXITED", status: "Exited (0)", autoStart: false, isUpdateAvailable: false },
    ],
  },
} satisfies DockerContainerListQuery;

function fakeExecutor(result: DockerContainerListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("docker_container_list handler", () => {
  it("summarizes each container by stripped name, state and image", async () => {
    const result = await createDockerContainerListHandler(fakeExecutor(data))({ response_format: "concise" });

    // Name is slash-stripped: the container's line starts with "plex", not "/plex".
    // (A bare /\/plex/ would wrongly match the image "linuxserver/plex" too.)
    expect(firstText(result)).toMatch(/^plex /m);
    expect(firstText(result)).not.toMatch(/^\/plex/m);
    expect(firstText(result)).toMatch(/RUNNING/);
    expect(firstText(result)).toMatch(/linuxserver\/plex/);
    expect(firstText(result)).toMatch(/update available/i);
  });

  it("filters by case-insensitive name substring on the stripped name", async () => {
    const result = await createDockerContainerListHandler(fakeExecutor(data))({ response_format: "concise", name: "SON" });

    expect(firstText(result)).toMatch(/sonarr/);
    expect(firstText(result)).not.toMatch(/plex/);
  });

  it("reports when there are no containers", async () => {
    const result = await createDockerContainerListHandler(fakeExecutor({ docker: { containers: [] } }))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No Docker containers/);
  });
});
```

Run → FAIL (handler not defined).

**Step 4 — implement** `src/tools/docker/container-list.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { DockerContainerListDocument, type DockerContainerListQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_container_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  name: z.string().optional(),
};

type Containers = DockerContainerListQuery["docker"]["containers"];

/** Filters containers by a case-insensitive substring of any slash-stripped name. */
function filterByName(containers: Containers, name: string | undefined): Containers {
  if (!name) {
    return containers;
  }
  const needle = name.toLowerCase();
  return containers.filter((container) =>
    container.names.some((raw) => stripLeadingSlash(raw).toLowerCase().includes(needle)),
  );
}

/** One line per container: name, state, image, and an update marker. */
function summarize(containers: Containers): string {
  if (containers.length === 0) {
    return "No Docker containers found.";
  }
  return containers
    .map((container) => {
      const name = stripLeadingSlash(container.names[0], "(unnamed)");
      const update = container.isUpdateAvailable ? " — ⬆ update available" : "";
      return `${name} — ${container.state} — ${container.image}${update}`;
    })
    .join("\n");
}

/**
 * Creates the `docker_container_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch containers.
 * @returns An MCP handler listing Docker containers and their state.
 */
export function createDockerContainerListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    name,
  }: { response_format: ResponseFormat; name?: string }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerContainerListDocument);
      const containers = filterByName(data.docker.containers, name);
      return formatResponse(response_format, summarize(containers), containers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch Docker containers: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_container_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Docker Containers",
      description:
        "Read-only. Lists Docker containers with state, image, and whether an update is available. Use `name` to filter by a container-name substring.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerContainerListHandler(client),
  );
}
```

**Step 5 — register** in `src/tools/registry.ts`: add the import and a `registerDockerContainerList(server, client);` call. (Subsequent docker tasks add their `register*` here too.)

**Step 6 — run typecheck + test + lint, expect PASS.**

**Step 7 — commit:**
```bash
git add src/tools/docker/container-list.* src/tools/registry.ts src/types/unraid/graphql.ts
git commit -m "feat(docker): add docker_container_list read tool"
```

---

## Task 3: `docker_container_logs` (read — first op with variables)

**Files:** Create `container-logs.graphql`, `container-logs.ts`, `container-logs.test.ts`; modify `registry.ts`, regenerate types.

**Step 1 — operation** (`container-logs.graphql`):
```graphql
query DockerContainerLogs($id: PrefixedID!, $since: DateTime, $tail: Int) {
  docker {
    logs(id: $id, since: $since, tail: $tail) {
      containerId
      lines {
        timestamp
        message
      }
      cursor
    }
  }
}
```

**Step 2 — `npm run generate`**, confirm `DockerContainerLogsDocument` exists.

**Step 3 — failing test:**

```typescript
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DockerContainerLogsQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createDockerContainerLogsHandler } from "./container-logs.js";

const data = {
  docker: {
    logs: {
      containerId: "srv:abc",
      lines: [
        { timestamp: "2026-06-01T00:00:00Z", message: "starting up" },
        { timestamp: "2026-06-01T00:00:01Z", message: "ready" },
      ],
      cursor: "2026-06-01T00:00:01Z",
    },
  },
} satisfies DockerContainerLogsQuery;

function fakeExecutor(result: DockerContainerLogsQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("docker_container_logs handler", () => {
  it("renders each log line", async () => {
    const result = await createDockerContainerLogsHandler(fakeExecutor(data))({ id: "srv:abc", response_format: "concise" });

    expect(firstText(result)).toMatch(/starting up/);
    expect(firstText(result)).toMatch(/ready/);
  });

  it("reports when there are no log lines", async () => {
    const empty = { docker: { logs: { containerId: "srv:abc", lines: [], cursor: null } } } satisfies DockerContainerLogsQuery;
    const result = await createDockerContainerLogsHandler(fakeExecutor(empty))({ id: "srv:abc", response_format: "concise" });

    expect(firstText(result)).toMatch(/No log lines/);
  });
});
```

Run → FAIL.

**Step 4 — implement** `container-logs.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { DockerContainerLogsDocument, type DockerContainerLogsQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "docker_container_logs";
const DEFAULT_TAIL = 200;
const MAX_TAIL = 2000;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  since: z.string().optional(),
  tail: z.number().int().positive().max(MAX_TAIL).default(DEFAULT_TAIL),
};

type Logs = DockerContainerLogsQuery["docker"]["logs"];

/** Renders the log lines and, when present, a paging hint for `cursor`. */
function summarize(logs: Logs): string {
  if (logs.lines.length === 0) {
    return "No log lines.";
  }
  const body = logs.lines.map((line) => `[${line.timestamp}] ${line.message}`).join("\n");
  const more = logs.cursor ? `\n— more available: re-call with since="${logs.cursor}" (the boundary line repeats; de-dupe).` : "";
  return body + more;
}

/**
 * Creates the `docker_container_logs` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch container logs.
 * @returns An MCP handler returning recent log lines for a container.
 */
export function createDockerContainerLogsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    id,
    since,
    tail,
  }: { response_format: ResponseFormat; id: string; since?: string; tail?: number }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DockerContainerLogsDocument, { id, since, tail });
      return formatResponse(response_format, summarize(data.docker.logs), data.docker.logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch logs for ${id}: ${message}`);
    }
  };
}

/**
 * Registers the read-only `docker_container_logs` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerLogs(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Docker Container Logs",
      description:
        "Read-only. Returns recent log lines for a container. `id` is the container id from docker_container_list. `tail` = trailing lines (default 200, max 2000). `since` = inclusive ISO-8601 lower bound; re-pass the returned `cursor` as `since` to page (the boundary line repeats — de-dupe).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createDockerContainerLogsHandler(client),
  );
}
```

> **Wiring note (variables):** this is the first operation passing variables to `client.execute(Document, { ... })`. `tail` has a Zod default so it is always present; `since` is omitted when undefined (the API treats it as "from the beginning").

**Step 5 — register, Step 6 — gate, Step 7 — commit** `feat(docker): add docker_container_logs read tool`.

---

## Task 4: `docker_network_list` (read)

**Files:** `network-list.graphql`, `network-list.ts`, `network-list.test.ts`; modify registry + regenerate.

**Operation:**
```graphql
query DockerNetworkList {
  docker {
    networks {
      id
      name
      driver
      scope
      enableIPv6
      internal
      attachable
    }
  }
}
```

**Test (key cases):** one line per network containing name + driver; "No Docker networks." on empty. Fixture typed `satisfies DockerNetworkListQuery`.

**Handler** mirrors `container-list` (no filter):
- `summarize`: empty → `"No Docker networks."`; else per network `` `${name} — ${driver} (${scope})${ipv6}` `` where `ipv6 = enableIPv6 ? ", IPv6" : ""`.
- `formatResponse(response_format, summarize(data.docker.networks), data.docker.networks)`.
- Annotations: read-only. Description: "Read-only. Lists Docker networks (driver, scope, IPv6/internal/attachable)."

**Commit:** `feat(docker): add docker_network_list read tool`.

> **Residual-unknown note:** `Docker.networks` is SDL-typed but its runtime behavior was not verified — design strictly to the SDL fields above.

---

## Task 5: `docker_port_conflicts` (read)

**Files:** `port-conflicts.graphql`, `port-conflicts.ts`, `port-conflicts.test.ts`; modify registry + regenerate.

**Operation:**
```graphql
query DockerPortConflicts {
  docker {
    portConflicts {
      containerPorts {
        privatePort
        type
        containers { id name }
      }
      lanPorts {
        lanIpPort
        publicPort
        type
        containers { id name }
      }
    }
  }
}
```

**Test (key cases):**
- With conflicts → summary contains `/conflict/i` and the count.
- Both arrays empty → `"No port conflicts."`

**Handler:**
```typescript
type Conflicts = DockerPortConflictsQuery["docker"]["portConflicts"];

function summarize(conflicts: Conflicts): string {
  const containerCount = conflicts.containerPorts.length;
  const lanCount = conflicts.lanPorts.length;
  if (containerCount === 0 && lanCount === 0) {
    return "No port conflicts.";
  }
  return `${containerCount} container-port conflict(s), ${lanCount} LAN-port conflict(s).`;
}
```
Read-only annotations. Description: "Read-only. Reports Docker container/LAN port conflicts."

**Commit:** `feat(docker): add docker_port_conflicts read tool`.

> **Residual-unknown note:** same as networks — SDL-typed, runtime semantics unverified.

---

## Task 6: `recordingExecutor` test helper

The mutation tasks need a fake that records whether/with-what `execute` was called (to prove the gate short-circuits and to assert enum→Document dispatch).

**Files:** Modify `src/tools/_shared/test-support.ts`.

**Step 1 — failing test** (`src/tools/_shared/test-support.test.ts`, create):

```typescript
import { describe, expect, it } from "vitest";
import { recordingExecutor } from "./test-support.js";

describe("recordingExecutor", () => {
  it("starts with no recorded calls", () => {
    const { calls } = recordingExecutor({ ok: true });

    expect(calls).toHaveLength(0);
  });

  it("records the document and variables of each execute call", async () => {
    const doc = { marker: "doc" };
    const { executor, calls } = recordingExecutor({ ok: true });

    const result = await executor.execute(doc as never, { id: "x" } as never);

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ document: doc, variables: { id: "x" } });
  });
});
```

Run → FAIL.

**Step 2 — implement** (append to `test-support.ts`):

```typescript
import type { GraphQLExecutor } from "../../graphql/client.js";

/** A single recorded `execute` invocation. */
export interface RecordedCall {
  document: unknown;
  variables: unknown;
}

/**
 * Builds a fake executor that records every `execute` call and returns a canned
 * result. Use it to assert a confirm-gate short-circuited (no calls) or that a
 * tool dispatched the expected typed Document.
 *
 * @param result - The value every `execute` call resolves to.
 * @returns The fake executor and the array of recorded calls.
 */
export function recordingExecutor(result: unknown): { executor: GraphQLExecutor; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const executor: GraphQLExecutor = {
    execute: async (document, variables) => {
      calls.push({ document, variables });
      return result as never;
    },
  };
  return { executor, calls };
}
```

**Step 3 — run, expect PASS. Step 4 — commit** `test(docker): add recordingExecutor fake for gate/dispatch assertions`.

---

## Task 7: `docker_container_action` (mutation — gate + enum dispatch)

The first mutation tool. Four lifecycle actions share one signature, so one tool with an `action` enum dispatches to one of four mutation Documents. **Every** call requires `confirm: true`.

**Files:** `container-action.graphql`, `container-action.ts`, `container-action.test.ts`; modify registry + regenerate.

**Step 1 — operations** (four named ops in one file, `container-action.graphql`):
```graphql
mutation DockerStart($id: PrefixedID!) {
  docker { start(id: $id) { id names state status } }
}

mutation DockerStop($id: PrefixedID!) {
  docker { stop(id: $id) { id names state status } }
}

mutation DockerPause($id: PrefixedID!) {
  docker { pause(id: $id) { id names state status } }
}

mutation DockerUnpause($id: PrefixedID!) {
  docker { unpause(id: $id) { id names state status } }
}
```

**Step 2 — `npm run generate`**, confirm `DockerStartDocument`, `DockerStopDocument`, `DockerPauseDocument`, `DockerUnpauseDocument` all exist.

**Step 3 — failing test** (covers the three firsts):

```typescript
import { describe, expect, it } from "vitest";
import {
  DockerPauseDocument,
  DockerStartDocument,
  DockerStopDocument,
  DockerUnpauseDocument,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createDockerContainerActionHandler } from "./container-action.js";

const cases = [
  { action: "start", document: DockerStartDocument, field: "start", verb: /Started/ },
  { action: "stop", document: DockerStopDocument, field: "stop", verb: /Stopped/ },
  { action: "pause", document: DockerPauseDocument, field: "pause", verb: /Paused/ },
  { action: "unpause", document: DockerUnpauseDocument, field: "unpause", verb: /Unpaused/ },
] as const;

describe("docker_container_action handler", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor({});
    const result = await createDockerContainerActionHandler(executor)({ id: "srv:abc", action: "stop", response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0); // gate short-circuits BEFORE execute
  });

  for (const c of cases) {
    it(`dispatches ${c.action} to its mutation document and reports past-tense`, async () => {
      const { executor, calls } = recordingExecutor({ docker: { [c.field]: { id: "srv:abc", names: ["/plex"], state: "RUNNING", status: "Up" } } });

      const result = await createDockerContainerActionHandler(executor)({ id: "srv:abc", action: c.action, confirm: true, response_format: "concise" });

      expect(calls).toHaveLength(1);
      expect(calls[0].document).toBe(c.document);
      expect(calls[0].variables).toEqual({ id: "srv:abc" });
      expect(firstText(result)).toMatch(c.verb);
      expect(firstText(result)).toMatch(/plex/);
    });
  }
});
```

Run → FAIL.

**Step 4 — implement** `container-action.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DockerPauseDocument,
  DockerStartDocument,
  DockerStopDocument,
  DockerUnpauseDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { stripLeadingSlash } from "./_shared.js";

const TOOL_NAME = "docker_container_action";

type ContainerAction = "start" | "stop" | "pause" | "unpause";

/** A lifecycle action's resulting container (all four ops return this shape). */
interface ActionResult {
  id: string;
  names: string[];
  state: string;
  status: string;
}

const PAST_TENSE: Record<ContainerAction, string> = {
  start: "Started",
  stop: "Stopped",
  pause: "Paused",
  unpause: "Unpaused",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  action: z.enum(["start", "stop", "pause", "unpause"]),
  confirm: z.boolean().optional(),
};

/** Dispatches one lifecycle action to its typed mutation Document. */
async function runAction(
  client: GraphQLExecutor,
  action: ContainerAction,
  id: string,
): Promise<ActionResult> {
  switch (action) {
    case "start":
      return (await client.execute(DockerStartDocument, { id })).docker.start;
    case "stop":
      return (await client.execute(DockerStopDocument, { id })).docker.stop;
    case "pause":
      return (await client.execute(DockerPauseDocument, { id })).docker.pause;
    case "unpause":
      return (await client.execute(DockerUnpauseDocument, { id })).docker.unpause;
  }
}

/**
 * Creates the `docker_container_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the lifecycle mutation.
 * @returns An MCP handler that starts/stops/pauses/unpauses a container.
 */
export function createDockerContainerActionHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    id,
    action,
    confirm,
  }: { response_format: ResponseFormat; id: string; action: ContainerAction; confirm?: boolean }): Promise<CallToolResult> => {
    const refusal = requireConfirmation(confirm, `${action} container ${id}`);
    if (refusal) {
      return refusal;
    }
    try {
      const container = await runAction(client, action, id);
      const name = stripLeadingSlash(container.names[0], id);
      return formatResponse(response_format, `${PAST_TENSE[action]} container ${name}.`, container);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${action} container ${id}: ${message}`);
    }
  };
}

/**
 * Registers the destructive `docker_container_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDockerContainerAction(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Start/Stop/Pause Docker Container",
      description:
        "Changes a container's run state (start | stop | pause | unpause). Requires `confirm: true`. stop/pause disrupt a running container; start/unpause are restorative but still gated for consistency.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createDockerContainerActionHandler(client),
  );
}
```

> **Wiring notes:** (1) mutation results are nested — `data.docker.start`, not `data.start`. (2) The `switch` keeps each branch's return correctly typed from its own generated Mutation type while sharing the `ActionResult` shape. (3) `requireConfirmation` runs **before** the `try`/`execute`, so the gate test asserts `calls.length === 0`.

**Step 5 — register, Step 6 — gate, Step 7 — commit** `feat(docker): add gated docker_container_action lifecycle tool`.

---

## Task 8: `docker_container_remove` (mutation — gate + with_image)

**Files:** `container-remove.graphql`, `container-remove.ts`, `container-remove.test.ts`; modify registry + regenerate.

**Operation:**
```graphql
mutation DockerRemoveContainer($id: PrefixedID!, $withImage: Boolean) {
  docker { removeContainer(id: $id, withImage: $withImage) }
}
```
(`data.docker.removeContainer` is a `Boolean`.)

**Test (key cases):**
- No `confirm` → `isError`, message `/confirm/i`, `calls.length === 0`.
- `confirm: true`, removed true → message `/Removed/` and `calls[0].variables` includes `{ id, withImage: undefined }` (or `false`).
- `with_image: true` → message contains "Image removal attempted"; assert it **never** matches `/image deleted|deleted the image/i`.
- removed false → message says it was not removed.

**Handler (essentials):**
```typescript
const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  id: z.string(),
  with_image: z.boolean().optional(),
  confirm: z.boolean().optional(),
};

// inside the factory:
const refusal = requireConfirmation(confirm, `remove container ${id}`);
if (refusal) return refusal;
try {
  const data = await client.execute(DockerRemoveContainerDocument, { id, withImage: with_image });
  const removed = data.docker.removeContainer;
  const note = with_image ? " Image removal attempted (best-effort)." : "";
  const concise = removed
    ? `Removed container ${id}.${note}`
    : `Container ${id} was not removed (API returned false).`;
  return formatResponse(response_format, concise, { removed });
} catch (error) { /* toolError(`Failed to remove container ${id}: ${message}`) */ }
```

Annotations: `readOnlyHint: false, destructiveHint: true, openWorldHint: false`.
Description: "Permanently deletes a container; force-kills it if running (no graceful stop); irreversible. `with_image` also attempts to delete the image (best-effort — may report success without deleting a shared/in-use image). Requires `confirm: true`. Needs Unraid OS 7.3+."

**Commit:** `feat(docker): add gated docker_container_remove tool`.

---

## Task 9: `docker_container_update` (mutation — gate + ids/all)

**Files:** `container-update.graphql`, `container-update.ts`, `container-update.test.ts`; modify registry + regenerate.

**Operations (two named ops in one file):**
```graphql
mutation DockerUpdateContainers($ids: [PrefixedID!]!) {
  docker { updateContainers(ids: $ids) { id names state status isUpdateAvailable } }
}

mutation DockerUpdateAll {
  docker { updateAllContainers { id names state status } }
}
```

**Target resolution (handler-side, because MCP `inputSchema` is a Zod raw shape — no cross-field `refine`):**
```typescript
const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  ids: z.array(z.string()).nonempty().optional(),
  all: z.boolean().optional(),
  confirm: z.boolean().optional(),
};

/** Resolves the mutually-exclusive target. Returns an error string or a mode. */
function resolveTarget(ids: string[] | undefined, all: boolean | undefined): { error: string } | { mode: "ids" | "all" } {
  const hasIds = ids !== undefined && ids.length > 0;
  if (hasIds && all === true) {
    return { error: "Provide either `ids` or `all`, not both." };
  }
  if (!hasIds && all !== true) {
    return { error: "Provide `ids` (one or more) or `all: true`." };
  }
  return { mode: all === true ? "all" : "ids" };
}
```

**Test (key cases):**
- No `confirm` → `isError`, `/confirm/i`, `calls.length === 0`.
- `ids: []`-equivalent invalid combos (both / neither) with `confirm: true` → `isError`, `/either|provide/i`, `calls.length === 0` (validated before execute).
- `ids: ["srv:abc"]`, `confirm: true` → dispatches `DockerUpdateContainersDocument` with `{ ids: ["srv:abc"] }`; message `/Update requested/i`.
- `all: true`, `confirm: true`, executor returns `{ docker: { updateAllContainers: [] } }` → message `/No containers had an available update/` and **not** `isError` (empty is success, not failure).

**Handler flow:** confirm-gate → `resolveTarget` (return `toolError(error)` on error) → branch: `all` → `execute(DockerUpdateAllDocument)` → `data.docker.updateAllContainers`; `ids` → `execute(DockerUpdateContainersDocument, { ids })` → `data.docker.updateContainers`. Summarize:
```typescript
function summarize(containers: { names: string[] }[]): string {
  if (containers.length === 0) {
    return "No containers had an available update.";
  }
  const names = containers.map((c) => stripLeadingSlash(c.names[0], "(unnamed)"));
  // "requested", not "Updated": updating an orphaned container is a silent
  // no-op — the API returns it unchanged. We must not over-claim a result.
  return `Update requested for ${containers.length} container(s): ${names.join(", ")}.`;
}
```

> **Conscious simplification (orphan detection):** the design said "surface/check `isOrphaned` and warn." This plan does **not** add runtime orphan detection — instead the copy avoids over-claiming ("Update requested for…") and the tool description warns that updating an orphaned (no-template) container is a silent no-op. Runtime per-container orphan warnings can be a follow-up. The `ids` operation still selects `isUpdateAvailable` so detailed output exposes post-update state. The `Updated` → `Update requested` softening updates the test assertion below (`/Update requested/i`).

Annotations: `readOnlyHint: false, destructiveHint: true, openWorldHint: false`.
Description: "Pulls the latest image(s) and recreates container(s). `ids` updates those containers (force-pull regardless of update-available); `all` updates every container with a known-available update (returns none if the cache is cold — not an error). Updating an orphaned container with no template is a silent no-op. Requires `confirm: true`. Needs Unraid OS 7.3+."

**Commit:** `feat(docker): add gated docker_container_update tool`.

---

## Task 10: README documentation

**Files:** Modify `README.md` (tool list + any status/section table the system/storage PR established).

- Add a **Docker** section listing the 7 tools, their args, read/destructive nature, and that mutations require `confirm: true`.
- Add a prominent note: **none of these tools are verified against a live Unraid box**; remove/update need Unraid OS 7.3+; `docker_network_list`/`docker_port_conflicts` are designed to the SDL only.
- Mention `docker_autostart_set` is **planned for PR #3.5** (deferred — REPLACE-all merge-safety).

Match the existing README format (check how PR #2 listed system/storage tools first). **Commit:** `docs: document the Docker tools`.

---

## Task 11: Full quality gate + smoke

**Step 1 — codegen idempotency:** `npm run generate` then `git diff --exit-code src/types/unraid/graphql.ts` → Expected: no diff (types already committed).

**Step 2 — full gate:** `npm run typecheck && npm run build && npm test && npm run lint` → Expected: all pass.

**Step 3 — stdio `tools/list` smoke:** an MCP stdio server requires the `initialize` handshake *before* `tools/list`, so send all three frames. Env vars are `UNRAID_API_URL` (must be a valid URL) and `UNRAID_API_KEY` (non-empty); `tools/list` registers statically and never calls the API, so dummy values are fine. Prefer any existing PR #1/#2 smoke script; otherwise:
```bash
npm run build
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| UNRAID_API_URL=http://localhost/graphql UNRAID_API_KEY=dummy node dist/index.js 2>/dev/null \
| grep -o 'docker_[a-z_]*' | sort -u
```
Expected: the 7 `docker_*` names. Then eyeball the full `tools/list` JSON to confirm the three `docker_container_action`/`_remove`/`_update` tools carry `destructiveHint: true` and the four reads carry `readOnlyHint: true`. (This smoke is run by the maintainer after the automated build, per the dev workflow — not an automated build task.)

**Step 4 — final commit (if anything changed):** none expected; the gate is a verification, not a code step.

---

## Build orchestration & verification (for the executor)

- Build tasks **sequentially** (each depends on prior wiring). After each task: run `npm run typecheck && npm test && npm run lint`; **stop on first failure** and fix before proceeding.
- Per the dev workflow, run each task through a fresh subagent with an **adversarial verify** step (re-run the task's tests + a skeptic read of the diff against this plan and `.claude/rules/`), and do not advance on failure.
- Do **not** claim live verification anywhere — tests are hermetic; the live Unraid path is unexercised.
- After Task 11: push the branch and open a **draft** PR into `develop` (`gh pr create --draft --base develop`), then run `superpowers:requesting-code-review` as a comprehensive multi-agent review and fix everything, including nits.
