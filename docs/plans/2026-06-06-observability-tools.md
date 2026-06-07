# System Observability Tools Implementation Plan (PR #8)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three read-only MCP tools — `log_list`, `log_read` (preflight-allowlisted log windowing), and `system_metrics` (opt-in temperature) — over the Unraid GraphQL observability surface.

**Architecture:** Each tool is a self-contained module (`.ts` + `.graphql` + `.test.ts`) following the established handler-factory pattern: a `create<Tool>Handler(client)` bound to the `GraphQLExecutor` seam, plus a `register<Tool>(server, client)` that wires it into the MCP server. `log_read` makes two sequential GraphQL calls (allowlist preflight, then content). `system_metrics` uses one document with `@include(if: $includeTemperature)`.

**Tech Stack:** TypeScript (NodeNext, `.js` import specifiers), MCP SDK v1.29, zod, graphql-codegen (single committed `src/types/unraid/graphql.ts`), vitest, Biome.

**Design doc:** `docs/plans/2026-06-06-observability-tools-design.md` — read it first; it carries the validated upstream behavior this plan encodes.

---

## Preconditions & conventions (read before Task 1)

- **Branch:** you must be on `feature/observability-tools` (already exists, cut from `develop`). Verify: `git branch --show-current`.
- **Working dir:** repo root `/Users/matt/Developer/mswdev/better-unraid-mcp`.
- **Hard rules (from `.claude/rules/`):** methods ≤ 25 lines, nesting ≤ 2, params ≤ 3 (use a parameter object beyond that), no `any`, no magic numbers (named constants), JSDoc on every export, early returns.
- **Codegen:** after creating/editing any `.graphql` file run `npm run generate`; it rewrites `src/types/unraid/graphql.ts` (committed). Generated names: operation `LogList` → `LogListDocument` + `LogListQuery`.
- **Scalar mapping (matters!):** `BigInt → string` — memory totals and network byte/error counters arrive as **strings**; coerce with `Number(...)` before math. `DateTime → string`, `Int → number`, `Float → number`.
- **Test fakes** live in `src/tools/_shared/test-support.ts`: `firstText`, `recordingExecutor` (canned result + recorded calls), `throwingExecutor`, `rejectingExecutor`, `sequencedExecutor` (ordered results; an `Error` entry throws — use for the two-call `log_read` flow).
- **Fixtures** get `satisfies <Operation>Query` so codegen drift breaks the build.
- **Quality gate after every task:** `npm run typecheck && npm run build && npm test && npm run lint`.
- **Registration is part of each tool task** (PR #7 lesson: a deferred register step fails lint on unused symbols).

---

### Task 1: `log_list`

**Files:**
- Create: `src/tools/log/log-list.graphql`
- Create: `src/tools/log/log-list.test.ts`
- Create: `src/tools/log/log-list.ts`
- Modify: `src/tools/registry.ts` (import + register call)
- Modify: `src/tools/registry.test.ts` (new assertion block)

**Step 1: Create the operation file**

`src/tools/log/log-list.graphql`:

```graphql
query LogList {
  logFiles {
    name
    path
    size
    modifiedAt
  }
}
```

**Step 2: Regenerate types**

Run: `npm run generate`
Expected: completes without error; `git diff --stat src/types/unraid/graphql.ts` shows additions (`LogListDocument`, `LogListQuery`).

**Step 3: Write the failing test**

`src/tools/log/log-list.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { LogListQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createLogListHandler } from "./log-list.js";

const data = {
  logFiles: [
    {
      name: "docker.log",
      path: "/var/log/docker.log",
      size: 2048,
      modifiedAt: "2026-06-05T08:00:00.000Z",
    },
    {
      name: "syslog",
      path: "/var/log/syslog",
      size: 1258291,
      modifiedAt: "2026-06-06T11:58:00.000Z",
    },
  ],
} satisfies LogListQuery;

describe("log_list handler", () => {
  it("lists files most recently modified first with humanized sizes", async () => {
    const { executor } = recordingExecutor(data);

    const result = await createLogListHandler(executor)({ response_format: "concise" });

    const text = firstText(result);
    expect(text.indexOf("syslog")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("syslog")).toBeLessThan(text.indexOf("docker.log"));
    expect(text).toMatch(/1\.2 MB/);
    expect(text).toMatch(/2\.0 KB/);
  });

  it("reports an honestly-ambiguous empty list", async () => {
    const { executor } = recordingExecutor({ logFiles: [] } satisfies LogListQuery);

    const result = await createLogListHandler(executor)({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No log files listed/);
    expect(firstText(result)).toMatch(/unreadable/);
  });

  it("returns the full sorted array for detailed", async () => {
    const { executor } = recordingExecutor(data);

    const result = await createLogListHandler(executor)({ response_format: "detailed" });

    const payload = JSON.parse(firstText(result)) as LogListQuery["logFiles"];
    expect(payload).toHaveLength(2);
    expect(payload[0]?.name).toBe("syslog");
  });

  it("returns an error result when the client throws", async () => {
    const result = await createLogListHandler(throwingExecutor("boom"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list log files/);
    expect(firstText(result)).toMatch(/boom/);
  });

  it("coerces a non-Error rejection to a string", async () => {
    const result = await createLogListHandler(rejectingExecutor("plain refusal"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/plain refusal/);
  });
});
```

**Step 4: Run the test to verify it fails**

Run: `npx vitest run src/tools/log/log-list.test.ts`
Expected: FAIL — cannot find module `./log-list.js`.

**Step 5: Implement the tool**

`src/tools/log/log-list.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { LogListDocument, type LogListQuery } from "../../types/unraid/graphql.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "log_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type LogFiles = LogListQuery["logFiles"];

/** Sorts log files most-recently-modified first (ISO timestamps compare lexically). */
function sortNewestFirst(files: LogFiles): LogFiles {
  return [...files].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Renders one line per file; an empty list is ambiguous upstream (errors are swallowed to []). */
function summarize(files: LogFiles): string {
  if (files.length === 0) {
    return "No log files listed (the API also returns an empty list when the log directory is unreadable).";
  }
  return files
    .map((file) => `${file.name} — ${humanizeBytes(file.size)}, modified ${file.modifiedAt}`)
    .join("\n");
}

/**
 * Creates the `log_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to list log files.
 * @returns An MCP handler returning the server's log file inventory.
 */
export function createLogListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(LogListDocument);
      const files = sortNewestFirst(data.logFiles);
      return formatResponse(response_format, summarize(files), files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list log files: ${message}`);
    }
  };
}

/**
 * Registers the read-only `log_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerLogList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Log Files",
      description:
        "Read-only. Lists the server's log files (name, path, size, last modified), most recently modified first. Pass a returned path or name to log_read. An empty list may also mean the log directory was unreadable — the API does not distinguish.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createLogListHandler(client),
  );
}
```

**Step 6: Run the test to verify it passes**

Run: `npx vitest run src/tools/log/log-list.test.ts`
Expected: PASS (5 tests).

**Step 7: Register in the registry + extend the registry test**

In `src/tools/registry.ts`: add `import { registerLogList } from "./log/log-list.js";` (imports are alphabetized by path — Biome will tell you) and add `registerLogList(server, client);` inside `registerAllTools` (keep the call grouped with the other reads, e.g. after `registerSystemInfo`).

In `src/tools/registry.test.ts`, append inside the top-level `describe`:

```typescript
  it("registers the observability reads as read-only", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    for (const name of ["log_list"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });
```

(The `["log_list"]` array grows to all three names in Tasks 2–3.)

**Step 8: Run the full gate**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all green. If Biome complains about import order, run `npm run format` and re-check.

**Step 9: Commit**

```bash
git add src/tools/log/ src/tools/registry.ts src/tools/registry.test.ts src/types/unraid/graphql.ts
git commit -m "feat(log): add log_list tool — read-only log file inventory"
```

---

### Task 2: `log_read`

**Files:**
- Create: `src/tools/log/log-read.graphql`
- Create: `src/tools/log/log-read.test.ts`
- Create: `src/tools/log/log-read.ts`
- Modify: `src/tools/registry.ts`, `src/tools/registry.test.ts`

**Step 1: Create the operation file (two operations — preflight + content)**

`src/tools/log/log-read.graphql`:

```graphql
query LogReadAllowlist {
  logFiles {
    name
    path
  }
}

query LogReadContent($path: String!, $lines: Int, $startLine: Int) {
  logFile(path: $path, lines: $lines, startLine: $startLine) {
    path
    content
    totalLines
    startLine
  }
}
```

**Step 2: Regenerate types**

Run: `npm run generate`
Expected: adds `LogReadAllowlistDocument/Query` and `LogReadContentDocument/Query/QueryVariables`.

**Step 3: Write the failing test**

`src/tools/log/log-read.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type {
  LogReadAllowlistQuery,
  LogReadContentQuery,
} from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  sequencedExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createLogReadHandler, linesSchema, startLineSchema } from "./log-read.js";

const allowlist = {
  logFiles: [
    { name: "syslog", path: "/var/log/syslog" },
    { name: "docker.log", path: "/var/log/docker.log" },
  ],
} satisfies LogReadAllowlistQuery;

/** A tail of the last 2 lines of a 12-line file. */
const tail = {
  logFile: {
    path: "/var/log/syslog",
    content: "line eleven\nline twelve\n",
    totalLines: 12,
    startLine: 11,
  },
} satisfies LogReadContentQuery;

describe("log_read handler", () => {
  it("reads an allowlisted file by exact path and passes the canonical variables", async () => {
    const { executor, calls } = sequencedExecutor([allowlist, tail]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "/var/log/syslog",
      lines: 100,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.variables).toMatchObject({ path: "/var/log/syslog", lines: 100 });
    expect(firstText(result)).toMatch(/lines 11–12 of 12/);
    expect(firstText(result)).toMatch(/line eleven/);
  });

  it("resolves a bare name to the listed canonical path", async () => {
    const { executor, calls } = sequencedExecutor([allowlist, tail]);

    await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(calls[1]?.variables).toMatchObject({ path: "/var/log/syslog" });
  });

  it("refuses an unknown file without fetching content, listing valid names", async () => {
    const { executor, calls } = recordingExecutor(allowlist);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "/boot/config/super-secret",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(firstText(result)).toMatch(/Unknown log file/);
    expect(firstText(result)).toMatch(/syslog, docker\.log/);
  });

  it("hints an earlier page in tail mode and no later page at EOF", async () => {
    const { executor } = sequencedExecutor([allowlist, tail]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 2,
    });

    expect(firstText(result)).toMatch(/earlier: re-call with start_line=9/);
    expect(firstText(result)).not.toMatch(/later:/);
  });

  it("hints both directions for a mid-file window", async () => {
    const window = {
      logFile: {
        path: "/var/log/syslog",
        content: "line five\nline six\n",
        totalLines: 12,
        startLine: 5,
      },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, window]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 2,
      start_line: 5,
    });

    expect(firstText(result)).toMatch(/lines 5–6 of 12/);
    expect(firstText(result)).toMatch(/earlier: re-call with start_line=3/);
    expect(firstText(result)).toMatch(/later: re-call with start_line=7/);
  });

  it("omits the earlier hint at the start of the file", async () => {
    const head = {
      logFile: {
        path: "/var/log/syslog",
        content: "line one\nline two\n",
        totalLines: 12,
        startLine: 1,
      },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, head]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 2,
      start_line: 1,
    });

    expect(firstText(result)).not.toMatch(/earlier:/);
    expect(firstText(result)).toMatch(/later: re-call with start_line=3/);
  });

  it("explains a start_line past the end of the file", async () => {
    const past = {
      logFile: { path: "/var/log/syslog", content: "", totalLines: 12, startLine: 99 },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, past]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
      start_line: 99,
    });

    expect(firstText(result)).toMatch(/no lines at or after start_line=99/);
    expect(firstText(result)).toMatch(/12 lines/);
  });

  it("reports an empty file", async () => {
    const empty = {
      logFile: { path: "/var/log/syslog", content: "", totalLines: 0, startLine: 1 },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, empty]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(firstText(result)).toMatch(/is empty/);
  });

  it("surfaces a preflight failure", async () => {
    const result = await createLogReadHandler(throwingExecutor("listing broke"))({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to read log file syslog/);
    expect(firstText(result)).toMatch(/listing broke/);
  });

  it("surfaces a content-fetch failure after a clean preflight", async () => {
    const { executor } = sequencedExecutor([allowlist, new Error("read broke")]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/read broke/);
  });

  it("returns the raw payload for detailed", async () => {
    const { executor } = sequencedExecutor([allowlist, tail]);

    const result = await createLogReadHandler(executor)({
      response_format: "detailed",
      path: "syslog",
      lines: 100,
    });

    expect(JSON.parse(firstText(result))).toEqual(tail.logFile);
  });

  it("enforces the lines cap, default, and positivity via the schema", () => {
    expect(linesSchema.safeParse(undefined).success && linesSchema.parse(undefined)).toBe(100);
    expect(linesSchema.safeParse(2000).success).toBe(true);
    expect(linesSchema.safeParse(2001).success).toBe(false);
    expect(linesSchema.safeParse(0).success).toBe(false);
    expect(startLineSchema.safeParse(0).success).toBe(false);
    expect(startLineSchema.safeParse(1).success).toBe(true);
    expect(startLineSchema.safeParse(undefined).success).toBe(true);
  });
});
```

**Step 4: Run the test to verify it fails**

Run: `npx vitest run src/tools/log/log-read.test.ts`
Expected: FAIL — cannot find module `./log-read.js`.

**Step 5: Implement the tool**

`src/tools/log/log-read.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  LogReadAllowlistDocument,
  type LogReadAllowlistQuery,
  LogReadContentDocument,
  type LogReadContentQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "log_read";
const DEFAULT_LINES = 100;
const MAX_LINES = 2000;
/** Cap on names listed in the unknown-file refusal so the error stays short. */
const MAX_NAMES_IN_ERROR = 25;
/** Matches the single trailing newline the API appends to non-empty content. */
const TRAILING_NEWLINE = /\n$/;

/**
 * Validator for `lines`: positive, capped, defaulted. The server applies NO
 * upper bound, so this client-side cap is load-bearing. Exported for tests.
 */
export const linesSchema = z.number().int().positive().max(MAX_LINES).default(DEFAULT_LINES);

/**
 * Validator for `start_line`: 1-indexed when present. The server silently
 * returns empty content for non-positive values, so reject them up front.
 * Exported for tests.
 */
export const startLineSchema = z.number().int().positive().optional();

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  path: z.string().min(1),
  lines: linesSchema,
  start_line: startLineSchema,
};

type AllowedFile = LogReadAllowlistQuery["logFiles"][number];
type Content = LogReadContentQuery["logFile"];

/** The validated handler input (lines is always present via the zod default). */
interface LogReadInput {
  response_format: ResponseFormat;
  path: string;
  lines: number;
  start_line?: number;
}

/** Finds the allowlisted file matching the requested full path or bare name. */
function findAllowed(files: AllowedFile[], path: string): AllowedFile | undefined {
  return files.find((file) => file.path === path || file.name === path);
}

/** Builds the refusal message naming the valid files (capped for brevity). */
function unknownFileError(files: AllowedFile[], path: string): string {
  const names = files
    .map((file) => file.name)
    .slice(0, MAX_NAMES_IN_ERROR)
    .join(", ");
  return `Unknown log file "${path}". Valid files (from log_list): ${names || "(none listed)"}.`;
}

/** Counts returned lines; non-empty content always ends with exactly one newline. */
function countLines(content: string): number {
  if (content === "") {
    return 0;
  }
  return content.replace(TRAILING_NEWLINE, "").split("\n").length;
}

/** Renders the window header, paging hints, and raw content. */
function summarize(file: Content, lines: number): string {
  const returned = countLines(file.content);
  if (file.totalLines === 0) {
    return `${file.path} is empty (0 lines).`;
  }
  if (returned === 0) {
    return `${file.path}: no lines at or after start_line=${file.startLine} (file has ${file.totalLines} lines).`;
  }
  const first = file.startLine ?? 1;
  const last = first + returned - 1;
  const parts = [`${file.path} — lines ${first}–${last} of ${file.totalLines}`];
  if (first > 1) {
    parts.push(`— earlier: re-call with start_line=${Math.max(1, first - lines)}`);
  }
  if (last < file.totalLines) {
    parts.push(`— later: re-call with start_line=${last + 1}`);
  }
  parts.push("", file.content.replace(TRAILING_NEWLINE, ""));
  return parts.join("\n");
}

/**
 * Creates the `log_read` handler bound to a GraphQL executor. The handler
 * preflights the requested path against the live `logFiles` allowlist and
 * refuses anything not listed, then fetches the requested window.
 *
 * @param client - The GraphQL executor used for the preflight and the read.
 * @returns An MCP handler returning a window of log lines.
 */
export function createLogReadHandler(client: GraphQLExecutor) {
  return async (input: LogReadInput): Promise<CallToolResult> => {
    try {
      const preflight = await client.execute(LogReadAllowlistDocument);
      const allowed = findAllowed(preflight.logFiles, input.path);
      if (!allowed) {
        return toolError(unknownFileError(preflight.logFiles, input.path));
      }
      const data = await client.execute(LogReadContentDocument, {
        path: allowed.path,
        lines: input.lines,
        startLine: input.start_line,
      });
      return formatResponse(
        input.response_format,
        summarize(data.logFile, input.lines),
        data.logFile,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to read log file ${input.path}: ${message}`);
    }
  };
}

/**
 * Registers the read-only `log_read` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerLogRead(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Read Log File",
      description:
        "Read-only. Returns lines from a server log file. `path` is a path or name from log_list — validated against that list before reading (reads are limited to filenames the server lists in its log directory; symlinked entries are read as the server resolves them). Omitting `start_line` returns the last `lines` lines (default 100, max 2000); pass `start_line` (1-indexed) to window from there and re-call with the hinted values to page. Counts may drift slightly on rapidly-growing logs; the cap bounds line count, not bytes.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createLogReadHandler(client),
  );
}
```

**Step 6: Run the test to verify it passes**

Run: `npx vitest run src/tools/log/log-read.test.ts`
Expected: PASS (12 tests).

**Step 7: Register**

`src/tools/registry.ts`: import `registerLogRead` from `./log/log-read.js`, call it after `registerLogList`. In `registry.test.ts`, grow the observability array to `["log_list", "log_read"]`.

**Step 8: Run the full gate**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all green.

**Step 9: Commit**

```bash
git add src/tools/log/ src/tools/registry.ts src/tools/registry.test.ts src/types/unraid/graphql.ts
git commit -m "feat(log): add log_read tool — allowlist-preflighted log windowing"
```

---

### Task 3: `system_metrics`

**Files:**
- Create: `src/tools/system/system-metrics.graphql`
- Create: `src/tools/system/system-metrics.test.ts`
- Create: `src/tools/system/system-metrics.ts`
- Modify: `src/tools/registry.ts`, `src/tools/registry.test.ts`

**Step 1: Create the operation file**

`src/tools/system/system-metrics.graphql`:

```graphql
query SystemMetrics($includeTemperature: Boolean!) {
  metrics {
    cpu {
      percentTotal
      cpus {
        percentTotal
      }
    }
    memory {
      total
      used
      free
      available
      percentTotal
      swapTotal
      swapUsed
      percentSwapTotal
    }
    temperature @include(if: $includeTemperature) {
      sensors {
        name
        type
        current {
          value
          unit
          status
        }
        warning
        critical
      }
      summary {
        average
        warningCount
        criticalCount
        hottest {
          name
          current {
            value
            unit
          }
        }
      }
    }
    network {
      name
      operstate
      rxSec
      txSec
      utilizationPercent
      bytesReceived
      bytesSent
      receiveErrors
      transmitErrors
      receiveDropped
      transmitDropped
      lastUpdated
    }
  }
  systemTime {
    currentTime
    timeZone
    useNtp
  }
}
```

**Step 2: Regenerate types**

Run: `npm run generate`
Expected: adds `SystemMetricsDocument/Query/QueryVariables`. Note `temperature` is optional in the generated type because of `@include`.

**Step 3: Write the failing test**

`src/tools/system/system-metrics.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { SystemMetricsQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createSystemMetricsHandler } from "./system-metrics.js";

const eth0 = {
  name: "eth0",
  operstate: "up",
  rxSec: 1258291.2,
  txSec: 348160,
  utilizationPercent: 1.2,
  bytesReceived: "1234567890",
  bytesSent: "987654321",
  receiveErrors: "0",
  transmitErrors: "0",
  receiveDropped: "0",
  transmitDropped: "0",
  lastUpdated: "2026-06-06T12:00:08.000Z",
};

const full = {
  metrics: {
    cpu: { percentTotal: 12.3, cpus: [{ percentTotal: 5.1 }, { percentTotal: 45.2 }] },
    memory: {
      total: "33715179520",
      used: "30000000000",
      free: "1000000000",
      available: "18253611008",
      percentTotal: 45.9,
      swapTotal: "2147483648",
      swapUsed: "0",
      percentSwapTotal: 0,
    },
    temperature: {
      sensors: [
        {
          name: "CPU Package",
          type: "CPU_PACKAGE",
          current: { value: 55.5, unit: "CELSIUS", status: "NORMAL" },
          warning: 85,
          critical: 95,
        },
      ],
      summary: {
        average: 42.1,
        warningCount: 0,
        criticalCount: 0,
        hottest: { name: "CPU Package", current: { value: 55.5, unit: "CELSIUS" } },
      },
    },
    network: [eth0, { ...eth0, name: "lo", operstate: "unknown" }],
  },
  systemTime: {
    currentTime: "2026-06-06T16:00:08.000Z",
    timeZone: "America/New_York",
    useNtp: true,
  },
} satisfies SystemMetricsQuery;

describe("system_metrics handler", () => {
  it("omits temperature by default and passes includeTemperature=false", async () => {
    const { executor, calls } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(calls[0]?.variables).toMatchObject({ includeTemperature: false });
    const text = firstText(result);
    expect(text).toMatch(/As of 2026-06-06T16:00:08\.000Z \(America\/New_York, NTP on\):/);
    expect(text).toMatch(/CPU: 12% total, 2 threads \(busiest 45%\)/);
    expect(text).not.toMatch(/Temperature/);
  });

  it("pairs memory percent with available bytes, never the cache-inclusive used figure", async () => {
    const { executor } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/Memory: 46% used — 17\.0 GB available of 31\.4 GB \(swap 0%\)/);
  });

  it("renders temperature when requested and populated", async () => {
    const { executor, calls } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: true,
    });

    expect(calls[0]?.variables).toMatchObject({ includeTemperature: true });
    expect(firstText(result)).toMatch(
      /Temperature: avg 42\.1°C — 0 warning, 0 critical \(hottest: CPU Package 55\.5°C\)/,
    );
  });

  it("reports unavailable temperature when requested but null", async () => {
    const nullTemp = {
      metrics: { ...full.metrics, temperature: null },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(nullTemp);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: true,
    });

    expect(firstText(result)).toMatch(/Temperature: unavailable/);
  });

  it("renders up interfaces with rates and counts the rest", async () => {
    const { executor } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/Network: eth0 up — rx 1\.2 MB\/s, tx 340\.0 KB\/s, 0 errors \(1 not up omitted\)/);
  });

  it("falls back per section when cpu or memory is null", async () => {
    const degraded = {
      metrics: { ...full.metrics, cpu: null, memory: null },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(degraded);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/CPU: unavailable/);
    expect(firstText(result)).toMatch(/Memory: unavailable/);
  });

  it("reports when no interfaces are listed", async () => {
    const noNet = {
      metrics: { ...full.metrics, network: [] },
      systemTime: full.systemTime,
    } satisfies SystemMetricsQuery;
    const { executor } = recordingExecutor(noNet);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "concise",
      include_temperature: false,
    });

    expect(firstText(result)).toMatch(/Network: no interfaces reported/);
  });

  it("returns the pinned raw payload for detailed", async () => {
    const { executor } = recordingExecutor(full);

    const result = await createSystemMetricsHandler(executor)({
      response_format: "detailed",
      include_temperature: true,
    });

    expect(JSON.parse(firstText(result))).toEqual(full);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createSystemMetricsHandler(throwingExecutor("probe failed"))({
      response_format: "concise",
      include_temperature: false,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch system metrics/);
    expect(firstText(result)).toMatch(/probe failed/);
  });
});
```

**Step 4: Run the test to verify it fails**

Run: `npx vitest run src/tools/system/system-metrics.test.ts`
Expected: FAIL — cannot find module `./system-metrics.js`.

**Step 5: Implement the tool**

`src/tools/system/system-metrics.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  SystemMetricsDocument,
  type SystemMetricsQuery,
} from "../../types/unraid/graphql.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "system_metrics";

/** Display suffix per API temperature unit. */
const UNIT_SUFFIXES: Record<string, string> = {
  CELSIUS: "C",
  FAHRENHEIT: "F",
  KELVIN: "K",
  RANKINE: "R",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  include_temperature: z.boolean().default(false),
};

type Metrics = SystemMetricsQuery["metrics"];
type SystemTime = SystemMetricsQuery["systemTime"];

/** Renders the server-time header line. */
function timeLine(time: SystemTime): string {
  return `As of ${time.currentTime} (${time.timeZone}, NTP ${time.useNtp ? "on" : "off"}):`;
}

/** Renders total CPU load and the busiest thread. */
function cpuLine(cpu: Metrics["cpu"]): string {
  if (!cpu) {
    return "CPU: unavailable";
  }
  const threads = cpu.cpus.length;
  const busiest =
    threads > 0 ? Math.max(...cpu.cpus.map((core) => core.percentTotal)) : undefined;
  const busiestNote = busiest === undefined ? "" : ` (busiest ${busiest.toFixed(0)}%)`;
  return `CPU: ${cpu.percentTotal.toFixed(0)}% total, ${threads} threads${busiestNote}`;
}

/** Renders memory pressure; pairs percentTotal with available ('used' counts cache and contradicts it). */
function memoryLine(memory: Metrics["memory"]): string {
  if (!memory) {
    return "Memory: unavailable";
  }
  const available = humanizeBytes(Number(memory.available));
  const total = humanizeBytes(Number(memory.total));
  const swap = memory.percentSwapTotal.toFixed(0);
  return `Memory: ${memory.percentTotal.toFixed(0)}% used — ${available} available of ${total} (swap ${swap}%)`;
}

/** Renders the temperature line, or null when the section was not requested. */
function temperatureLine(metrics: Metrics, included: boolean): string | null {
  if (!included) {
    return null;
  }
  if (!metrics.temperature) {
    return "Temperature: unavailable (no sensors or collection disabled)";
  }
  const { summary } = metrics.temperature;
  const unit = UNIT_SUFFIXES[summary.hottest.current.unit] ?? "?";
  const hottest = `${summary.hottest.name} ${summary.hottest.current.value.toFixed(1)}°${unit}`;
  return `Temperature: avg ${summary.average.toFixed(1)}°${unit} — ${summary.warningCount} warning, ${summary.criticalCount} critical (hottest: ${hottest})`;
}

/** Summarizes one up interface: throughput and total error count. */
function interfaceSummary(iface: Metrics["network"][number]): string {
  const errors = Number(iface.receiveErrors) + Number(iface.transmitErrors);
  return `${iface.name} up — rx ${humanizeBytes(iface.rxSec)}/s, tx ${humanizeBytes(iface.txSec)}/s, ${errors} errors`;
}

/** Renders one entry per up interface, counting the rest. */
function networkLine(network: Metrics["network"]): string {
  if (network.length === 0) {
    return "Network: no interfaces reported";
  }
  const up = network.filter((iface) => iface.operstate === "up");
  if (up.length === 0) {
    return `Network: no interfaces up (${network.length} reported)`;
  }
  const others = network.length - up.length;
  const othersNote = others > 0 ? ` (${others} not up omitted)` : "";
  return `Network: ${up.map(interfaceSummary).join("; ")}${othersNote}`;
}

/** Builds the concise multi-line snapshot, omitting unrequested sections. */
function summarize(data: SystemMetricsQuery, includeTemperature: boolean): string {
  const lines = [
    timeLine(data.systemTime),
    cpuLine(data.metrics.cpu),
    memoryLine(data.metrics.memory),
    temperatureLine(data.metrics, includeTemperature),
    networkLine(data.metrics.network),
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
 * Creates the `system_metrics` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch the snapshot.
 * @returns An MCP handler returning a point-in-time system health snapshot.
 */
export function createSystemMetricsHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    include_temperature,
  }: {
    response_format: ResponseFormat;
    include_temperature: boolean;
  }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(SystemMetricsDocument, {
        includeTemperature: include_temperature,
      });
      return formatResponse(response_format, summarize(data, include_temperature), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch system metrics: ${message}`);
    }
  };
}

/**
 * Registers the read-only `system_metrics` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerSystemMetrics(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get System Metrics",
      description:
        "Read-only. Point-in-time health snapshot: CPU load, memory pressure (percent + available bytes), per-interface network rates/errors, and server time (timezone, NTP). Set include_temperature=true to also probe temperature sensors — omitted by default because a cold probe can take seconds on multi-disk servers. Network rates read 0 right after the Unraid API restarts. Requires INFO+VARS read permission (any viewer-level key).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createSystemMetricsHandler(client),
  );
}
```

**Step 6: Run the test to verify it passes**

Run: `npx vitest run src/tools/system/system-metrics.test.ts`
Expected: PASS (9 tests). If the memory/network rendering assertions fail on formatting (e.g. `46%` vs `45.9` rounding or `340.0 KB` vs `340 KB`), check `humanizeBytes`/`toFixed` output and fix the TEST expectation to the actual deterministic output — the fixture values are chosen so: `45.9.toFixed(0) === "46"`, `humanizeBytes(18253611008) === "17.0 GB"`, `humanizeBytes(33715179520) === "31.4 GB"`, `humanizeBytes(1258291.2) === "1.2 MB"`, `humanizeBytes(348160) === "340.0 KB"`.

**Step 7: Register**

`src/tools/registry.ts`: import `registerSystemMetrics` from `./system/system-metrics.js`, call it right after `registerSystemInfo`. In `registry.test.ts`, grow the observability array to `["log_list", "log_read", "system_metrics"]`.

**Step 8: Run the full gate**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all green.

**Step 9: Commit**

```bash
git add src/tools/system/ src/tools/registry.ts src/tools/registry.test.ts src/types/unraid/graphql.ts
git commit -m "feat(system): add system_metrics tool — health snapshot with opt-in temperature"
```

---

### Task 4: README

**Files:**
- Modify: `README.md`

**Step 1: Add the tools to the README**

Read the README's existing tool tables first (System & storage table near the top; per-domain annotated tables below — mirror the `docker_container_logs` row format exactly). Add an "Observability" section/table with three rows:

| Tool | Access | Description |
|------|--------|-------------|
| `log_list` | read-only | Lists the server's log files (name, path, size, last modified), most recently modified first. An empty list may also mean the log directory was unreadable. |
| `log_read` | read-only | Returns lines from a log file. `path` is a path or name from `log_list` (validated against that list before reading). Tail by default (`lines` default 100, max 2000); `start_line` (1-indexed) windows from there. |
| `system_metrics` | read-only | Point-in-time snapshot: CPU, memory, network rates, server time/NTP. `include_temperature=true` adds sensor data (may take seconds on multi-disk servers). Needs a viewer-level key (INFO+VARS read). |

Match the README's actual column layout — if the existing tables use two columns, drop the Access column and lead the description with "Read-only."

**Step 2: Gate + commit**

Run: `npm run lint`
Expected: green (markdown untouched by Biome, but cheap to confirm).

```bash
git add README.md
git commit -m "docs: document log_list, log_read, and system_metrics in the README"
```

---

### Task 5: Full verification

**Step 1: Full gate from clean state**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all green, zero warnings.

**Step 2: Codegen idempotency**

Run: `npm run generate && git diff --exit-code src/types/unraid/graphql.ts`
Expected: exit 0 (no diff — the committed file is exactly what codegen produces).

**Step 3: stdio smoke — initialize → tools/list via the MCP SDK client**

Run:

```bash
node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, UNRAID_API_URL: 'https://tower.local/graphql', UNRAID_API_KEY: 'smoke-key' },
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
const names = (await client.listTools()).tools.map((tool) => tool.name);
for (const expected of ['log_list', 'log_read', 'system_metrics']) {
  if (!names.includes(expected)) throw new Error('missing tool: ' + expected);
}
console.log('SMOKE OK — ' + names.length + ' tools: ' + names.join(', '));
await client.close();
"
```

Expected: `SMOKE OK — 27 tools: ...` (24 existing + 3 new) including the three new names.

**Step 4: Review the diff against the design doc**

Run: `git log --oneline origin/develop..HEAD` and `git diff origin/develop --stat`
Confirm: only `src/tools/log/**`, `src/tools/system/system-metrics.*`, `src/tools/registry.{ts,test.ts}`, `src/types/unraid/graphql.ts`, `README.md`, `docs/plans/*`.

---

### Task 6: Push + draft PR

**Step 1: Push**

```bash
git push -u origin feature/observability-tools
```

**Step 2: Draft PR into develop**

```bash
gh pr create --draft --base develop \
  --title "feat: system observability tools (log_list, log_read, system_metrics)" \
  --body "$(cat <<'EOF'
## What

Three read-only observability tools completing the triage story (alert fires → read metrics → grep logs):

- **log_list** — inventory of the server's log files (name, path, size, modified), newest first.
- **log_read** — tail/window one log file. Preflight-allowlisted against `logFiles` (client-side refusal for unlisted paths); tail by default (`lines` default 100, max **2000** — the server has NO upper bound, the client cap is load-bearing); `start_line` paging with hints.
- **system_metrics** — point-in-time snapshot: CPU, memory (percent + available — `used` counts cache and is never rendered next to the percent), per-interface network rates/errors, server time/NTP. Temperature is **opt-in** (`include_temperature`, default false) because a cold probe execs smartctl per disk with no timeout.

## Design & validation

- Design doc: `docs/plans/2026-06-06-observability-tools-design.md` (decisions + validated upstream findings).
- Source-validated against **unraid/api @ 264ddf0 (v4.35.0)**: 6 areas, each finding adversarially verified, plus a completeness critic. Key findings encoded: upstream tails by default (lines=100); path confinement is **filename-level** (`basename()`-join — symlinks inside the log dir are followed; the allowlist guarantees a *listed filename*, not a resolved target); per-section null degradation is real only for temperature; `BigInt → string` coercions; VIEWER keys suffice (LOGS/INFO/VARS READ_ANY).

## ⚠ Release gate (standing)

**Nothing in this PR is live-verified against a real Unraid box.** All behavior is source-validated at the pinned commit above. Do not publish a release claiming live verification.

## Files

- `src/tools/log/log-list.{ts,graphql,test.ts}` — new
- `src/tools/log/log-read.{ts,graphql,test.ts}` — new
- `src/tools/system/system-metrics.{ts,graphql,test.ts}` — new
- `src/tools/registry.{ts,test.ts}` — +3 registrations
- `src/types/unraid/graphql.ts` — regenerated
- `README.md`, `docs/plans/*` — docs
EOF
)"
```

Expected: PR URL printed; PR is a **draft** into `develop`.
