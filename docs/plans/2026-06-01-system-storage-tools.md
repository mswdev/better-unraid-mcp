# System & Storage Tools Implementation Plan (PR #2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the read-only system & storage tool domain (`array_status`, `parity_history`, `disk_list`, `share_list`) onto the merged scaffold, rename `get_system_info` → `system_info`, and add the supporting `BigInt` scalar mapping + a `format-bytes` helper.

**Architecture:** Each tool is a discrete, resource-namespaced module under `src/tools/<resource>/` that reuses the existing patterns: a `.graphql` operation (codegen → the single committed `src/types/unraid/graphql.ts`), a handler bound to the `GraphQLExecutor` seam, `readOnlyHint` annotations, and concise/detailed output via `_shared/respond.ts`. All tools are read-only; no confirm-gate. Tests are hermetic with hand-written fake executors and typed fixtures (`satisfies`).

**Tech Stack:** Same as the scaffold — TS5 strict ESM NodeNext, `@modelcontextprotocol/sdk` v1.29, `zod`, graphql-codegen (typed-document-node), `vitest`, `@biomejs/biome`.

---

## Conventions (same as PR #1 — re-read before each task)

1. **NodeNext = `.js` import extensions** on every relative import.
2. **No `any`**; guard nullable schema fields with `??` fallbacks.
3. **≤25-line methods, ≤2 nesting, ≤3 params, JSDoc on every export, no magic numbers.**
4. **Tests hermetic** — fake the `GraphQLExecutor`; type fixtures with `satisfies <Op>Query` so codegen drift breaks the build. Read text blocks via `firstText` from `src/tools/_shared/test-support.js`.
5. **Resource-first tool names** (`array_status`, `disk_list`, …). All tools `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`.
6. **Conventional commits, one logical change per task.** Branch `feature/system-storage-tools` (already created off `develop`). Never push / open PR from the plan — that is done after review.

**Quality gate (before each commit):**
```bash
npm run typecheck && npm run build && npm test && npm run lint
```
After any `.graphql` change also run `npm run generate` and confirm `git status --porcelain src/types/unraid/` is empty after committing the regenerated file.

**Reference implementation:** copy the structure of the existing `src/tools/system/get-system-info.ts` (input schema → `createXxxHandler(client)` → `registerXxx(server, client)` → `summarize()`), the test shape of `get-system-info.test.ts`, and the registry pattern in `src/tools/registry.ts`.

---

## Task 0: Verify starting state

Run: `git rev-parse --abbrev-ref HEAD && git status --porcelain && npm run typecheck && npm test`
Expected: on `feature/system-storage-tools`, clean tree, gate green (30 tests).

---

## Task 1: `format-bytes` helper

**Files:** Create `src/tools/_shared/format-bytes.ts`, `src/tools/_shared/format-bytes.test.ts`

**Step 1: Write the failing test** `src/tools/_shared/format-bytes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { humanizeBytes, humanizeKilobytes, toNumber } from "./format-bytes.js";

describe("humanizeBytes", () => {
  it("formats zero and sub-KB as bytes", () => {
    expect(humanizeBytes(0)).toBe("0 B");
    expect(humanizeBytes(512)).toBe("512 B");
  });

  it("scales up to KB/GB with one decimal", () => {
    expect(humanizeBytes(1536)).toBe("1.5 KB");
    expect(humanizeBytes(1024 * 1024 * 1024 * 1.5)).toBe("1.5 GB");
  });

  it("treats non-finite or negative input as zero", () => {
    expect(humanizeBytes(Number.NaN)).toBe("0 B");
    expect(humanizeBytes(-5)).toBe("0 B");
  });
});

describe("humanizeKilobytes", () => {
  it("converts kilobytes through the byte formatter", () => {
    expect(humanizeKilobytes(1024)).toBe("1.0 MB");
  });
});

describe("toNumber", () => {
  it("parses numeric strings and falls back to 0", () => {
    expect(toNumber("123")).toBe(123);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("not-a-number")).toBe(0);
  });
});
```

**Step 2: Run to verify it fails**
Run: `npx vitest run src/tools/_shared/format-bytes.test.ts`
Expected: FAIL — cannot resolve `./format-bytes.js`.

**Step 3: Implement** `src/tools/_shared/format-bytes.ts`:
```ts
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const UNIT_STEP = 1024;
const DECIMALS = 1;

/**
 * Formats a byte count as a human-readable string (e.g. `1.5 GB`).
 *
 * @param bytes - The number of bytes; non-finite or negative becomes `0 B`.
 * @returns A human-readable size string.
 */
export function humanizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= UNIT_STEP && unitIndex < BYTE_UNITS.length - 1) {
    value /= UNIT_STEP;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(DECIMALS);
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Formats a kilobyte count as a human-readable string.
 *
 * @param kilobytes - The number of kilobytes.
 * @returns A human-readable size string.
 */
export function humanizeKilobytes(kilobytes: number): string {
  return humanizeBytes(kilobytes * UNIT_STEP);
}

/**
 * Parses a possibly-null numeric string into a number, defaulting to 0.
 *
 * @param value - The value to parse (e.g. a `BigInt`-as-string field).
 * @returns The parsed number, or 0 when null/invalid.
 */
export function toNumber(value: string | null | undefined): number {
  if (value == null) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
```

**Step 4: Run to verify it passes**
Run: `npx vitest run src/tools/_shared/format-bytes.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/tools/_shared/format-bytes.ts src/tools/_shared/format-bytes.test.ts
git commit -m "feat(tools): add human-readable byte/kilobyte formatting helper"
```

---

## Task 2: Map the `BigInt` scalar in codegen

**Files:** Modify `codegen.ts`

**Step 1:** In `codegen.ts`, add `BigInt: "string"` to the `scalars` map (Unraid serializes `BigInt` as a JSON string to preserve precision). The block becomes:
```ts
        scalars: {
          DateTime: "string",
          PrefixedID: "string",
          JSON: "unknown",
          BigInt: "string",
          Long: "number",
          Port: "number",
          URL: "string",
        },
```

**Step 2: Verify generation is still clean** (no operation uses `BigInt` yet, so no diff):
Run: `npm run generate && git status --porcelain src/types/unraid/`
Expected: empty output (no change yet — the mapping takes effect when the first `BigInt`-selecting operation is added in Task 4).

**Step 3: Commit**
```bash
git add codegen.ts
git commit -m "build(codegen): map the BigInt scalar to string"
```

---

## Task 3: Rename `get_system_info` → `system_info`

**Files:** rename `src/tools/system/get-system-info.{ts,graphql,test.ts}` → `system-info.*`; modify `src/tools/registry.ts`, `README.md`; regenerate types.

**Step 1: Rename the files**
```bash
git mv src/tools/system/get-system-info.ts src/tools/system/system-info.ts
git mv src/tools/system/get-system-info.graphql src/tools/system/system-info.graphql
git mv src/tools/system/get-system-info.test.ts src/tools/system/system-info.test.ts
```

**Step 2: Rename the operation** in `src/tools/system/system-info.graphql` — change `query GetSystemInfo {` to `query SystemInfo {` (everything else unchanged).

**Step 3: Regenerate types**
Run: `npm run generate`
Expected: `src/types/unraid/graphql.ts` now exports `SystemInfoQuery`, `SystemInfoQueryVariables`, `SystemInfoDocument` (the `GetSystemInfo*` names are gone).

**Step 4: Update `src/tools/system/system-info.ts`** — rename the symbols and tool name:
- `const TOOL_NAME = "get_system_info";` → `const TOOL_NAME = "system_info";`
- import: `import { SystemInfoDocument, type SystemInfoQuery } from "../../types/unraid/graphql.js";`
- `function summarize(data: GetSystemInfoQuery)` → `function summarize(data: SystemInfoQuery)`
- `createGetSystemInfoHandler` → `createSystemInfoHandler`; inside, `client.execute(SystemInfoDocument)`
- `registerGetSystemInfo` → `registerSystemInfo`
- title stays `"Get Unraid System Info"`; update the description's leading word if it says "Read-only." (keep as is).

**Step 5: Update `src/tools/system/system-info.test.ts`** — `createGetSystemInfoHandler` → `createSystemInfoHandler`, and `GetSystemInfoQuery` → `SystemInfoQuery` (both the `import type` and the two `satisfies GetSystemInfoQuery` fixtures).

**Step 6: Update `src/tools/registry.ts`**:
```ts
import { registerSystemInfo } from "./system/system-info.js";
// ...
export function registerAllTools(server: McpServer, client: GraphQLExecutor): void {
  registerSystemInfo(server, client);
}
```

**Step 7: Update `README.md`** — replace `get_system_info` with `system_info` everywhere it appears (the Status line and any tool reference).

**Step 8: Full gate**
Run: `npm run typecheck && npm run build && npm test && npm run lint && git status --porcelain src/types/unraid/`
Expected: green; codegen status empty.

**Step 9: Verify the tool name over stdio**
Run the stdio `tools/list` smoke (as in PR #1) and confirm the tool is now `system_info`.

**Step 10: Commit**
```bash
git add -A
git commit -m "refactor(tools): rename get_system_info to system_info (resource-first naming)"
```

---

## Task 4: `array_status` tool

**Files:** Create `src/tools/array/array-status.graphql`, `src/tools/array/array-status.ts`, `src/tools/array/array-status.test.ts`; modify `src/tools/registry.ts`.

**Step 1: Create the operation** `src/tools/array/array-status.graphql`:
```graphql
query ArrayStatus {
  array {
    state
    capacity {
      kilobytes {
        free
        used
        total
      }
    }
    parityCheckStatus {
      status
      progress
      errors
      running
      paused
    }
    parities {
      name
      status
      temp
      type
    }
    disks {
      name
      status
      temp
      fsFree
      fsUsed
      fsSize
      numErrors
      isSpinning
      type
    }
    caches {
      name
      status
      temp
      fsFree
      fsUsed
      type
    }
  }
}
```

**Step 2: Regenerate**
Run: `npm run generate`
Expected: `ArrayStatusDocument`, `ArrayStatusQuery` exported; the `BigInt` fields (`fsFree`, `fsUsed`, `fsSize`, `numErrors`) are typed `string | null` (thanks to Task 2).

**Step 3: Write the failing test** `src/tools/array/array-status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ArrayStatusQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createArrayStatusHandler } from "./array-status.js";

const started = {
  array: {
    state: "STARTED",
    capacity: { kilobytes: { free: "40000000000", used: "60000000000", total: "100000000000" } },
    parityCheckStatus: { status: "COMPLETED", progress: 100, errors: 0, running: false, paused: false },
    parities: [{ name: "parity", status: "DISK_OK", temp: 35, type: "PARITY" }],
    disks: [
      { name: "disk1", status: "DISK_OK", temp: 33, fsFree: "1", fsUsed: "2", fsSize: "3", numErrors: "0", isSpinning: true, type: "DATA" },
      { name: "disk2", status: "DISK_DSBL", temp: null, fsFree: "1", fsUsed: "2", fsSize: "3", numErrors: "5", isSpinning: false, type: "DATA" },
    ],
    caches: [{ name: "cache", status: "DISK_OK", temp: 40, fsFree: "1", fsUsed: "2", type: "CACHE" }],
  },
} satisfies ArrayStatusQuery;

function fakeExecutor(result: ArrayStatusQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

function throwingExecutor(message: string): GraphQLExecutor {
  return { execute: () => Promise.reject(new Error(message)) };
}

describe("array_status handler", () => {
  it("summarizes state, capacity %, parity and disk counts", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/STARTED/);
    expect(firstText(result)).toMatch(/60%/);
    expect(firstText(result)).toMatch(/1\/2 data OK/);
  });

  it("returns detailed JSON when asked", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({ response_format: "detailed" });

    expect(firstText(result)).toContain('"state": "STARTED"');
  });

  it("returns an error result when the client throws", async () => {
    const result = await createArrayStatusHandler(throwingExecutor("denied"))({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/denied/);
  });
});
```

**Step 4: Run to verify it fails**
Run: `npx vitest run src/tools/array/array-status.test.ts`
Expected: FAIL — cannot resolve `./array-status.js`.

**Step 5: Implement** `src/tools/array/array-status.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ArrayStatusDocument, type ArrayStatusQuery } from "../../types/unraid/graphql.js";
import { humanizeKilobytes, toNumber } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "array_status";
const PERCENT = 100;
const DISK_OK = "DISK_OK";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/** Builds a one-line summary of the array's health. */
function summarize(data: ArrayStatusQuery): string {
  const { array } = data;
  const totalKb = toNumber(array.capacity.kilobytes.total);
  const usedKb = toNumber(array.capacity.kilobytes.used);
  const percent = totalKb > 0 ? Math.round((usedKb / totalKb) * PERCENT) : 0;
  const dataOk = array.disks.filter((disk) => disk.status === DISK_OK).length;
  const parity = array.parityCheckStatus;
  return `Array ${array.state} — ${humanizeKilobytes(usedKb)} / ${humanizeKilobytes(totalKb)} used (${percent}%). Parity: ${parity.status}, ${parity.errors ?? 0} errors. Disks: ${dataOk}/${array.disks.length} data OK, ${array.parities.length} parity, ${array.caches.length} cache.`;
}

/**
 * Creates the `array_status` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch array status.
 * @returns An MCP tool handler producing an array-health summary.
 */
export function createArrayStatusHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ArrayStatusDocument);
      return formatResponse(response_format, summarize(data), data.array);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch array status: ${message}`);
    }
  };
}

/**
 * Registers the read-only `array_status` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerArrayStatus(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Unraid Array Status",
      description:
        "Read-only. Returns the array state, capacity, current parity-check status, and a per-disk health summary (data, parity, and cache disks).",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createArrayStatusHandler(client),
  );
}
```

**Step 6: Register** — in `src/tools/registry.ts` add the import and call:
```ts
import { registerArrayStatus } from "./array/array-status.js";
// inside registerAllTools, after registerSystemInfo:
registerArrayStatus(server, client);
```

**Step 7: Run tests + gate**
Run: `npx vitest run src/tools/array/array-status.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

**Step 8: Commit**
```bash
git add src/tools/array/array-status.ts src/tools/array/array-status.graphql src/tools/array/array-status.test.ts src/tools/registry.ts src/types/unraid/graphql.ts
git commit -m "feat(tools): add read-only array_status tool"
```

---

## Task 5: `parity_history` tool

**Files:** Create `src/tools/array/parity-history.{graphql,ts,test.ts}`; modify `src/tools/registry.ts`.

**Step 1: Operation** `src/tools/array/parity-history.graphql`:
```graphql
query ParityHistory {
  parityHistory {
    date
    duration
    speed
    status
    errors
    correcting
  }
}
```

**Step 2: Regenerate** → `npm run generate` (exports `ParityHistoryDocument`, `ParityHistoryQuery`).

**Step 3: Failing test** `src/tools/array/parity-history.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ParityHistoryQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createParityHistoryHandler } from "./parity-history.js";

const history = {
  parityHistory: [
    { date: "2026-05-30T00:00:00Z", duration: 3600, speed: "180", status: "COMPLETED", errors: 0, correcting: true },
    { date: "2026-04-30T00:00:00Z", duration: 3700, speed: "175", status: "COMPLETED", errors: 2, correcting: true },
  ],
} satisfies ParityHistoryQuery;

function fakeExecutor(result: ParityHistoryQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("parity_history handler", () => {
  it("summarizes the most recent check", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(history))({
      response_format: "concise",
      limit: 5,
    });

    expect(firstText(result)).toMatch(/COMPLETED/);
    expect(firstText(result)).toMatch(/0 errors/);
  });

  it("limits the detailed list", async () => {
    const result = await createParityHistoryHandler(fakeExecutor(history))({
      response_format: "detailed",
      limit: 1,
    });

    const parsed = JSON.parse(firstText(result));
    expect(parsed).toHaveLength(1);
  });

  it("handles an empty history", async () => {
    const result = await createParityHistoryHandler(fakeExecutor({ parityHistory: [] }))({
      response_format: "concise",
      limit: 5,
    });

    expect(firstText(result)).toMatch(/No parity checks/);
  });
});
```

**Step 4: Run to verify it fails.** `npx vitest run src/tools/array/parity-history.test.ts` → FAIL.

**Step 5: Implement** `src/tools/array/parity-history.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ParityHistoryDocument, type ParityHistoryQuery } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "parity_history";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
};

type Checks = ParityHistoryQuery["parityHistory"];

/** Summarizes the most recent parity check. */
function summarize(checks: Checks): string {
  if (checks.length === 0) {
    return "No parity checks recorded.";
  }
  const last = checks[0];
  return `Last parity check: ${last.status} on ${last.date ?? "unknown"}, ${last.errors ?? 0} errors, ${last.speed ?? "?"} MB/s.`;
}

/**
 * Creates the `parity_history` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch parity history.
 * @returns An MCP tool handler producing recent parity-check results.
 */
export function createParityHistoryHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    limit,
  }: { response_format: ResponseFormat; limit: number }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ParityHistoryDocument);
      const checks = data.parityHistory.slice(0, limit);
      return formatResponse(response_format, summarize(checks), checks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch parity history: ${message}`);
    }
  };
}

/**
 * Registers the read-only `parity_history` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerParityHistory(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get Unraid Parity Check History",
      description:
        "Read-only. Returns the most recent parity checks (date, status, errors, speed). Use `limit` to control how many are returned.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createParityHistoryHandler(client),
  );
}
```

**Step 6: Register** in `registry.ts` (`import { registerParityHistory } ...` + call).

**Step 7: Tests + gate** → PASS.

**Step 8: Commit**
```bash
git add src/tools/array/parity-history.ts src/tools/array/parity-history.graphql src/tools/array/parity-history.test.ts src/tools/registry.ts src/types/unraid/graphql.ts
git commit -m "feat(tools): add read-only parity_history tool"
```

---

## Task 6: `disk_list` tool

**Files:** Create `src/tools/disk/disk-list.{graphql,ts,test.ts}`; modify `src/tools/registry.ts`.

**Step 1: Operation** `src/tools/disk/disk-list.graphql`:
```graphql
query DiskList {
  disks {
    device
    name
    vendor
    type
    size
    interfaceType
    smartStatus
    temperature
    isSpinning
    serialNum
    firmwareRevision
    partitions {
      name
      fsType
      size
    }
  }
}
```

**Step 2: Regenerate** (`DiskListDocument`, `DiskListQuery`). Note `size`/`temperature`/`partitions[].size` are `Float` → `number`.

**Step 3: Failing test** `src/tools/disk/disk-list.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DiskListQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createDiskListHandler } from "./disk-list.js";

const disks = {
  disks: [
    {
      device: "/dev/sdb",
      name: "WDC WD80EFAX",
      vendor: "WDC",
      type: "HDD",
      size: 8_000_000_000_000,
      interfaceType: "SATA",
      smartStatus: "OK",
      temperature: 34,
      isSpinning: true,
      serialNum: "ABC123",
      firmwareRevision: "1.0",
      partitions: [{ name: "sdb1", fsType: "xfs", size: 8_000_000_000_000 }],
    },
  ],
} satisfies DiskListQuery;

function fakeExecutor(result: DiskListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("disk_list handler", () => {
  it("summarizes each disk with size, interface, SMART and temp", async () => {
    const result = await createDiskListHandler(fakeExecutor(disks))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/WDC WD80EFAX/);
    expect(firstText(result)).toMatch(/7\.3 TB/);
    expect(firstText(result)).toMatch(/SMART OK/);
    expect(firstText(result)).toMatch(/34°C/);
  });

  it("handles no disks", async () => {
    const result = await createDiskListHandler(fakeExecutor({ disks: [] }))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No physical disks/);
  });
});
```
> Note: 8e12 bytes ÷ 1024⁴ ≈ 7.28 TB → `humanizeBytes` yields `7.3 TB`.

**Step 4: Run to verify it fails** → FAIL.

**Step 5: Implement** `src/tools/disk/disk-list.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { DiskListDocument, type DiskListQuery } from "../../types/unraid/graphql.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "disk_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

type Disks = DiskListQuery["disks"];

/** Summarizes each physical disk on one line. */
function summarize(disks: Disks): string {
  if (disks.length === 0) {
    return "No physical disks detected.";
  }
  return disks
    .map((disk) => {
      const temp = disk.temperature != null ? `, ${disk.temperature}°C` : "";
      return `${disk.name} (${humanizeBytes(disk.size)}, ${disk.interfaceType}) — SMART ${disk.smartStatus}${temp}`;
    })
    .join("\n");
}

/**
 * Creates the `disk_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch physical disks.
 * @returns An MCP tool handler listing physical disks and their health.
 */
export function createDiskListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DiskListDocument);
      return formatResponse(response_format, summarize(data.disks), data.disks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch disks: ${message}`);
    }
  };
}

/**
 * Registers the read-only `disk_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDiskList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Unraid Physical Disks",
      description:
        "Read-only. Lists physical disks with model, size, interface, SMART status, temperature, and partitions.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createDiskListHandler(client),
  );
}
```

**Step 6: Register** in `registry.ts`.

**Step 7: Tests + gate** → PASS.

**Step 8: Commit**
```bash
git add src/tools/disk/ src/tools/registry.ts src/types/unraid/graphql.ts
git commit -m "feat(tools): add read-only disk_list tool"
```

---

## Task 7: `share_list` tool

**Files:** Create `src/tools/share/share-list.{graphql,ts,test.ts}`; modify `src/tools/registry.ts`.

**Step 1: Operation** `src/tools/share/share-list.graphql`:
```graphql
query ShareList {
  shares {
    name
    free
    used
    size
    cache
    include
    exclude
    comment
  }
}
```

**Step 2: Regenerate** (`ShareListDocument`, `ShareListQuery`). `free`/`used`/`size` are `BigInt` → `string | null`.

**Step 3: Failing test** `src/tools/share/share-list.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { ShareListQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createShareListHandler } from "./share-list.js";

const shares = {
  shares: [
    { name: "appdata", free: "10000000", used: "5000000", size: "15000000", cache: true, include: [], exclude: [], comment: null },
    { name: "media", free: "1000000000", used: "9000000000", size: "10000000000", cache: false, include: [], exclude: [], comment: null },
  ],
} satisfies ShareListQuery;

function fakeExecutor(result: ShareListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("share_list handler", () => {
  it("summarizes each share with used/total", async () => {
    const result = await createShareListHandler(fakeExecutor(shares))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/appdata/);
    expect(firstText(result)).toMatch(/media/);
  });

  it("filters by name when provided", async () => {
    const result = await createShareListHandler(fakeExecutor(shares))({
      response_format: "concise",
      name: "media",
    });

    expect(firstText(result)).toMatch(/media/);
    expect(firstText(result)).not.toMatch(/appdata/);
  });

  it("handles no shares", async () => {
    const result = await createShareListHandler(fakeExecutor({ shares: [] }))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No shares/);
  });
});
```

**Step 4: Run to verify it fails** → FAIL.

**Step 5: Implement** `src/tools/share/share-list.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ShareListDocument, type ShareListQuery } from "../../types/unraid/graphql.js";
import { humanizeKilobytes, toNumber } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "share_list";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  name: z.string().optional(),
};

type Shares = ShareListQuery["shares"];

/** Filters shares by a case-insensitive name substring. */
function filterByName(shares: Shares, name: string | undefined): Shares {
  if (!name) {
    return shares;
  }
  const needle = name.toLowerCase();
  return shares.filter((share) => (share.name ?? "").toLowerCase().includes(needle));
}

/** Summarizes each share's used/total usage. */
function summarize(shares: Shares): string {
  if (shares.length === 0) {
    return "No shares found.";
  }
  return shares
    .map(
      (share) =>
        `${share.name ?? "(unnamed)"} — ${humanizeKilobytes(toNumber(share.used))} / ${humanizeKilobytes(toNumber(share.size))} used`,
    )
    .join("\n");
}

/**
 * Creates the `share_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch shares.
 * @returns An MCP tool handler listing user shares and their usage.
 */
export function createShareListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
    name,
  }: { response_format: ResponseFormat; name?: string }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(ShareListDocument);
      const shares = filterByName(data.shares, name);
      return formatResponse(response_format, summarize(shares), shares);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch shares: ${message}`);
    }
  };
}

/**
 * Registers the read-only `share_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerShareList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Unraid Shares",
      description:
        "Read-only. Lists user shares with usage (free/used/total). Use `name` to filter by a share name substring.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createShareListHandler(client),
  );
}
```

**Step 6: Register** in `registry.ts`.

**Step 7: Tests + gate** → PASS.

**Step 8: Commit**
```bash
git add src/tools/share/ src/tools/registry.ts src/types/unraid/graphql.ts
git commit -m "feat(tools): add read-only share_list tool"
```

---

## Task 8: README + final verification

**Files:** Modify `README.md`.

**Step 1: Update `README.md`** — in the Status section, change the "one read-only tool" wording to list the five tools (`system_info`, `array_status`, `parity_history`, `disk_list`, `share_list`). If the README has a tools table/list, add the four new ones with their one-line descriptions.

**Step 2: Full clean-install gate**
Run:
```bash
rm -rf node_modules dist
npm ci
npm run generate && git diff --exit-code src/types/unraid/
npm run typecheck && npm run build && npm test && npm run lint
```
Expected: all green; generated types unchanged.

**Step 3: Stdio smoke** — confirm `tools/list` now returns all five tools:
```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | UNRAID_API_URL=https://example.invalid/graphql UNRAID_API_KEY=dummy node dist/index.js 2>/dev/null \
  | grep -o '"name":"[a-z_]*"'
```
Expected: `system_info`, `array_status`, `parity_history`, `disk_list`, `share_list`.

**Step 4: Commit**
```bash
git add README.md
git commit -m "docs: document the system & storage tools"
```

**Step 5: Report** the green gate and the tool list. Push + draft PR are done after review (not in this plan). **Honesty note:** as with PR #1, these tools are unverified against a live Unraid server — fixtures match the SDL but real nullability/permissions could differ. List "run the new tools against a real Unraid box" as the first post-merge check.

---

## Notes / decisions baked in

- All five tools are **read-only**; the confirm-gate helper stays unused until the first destructive domain.
- `array_status` returns `data.array` as the detailed payload (not the whole query envelope); the other list tools return their array directly — consistent "return the resource, not the envelope".
- `BigInt` → `string` mapping means KB/byte math goes through `toNumber` + `humanizeBytes`/`humanizeKilobytes`; values are well within `Number` safe range at homelab scale.
- `parity_history` `limit` and `share_list` `name` are applied client-side (the schema exposes no server-side args for them).
