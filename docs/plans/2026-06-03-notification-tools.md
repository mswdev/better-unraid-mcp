# Notification Tools (PR #6) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the Unraid notifications domain as 7 consolidated MCP tools (3 reads + 4 mutations) over `Query.notifications` and the top-level `Mutation.*Notification*` fields.

**Architecture:** Each tool is a `createXHandler(client)` factory + a `registerX(server, client)` wrapper, depending only on the `GraphQLExecutor` seam. Per-tool `.graphql` operation files feed graphql-codegen into the single committed `src/types/unraid/graphql.ts`. Reuse `_shared/respond.ts` (`formatResponse`), `_shared/confirm.ts` (`requireConfirmation`), and `_shared/test-support.ts` fakes. A new `notification/_shared.ts` holds the counts formatter and the lowercase-input → SDL-enum maps.

**Tech Stack:** TypeScript (NodeNext, `.js` import specifiers), Zod input schemas, `@modelcontextprotocol/sdk` v1.29, graphql-codegen (`typed-document-node`), Vitest (hand-written fakes, `satisfies <Op>Query/Mutation` fixtures), Biome.

**Design source:** `docs/plans/2026-06-03-notification-tools-design.md` (approved + source-validation reconciled). Read its **Validated semantics** section before starting — the reporting decisions below derive from it.

**Branch:** `feature/notification-tools` (already cut off `develop`).

**Pre-flight:** Run `npm run typecheck && npm run build && npm test && npm run lint` once to confirm a green baseline before Task 1.

---

## Key constraints carried from source-validation (do NOT relax)

- **`notification_archive` reports the ACTION, never counts.** The returned overview is racy for the `ids` and `all`-without-importance paths, and bulk silently swallows bad ids. The summary must report *what was requested* and must **not** derive counts from the returned overview. (Task 6 includes the executable test for this.)
- **`notification_delete` reports counts** (race-free: synchronous decrement/zero).
- **`notification_recalculate` ships** (re-syncs the drifting overview cache from disk).
- **Proportionate gating: only `notification_delete` is gated** (`confirm:true`, `destructiveHint:true`). The other three writes are ungated, `destructiveHint:false` — a first for this repo, so annotation-contract tests are **per-tool**.
- **Reads are `readOnlyHint:true`.** Mutations are nest-authz default-allow server-side → no permission-denied path to test for mutations; reads can hit a permission error.
- **Lowercase tool enums** (`unread|archive`, `alert|warning|info`) mapped to the SDL's uppercase enums via typed maps in `notification/_shared.ts`.

---

## Task 1: GraphQL operations + codegen

**Files:**
- Create: `src/tools/notification/notification-overview.graphql`
- Create: `src/tools/notification/notification-list.graphql`
- Create: `src/tools/notification/notification-alerts.graphql`
- Create: `src/tools/notification/notification-archive.graphql`
- Create: `src/tools/notification/notification-delete.graphql`
- Create: `src/tools/notification/notification-create.graphql`
- Create: `src/tools/notification/notification-recalculate.graphql`
- Modify (generated): `src/types/unraid/graphql.ts` via `npm run generate`

**Step 1: Write the operation files.** Use a reusable counts selection inline (codegen v6 fragment support is fine, but inline keeps the single-file output simplest — match the design doc).

`notification-overview.graphql`:
```graphql
query NotificationOverview {
  notifications {
    overview {
      unread { info warning alert total }
      archive { info warning alert total }
    }
  }
}
```

`notification-list.graphql`:
```graphql
query NotificationList($filter: NotificationFilter!) {
  notifications {
    list(filter: $filter) {
      id title subject description importance link type timestamp formattedTimestamp
    }
  }
}
```

`notification-alerts.graphql`:
```graphql
query NotificationAlerts {
  notifications {
    warningsAndAlerts {
      id title subject description importance link type timestamp formattedTimestamp
    }
  }
}
```

`notification-archive.graphql`:
```graphql
mutation ArchiveNotifications($ids: [PrefixedID!]!) {
  archiveNotifications(ids: $ids) { unread { info warning alert total } archive { info warning alert total } }
}
mutation UnarchiveNotifications($ids: [PrefixedID!]!) {
  unarchiveNotifications(ids: $ids) { unread { info warning alert total } archive { info warning alert total } }
}
mutation ArchiveAll($importance: NotificationImportance) {
  archiveAll(importance: $importance) { unread { info warning alert total } archive { info warning alert total } }
}
mutation UnarchiveAll($importance: NotificationImportance) {
  unarchiveAll(importance: $importance) { unread { info warning alert total } archive { info warning alert total } }
}
```

`notification-delete.graphql`:
```graphql
mutation DeleteNotification($id: PrefixedID!, $type: NotificationType!) {
  deleteNotification(id: $id, type: $type) { unread { info warning alert total } archive { info warning alert total } }
}
mutation DeleteArchivedNotifications {
  deleteArchivedNotifications { unread { info warning alert total } archive { info warning alert total } }
}
```

`notification-create.graphql`:
```graphql
mutation CreateNotification($input: NotificationData!) {
  createNotification(input: $input) { id title subject description importance link type timestamp formattedTimestamp }
}
mutation NotifyIfUnique($input: NotificationData!) {
  notifyIfUnique(input: $input) { id title subject description importance link type timestamp formattedTimestamp }
}
```

`notification-recalculate.graphql`:
```graphql
mutation RecalculateOverview {
  recalculateOverview { unread { info warning alert total } archive { info warning alert total } }
}
```

**Step 2: Regenerate types.**

Run: `npm run generate`
Expected: `src/types/unraid/graphql.ts` updated; exit 0; no errors.

**Step 3: Verify the new Documents and types exist + typecheck.**

Run: `npm run typecheck && grep -c "NotificationOverviewDocument\|NotificationListDocument\|NotificationAlertsDocument\|ArchiveNotificationsDocument\|UnarchiveNotificationsDocument\|ArchiveAllDocument\|UnarchiveAllDocument\|DeleteNotificationDocument\|DeleteArchivedNotificationsDocument\|CreateNotificationDocument\|NotifyIfUniqueDocument\|RecalculateOverviewDocument" src/types/unraid/graphql.ts`
Expected: typecheck passes; grep count `12`.

**Step 4: Confirm codegen idempotency.**

Run: `npm run generate && git diff --stat src/types/unraid/graphql.ts`
Expected: no diff after a second generate (a re-run must be a no-op).

**Step 5: Commit.**
```bash
git add src/tools/notification/*.graphql src/types/unraid/graphql.ts
git commit -m "feat(notification): add notification GraphQL operations + regenerate types"
```

---

## Task 2: `notification/_shared.ts` — counts formatter + enum maps

**Files:**
- Create: `src/tools/notification/_shared.ts`
- Test: `src/tools/notification/_shared.test.ts`

**Step 1: Write the failing test** (`_shared.test.ts`):
```typescript
import { describe, expect, it } from "vitest";
import type { NotificationType } from "../../types/unraid/graphql.js";
import {
  IMPORTANCE_TO_API,
  TYPE_TO_API,
  formatCounts,
  summarizeLine,
  summarizeOverview,
} from "./_shared.js";

describe("formatCounts", () => {
  it("renders total with the importance breakdown", () => {
    expect(formatCounts({ total: 6, alert: 1, warning: 2, info: 3 })).toBe(
      "6 (1 alert / 2 warning / 3 info)",
    );
  });
});

describe("summarizeOverview", () => {
  it("renders unread then archived", () => {
    const overview = {
      unread: { total: 2, alert: 1, warning: 1, info: 0 },
      archive: { total: 5, alert: 0, warning: 2, info: 3 },
    };
    expect(summarizeOverview(overview)).toBe(
      "Unread: 2 (1 alert / 1 warning / 0 info). Archived: 5 (0 alert / 2 warning / 3 info).",
    );
  });
});

describe("summarizeLine", () => {
  it("renders [IMPORTANCE] title — subject (formattedTimestamp)", () => {
    expect(
      summarizeLine({
        importance: "WARNING",
        title: "Disk warning",
        subject: "Disk 1",
        timestamp: "1700000001",
        formattedTimestamp: "2023-11-14 12:00",
      }),
    ).toBe("[WARNING] Disk warning — Disk 1 (2023-11-14 12:00)");
  });

  it("falls back to timestamp then a placeholder when formattedTimestamp is null", () => {
    expect(
      summarizeLine({ importance: "INFO", title: "t", subject: "s", timestamp: null, formattedTimestamp: null }),
    ).toBe("[INFO] t — s (no timestamp)");
  });
});

describe("enum maps", () => {
  it("maps lowercase tool types to the SDL NotificationType", () => {
    const archive: NotificationType = TYPE_TO_API.archive;
    expect(TYPE_TO_API).toEqual({ unread: "UNREAD", archive: "ARCHIVE" });
    expect(archive).toBe("ARCHIVE");
  });

  it("maps lowercase tool importance to the SDL NotificationImportance", () => {
    expect(IMPORTANCE_TO_API).toEqual({ alert: "ALERT", warning: "WARNING", info: "INFO" });
  });
});
```

**Step 2: Run to verify it fails.**
Run: `npx vitest run src/tools/notification/_shared.test.ts`
Expected: FAIL (module not found).

**Step 3: Write the implementation** (`_shared.ts`):
```typescript
import type { NotificationImportance, NotificationType } from "../../types/unraid/graphql.js";

/** A notification importance count breakdown (shape of `NotificationCounts`). */
export interface Counts {
  info: number;
  warning: number;
  alert: number;
  total: number;
}

/** The `NotificationOverview` shape: unread vs archived counts. */
export interface Overview {
  unread: Counts;
  archive: Counts;
}

/** The lowercase `type` accepted by notification tools. */
export type TypeInput = "unread" | "archive";

/** The lowercase `importance` accepted by notification tools. */
export type ImportanceInput = "alert" | "warning" | "info";

/** Maps the lowercase tool `type` to the SDL `NotificationType` enum. */
export const TYPE_TO_API: Record<TypeInput, NotificationType> = {
  unread: "UNREAD",
  archive: "ARCHIVE",
};

/** Maps the lowercase tool `importance` to the SDL `NotificationImportance` enum. */
export const IMPORTANCE_TO_API: Record<ImportanceInput, NotificationImportance> = {
  alert: "ALERT",
  warning: "WARNING",
  info: "INFO",
};

/**
 * Formats one counts bucket as `total (a alert / w warning / i info)`.
 *
 * @param counts - The bucket counts to format.
 * @returns The single-bucket summary string.
 */
export function formatCounts(counts: Counts): string {
  return `${counts.total} (${counts.alert} alert / ${counts.warning} warning / ${counts.info} info)`;
}

/**
 * Summarizes an overview as `Unread: …. Archived: ….`.
 *
 * @param overview - The unread/archive counts to summarize.
 * @returns The two-bucket overview summary string.
 */
export function summarizeOverview(overview: Overview): string {
  return `Unread: ${formatCounts(overview.unread)}. Archived: ${formatCounts(overview.archive)}.`;
}

/** A notification line item — the fields both list-style reads render. */
export interface NotificationLineItem {
  importance: string;
  title: string;
  subject: string;
  timestamp?: string | null;
  formattedTimestamp?: string | null;
}

/**
 * Renders one notification as `[IMPORTANCE] title — subject (when)`, where `when`
 * prefers the human `formattedTimestamp`, falls back to the raw `timestamp`, then a
 * placeholder (both are nullable in the SDL). Shared by notification_list and
 * notification_alerts so the line format has a single definition and test owner.
 *
 * @param notification - The notification fields to render.
 * @returns The single-line summary.
 */
export function summarizeLine(notification: NotificationLineItem): string {
  const when = notification.formattedTimestamp ?? notification.timestamp ?? "no timestamp";
  return `[${notification.importance}] ${notification.title} — ${notification.subject} (${when})`;
}
```

> Note: if codegen emits `NotificationType`/`NotificationImportance` as string-literal unions (it does — `enumsAsTypes:true`), the `Record<…, NotificationType>` typing makes the maps fail to compile if an SDL enum member is renamed — a free drift check.

**Step 4: Run to verify it passes.**
Run: `npx vitest run src/tools/notification/_shared.test.ts`
Expected: PASS.

**Step 5: Commit.**
```bash
git add src/tools/notification/_shared.ts src/tools/notification/_shared.test.ts
git commit -m "feat(notification): add _shared counts formatter + enum maps"
```

---

## Task 3: `notification_overview` (read)

**Files:**
- Create: `src/tools/notification/notification-overview.ts`
- Test: `src/tools/notification/notification-overview.test.ts`

**Step 1: Write the failing test:**
```typescript
import { describe, expect, it } from "vitest";
import type { NotificationOverviewQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationOverviewHandler } from "./notification-overview.js";
import type { GraphQLExecutor } from "../../graphql/client.js";

const data = {
  notifications: {
    overview: {
      unread: { info: 3, warning: 1, alert: 2, total: 6 },
      archive: { info: 10, warning: 0, alert: 0, total: 10 },
    },
  },
} satisfies NotificationOverviewQuery;

const fake = (result: NotificationOverviewQuery): GraphQLExecutor => ({
  execute: async () => result as never,
});

describe("notification_overview handler", () => {
  it("summarizes unread and archived counts", async () => {
    const result = await createNotificationOverviewHandler(fake(data))({ response_format: "concise" });
    expect(firstText(result)).toBe(
      "Unread: 6 (2 alert / 1 warning / 3 info). Archived: 10 (0 alert / 0 warning / 10 info).",
    );
  });

  it("returns the overview object in detailed format", async () => {
    const result = await createNotificationOverviewHandler(fake(data))({ response_format: "detailed" });
    expect(JSON.parse(firstText(result))).toEqual(data.notifications.overview);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createNotificationOverviewHandler(throwingExecutor("permission denied"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch notification overview/);
  });

  it("coerces a non-Error rejection", async () => {
    const result = await createNotificationOverviewHandler(rejectingExecutor("boom"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom/);
  });
});
```

**Step 2: Run to verify it fails.** Run: `npx vitest run src/tools/notification/notification-overview.test.ts` → FAIL (module not found).

**Step 3: Implement** (`notification-overview.ts`):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { NotificationOverviewDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { summarizeOverview } from "./_shared.js";

const TOOL_NAME = "notification_overview";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `notification_overview` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read the overview.
 * @returns An MCP handler returning unread/archive notification counts.
 */
export function createNotificationOverviewHandler(client: GraphQLExecutor) {
  return async ({ response_format }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { notifications } = await client.execute(NotificationOverviewDocument);
      return formatResponse(response_format, summarizeOverview(notifications.overview), notifications.overview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch notification overview: ${message}`);
    }
  };
}

/**
 * Registers the read-only `notification_overview` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationOverview(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Notification Overview",
      description:
        "Read-only. Notification counts: unread and archived, each broken down by importance (alert / warning / info) plus total.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createNotificationOverviewHandler(client),
  );
}
```

**Step 4: Run to verify it passes.** Run: `npx vitest run src/tools/notification/notification-overview.test.ts` → PASS.

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-overview.ts src/tools/notification/notification-overview.test.ts
git commit -m "feat(notification): add read-only notification_overview tool"
```

---

## Task 4: `notification_list` (read)

**Files:**
- Create: `src/tools/notification/notification-list.ts`
- Test: `src/tools/notification/notification-list.test.ts`

**Behavior:** `type` required (`unread|archive`), optional `importance`, `offset` default `0`, `limit` default `25`. Build the SDL filter with mapped uppercase enums. Render one line per notification; three distinct empty-result messages (design Output).

**Step 1: Write the failing test:**
```typescript
import { describe, expect, it } from "vitest";
import {
  NotificationListDocument,
  type NotificationListQuery,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationListHandler } from "./notification-list.js";

const data = {
  notifications: {
    list: [
      {
        id: "srv:Disk_1700000001.notify",
        title: "Disk warning",
        subject: "Disk 1",
        description: "SMART error",
        importance: "WARNING",
        link: null,
        type: "UNREAD",
        timestamp: "1700000001",
        formattedTimestamp: "2023-11-14 12:00",
      },
    ],
  },
} satisfies NotificationListQuery;

const empty = { notifications: { list: [] } } satisfies NotificationListQuery;

describe("notification_list handler", () => {
  it("applies default offset/limit and maps the type enum into the filter", async () => {
    const { executor, calls } = recordingExecutor(data);
    await createNotificationListHandler(executor)({ response_format: "concise", type: "unread" });
    expect(calls[0]?.document).toBe(NotificationListDocument);
    expect(calls[0]?.variables).toEqual({ filter: { type: "UNREAD", offset: 0, limit: 25 } });
  });

  it("includes a provided importance (mapped) and explicit paging in the filter", async () => {
    const { executor, calls } = recordingExecutor(empty);
    await createNotificationListHandler(executor)({
      response_format: "concise",
      type: "archive",
      importance: "alert",
      offset: 10,
      limit: 5,
    });
    expect(calls[0]?.variables).toEqual({
      filter: { type: "ARCHIVE", importance: "ALERT", offset: 10, limit: 5 },
    });
  });

  it("renders one line per notification", async () => {
    const { executor } = recordingExecutor(data);
    const result = await createNotificationListHandler(executor)({ response_format: "concise", type: "unread" });
    expect(firstText(result)).toBe("[WARNING] Disk warning — Disk 1 (2023-11-14 12:00)");
  });

  it("distinguishes importance-filtered-empty from plain-empty", async () => {
    const { executor } = recordingExecutor(empty);
    const filtered = await createNotificationListHandler(executor)({
      response_format: "concise",
      type: "unread",
      importance: "alert",
    });
    expect(firstText(filtered)).toBe("No unread notifications match importance ALERT.");

    const plain = await createNotificationListHandler(recordingExecutor(empty).executor)({
      response_format: "concise",
      type: "archive",
    });
    expect(firstText(plain)).toBe("No archive notifications.");
  });

  it("returns the list array in detailed format", async () => {
    const { executor } = recordingExecutor(data);
    const result = await createNotificationListHandler(executor)({ response_format: "detailed", type: "unread" });
    expect(JSON.parse(firstText(result))).toEqual(data.notifications.list);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createNotificationListHandler(throwingExecutor("nope"))({
      response_format: "concise",
      type: "unread",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list notifications/);
  });
});
```

**Step 2: Run → FAIL.** `npx vitest run src/tools/notification/notification-list.test.ts`

**Step 3: Implement** (`notification-list.ts`):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  NotificationListDocument,
  type NotificationListQuery,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import {
  IMPORTANCE_TO_API,
  type ImportanceInput,
  TYPE_TO_API,
  type TypeInput,
  summarizeLine,
} from "./_shared.js";

const TOOL_NAME = "notification_list";
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 25;

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  type: z.enum(["unread", "archive"]),
  importance: z.enum(["alert", "warning", "info"]).optional(),
  offset: z.number().int().nonnegative().default(DEFAULT_OFFSET),
  limit: z.number().int().positive().default(DEFAULT_LIMIT),
};

// `offset`/`limit` are optional here even though the Zod schema defaults them: a unit
// test calls the handler directly (bypassing Zod), so the handler also defaults them.
interface ListArgs {
  response_format: ResponseFormat;
  type: TypeInput;
  importance?: ImportanceInput;
  offset?: number;
  limit?: number;
}

type Notifications = NotificationListQuery["notifications"]["list"];

/** Builds the empty-result message, distinguishing an importance filter from none. */
function emptyMessage(args: ListArgs): string {
  if (args.importance) {
    return `No ${args.type} notifications match importance ${IMPORTANCE_TO_API[args.importance]}.`;
  }
  return `No ${args.type} notifications.`;
}

function summarize(list: Notifications, args: ListArgs): string {
  if (list.length === 0) {
    return emptyMessage(args);
  }
  return list.map(summarizeLine).join("\n");
}

/**
 * Creates the `notification_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to list notifications.
 * @returns An MCP handler listing notifications of one type.
 */
export function createNotificationListHandler(client: GraphQLExecutor) {
  return async (args: ListArgs): Promise<CallToolResult> => {
    const filter = {
      type: TYPE_TO_API[args.type],
      ...(args.importance ? { importance: IMPORTANCE_TO_API[args.importance] } : {}),
      offset: args.offset ?? DEFAULT_OFFSET,
      limit: args.limit ?? DEFAULT_LIMIT,
    };
    try {
      const { notifications } = await client.execute(NotificationListDocument, { filter });
      return formatResponse(args.response_format, summarize(notifications.list, args), notifications.list);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to list notifications: ${message}`);
    }
  };
}

/**
 * Registers the read-only `notification_list` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Notifications",
      description:
        "Read-only. Lists notifications of one `type` (`unread` or `archive`), newest first. Optional `importance` filter (alert/warning/info); paginate with `offset` (default 0) and `limit` (default 25). The source of truth for which notifications exist and their ids.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createNotificationListHandler(client),
  );
}
```

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-list.ts src/tools/notification/notification-list.test.ts
git commit -m "feat(notification): add read-only notification_list tool"
```

---

## Task 5: `notification_alerts` (read)

**Files:**
- Create: `src/tools/notification/notification-alerts.ts`
- Test: `src/tools/notification/notification-alerts.test.ts`

**Behavior:** zero domain args; reuses `summarizeLine` from `notification/_shared.ts` (the single owner of the line format — defined and tested in Task 2; `notification_list` imports the same). No sibling-file edit. Empty → `No unread warnings or alerts.`

**Step 1: Write the failing test:**
```typescript
import { describe, expect, it } from "vitest";
import type { NotificationAlertsQuery } from "../../types/unraid/graphql.js";
import { firstText, rejectingExecutor } from "../_shared/test-support.js";
import { createNotificationAlertsHandler } from "./notification-alerts.js";
import type { GraphQLExecutor } from "../../graphql/client.js";

const data = {
  notifications: {
    warningsAndAlerts: [
      {
        id: "srv:Alert_1700000009.notify",
        title: "Array offline",
        subject: "Parity",
        description: "Disk 2 disabled",
        importance: "ALERT",
        link: null,
        type: "UNREAD",
        timestamp: "1700000009",
        formattedTimestamp: "2023-11-14 12:01",
      },
    ],
  },
} satisfies NotificationAlertsQuery;

const fake = (result: NotificationAlertsQuery): GraphQLExecutor => ({ execute: async () => result as never });

describe("notification_alerts handler", () => {
  it("renders unread warnings and alerts, newest first", async () => {
    const result = await createNotificationAlertsHandler(fake(data))({ response_format: "concise" });
    expect(firstText(result)).toBe("[ALERT] Array offline — Parity (2023-11-14 12:01)");
  });

  it("reports the empty attention set distinctly", async () => {
    const result = await createNotificationAlertsHandler(
      fake({ notifications: { warningsAndAlerts: [] } }),
    )({ response_format: "concise" });
    expect(firstText(result)).toBe("No unread warnings or alerts.");
  });

  it("returns the array in detailed format", async () => {
    const result = await createNotificationAlertsHandler(fake(data))({ response_format: "detailed" });
    expect(JSON.parse(firstText(result))).toEqual(data.notifications.warningsAndAlerts);
  });

  it("coerces a non-Error rejection", async () => {
    const result = await createNotificationAlertsHandler(rejectingExecutor("boom"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/boom/);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`notification-alerts.ts`) — imports `summarizeLine` from `./_shared.js` (already defined + tested in Task 2; no sibling edit):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { NotificationAlertsDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { summarizeLine } from "./_shared.js";

const TOOL_NAME = "notification_alerts";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `notification_alerts` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to read warnings and alerts.
 * @returns An MCP handler returning the unread warning/alert attention set.
 */
export function createNotificationAlertsHandler(client: GraphQLExecutor) {
  return async ({ response_format }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { notifications } = await client.execute(NotificationAlertsDocument);
      const items = notifications.warningsAndAlerts;
      const concise = items.length === 0 ? "No unread warnings or alerts." : items.map(summarizeLine).join("\n");
      return formatResponse(response_format, concise, items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch warnings and alerts: ${message}`);
    }
  };
}

/**
 * Registers the read-only `notification_alerts` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationAlerts(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Notification Alerts",
      description:
        "Read-only. Deduplicated unread warnings and alerts, newest first — the 'needs attention now' view (up to 50).",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    createNotificationAlertsHandler(client),
  );
}
```

**Step 4: Run → PASS.**
Run: `npx vitest run src/tools/notification/notification-alerts.test.ts`

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-alerts.ts src/tools/notification/notification-alerts.test.ts
git commit -m "feat(notification): add read-only notification_alerts tool"
```

---

## Task 6: `notification_archive` (ungated mutation) — ACTION-based reporting

**Files:**
- Create: `src/tools/notification/notification-archive.ts`
- Test: `src/tools/notification/notification-archive.test.ts`

**Behavior:** `direction: archive|unarchive`; target = exactly one of `ids` (non-empty) **xor** `all:true`; `importance` valid only with `all:true`. Dispatch the right Document. **Report the requested action; never derive counts from the returned overview.** No gate.

**Step 1: Write the failing test** (this test is the executable spec for the reporting redesign):
```typescript
import { describe, expect, it } from "vitest";
import {
  ArchiveAllDocument,
  ArchiveNotificationsDocument,
  type ArchiveNotificationsMutation,
  UnarchiveAllDocument,
  UnarchiveNotificationsDocument,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createNotificationArchiveHandler } from "./notification-archive.js";

// An ARBITRARY overview — the handler must NOT echo these numbers (counts are racy).
const overview = {
  unread: { info: 99, warning: 99, alert: 99, total: 297 },
  archive: { info: 99, warning: 99, alert: 99, total: 297 },
} satisfies ArchiveNotificationsMutation["archiveNotifications"];
const canned = { archiveNotifications: overview } satisfies ArchiveNotificationsMutation;

describe("notification_archive validation", () => {
  it("rejects neither ids nor all and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects both ids and all", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["a"],
      all: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects importance combined with ids (importance is only valid with all)", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["a"],
      importance: "alert",
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("notification_archive dispatch", () => {
  it("archives ids via ArchiveNotifications", async () => {
    const { executor, calls } = recordingExecutor(canned);
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["srv:a.notify", "srv:b.notify"],
    });
    expect(calls[0]?.document).toBe(ArchiveNotificationsDocument);
    expect(calls[0]?.variables).toEqual({ ids: ["srv:a.notify", "srv:b.notify"] });
  });

  it("unarchives ids via UnarchiveNotifications", async () => {
    const { executor, calls } = recordingExecutor({ unarchiveNotifications: overview });
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "unarchive",
      ids: ["srv:a.notify"],
    });
    expect(calls[0]?.document).toBe(UnarchiveNotificationsDocument);
  });

  it("archives all of an importance via ArchiveAll", async () => {
    const { executor, calls } = recordingExecutor({ archiveAll: overview });
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      all: true,
      importance: "warning",
    });
    expect(calls[0]?.document).toBe(ArchiveAllDocument);
    expect(calls[0]?.variables).toEqual({ importance: "WARNING" });
  });

  it("unarchives all (no importance) via UnarchiveAll with importance omitted", async () => {
    const { executor, calls } = recordingExecutor({ unarchiveAll: overview });
    await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "unarchive",
      all: true,
    });
    expect(calls[0]?.document).toBe(UnarchiveAllDocument);
    expect(calls[0]?.variables).toEqual({ importance: undefined });
  });
});

describe("notification_archive reporting (action-based, never counts)", () => {
  it("reports the requested ids action and does NOT echo the racy overview counts", async () => {
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["srv:a.notify", "srv:b.notify"],
    });
    const text = firstText(result);
    expect(text).toBe("Requested archive of 2 notification(s); verify with notification_list.");
    expect(text).not.toMatch(/297|99/); // proves we don't parrot returned counts
  });

  it("silently-swallowed bad ids still report only what was requested (never per-id success)", async () => {
    // Server swallows bad ids (batchProcess never throws); the executor returns success regardless.
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      ids: ["bogus-id"],
    });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toBe("Requested archive of 1 notification(s); verify with notification_list.");
  });

  it("reports an all+importance action", async () => {
    const { executor } = recordingExecutor({ archiveAll: overview });
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "concise",
      direction: "archive",
      all: true,
      importance: "alert",
    });
    expect(firstText(result)).toBe("Requested archive of all ALERT notifications; verify with notification_list.");
  });

  it("returns the raw server overview in detailed (labeled, may lag)", async () => {
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationArchiveHandler(executor)({
      response_format: "detailed",
      direction: "archive",
      ids: ["srv:a.notify"],
    });
    expect(JSON.parse(firstText(result))).toMatchObject({ serverOverview: overview });
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`notification-archive.ts`). Keep methods ≤25 lines / ≤2 nesting; extract validation and dispatch.
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ArchiveAllDocument,
  ArchiveNotificationsDocument,
  UnarchiveAllDocument,
  UnarchiveNotificationsDocument,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { IMPORTANCE_TO_API, type ImportanceInput } from "./_shared.js";

const TOOL_NAME = "notification_archive";

type Direction = "archive" | "unarchive";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  direction: z.enum(["archive", "unarchive"]),
  ids: z.array(z.string()).nonempty().optional(),
  all: z.boolean().optional(),
  importance: z.enum(["alert", "warning", "info"]).optional(),
};

interface ArchiveArgs {
  response_format: ResponseFormat;
  direction: Direction;
  ids?: string[];
  all?: boolean;
  importance?: ImportanceInput;
}

/** Validates the target is exactly one of ids|all and that importance is all-only. */
function validateTarget(args: ArchiveArgs): string | null {
  const hasIds = Array.isArray(args.ids) && args.ids.length > 0;
  if (hasIds === Boolean(args.all)) {
    return "Specify exactly one of `ids` (non-empty) or `all: true`. No changes were made.";
  }
  if (args.importance && !args.all) {
    return "`importance` is only valid with `all: true`. No changes were made.";
  }
  return null;
}

/** Runs the ids-target mutation (archive or unarchive) and returns the raw overview. */
async function runIds(client: GraphQLExecutor, direction: Direction, ids: string[]) {
  if (direction === "archive") {
    return (await client.execute(ArchiveNotificationsDocument, { ids })).archiveNotifications;
  }
  return (await client.execute(UnarchiveNotificationsDocument, { ids })).unarchiveNotifications;
}

/** Runs the all-target mutation (archive or unarchive) and returns the raw overview. */
async function runAll(client: GraphQLExecutor, direction: Direction, importance?: ImportanceInput) {
  const variables = { importance: importance ? IMPORTANCE_TO_API[importance] : undefined };
  if (direction === "archive") {
    return (await client.execute(ArchiveAllDocument, variables)).archiveAll;
  }
  return (await client.execute(UnarchiveAllDocument, variables)).unarchiveAll;
}

/** Builds the action-based concise summary (never derived from the returned counts). */
function summarize(args: ArchiveArgs): string {
  const target = args.ids
    ? `${args.ids.length} notification(s)`
    : `all${args.importance ? ` ${IMPORTANCE_TO_API[args.importance]}` : ""} notifications`;
  return `Requested ${args.direction} of ${target}; verify with notification_list.`;
}

/**
 * Creates the `notification_archive` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to archive/unarchive.
 * @returns An MCP handler that moves notifications between unread and archive.
 */
export function createNotificationArchiveHandler(client: GraphQLExecutor) {
  return async (args: ArchiveArgs): Promise<CallToolResult> => {
    const invalid = validateTarget(args);
    if (invalid) {
      return toolError(invalid);
    }
    try {
      const serverOverview = args.ids
        ? await runIds(client, args.direction, args.ids)
        : await runAll(client, args.direction, args.importance);
      const detailed = {
        requested: { direction: args.direction, ids: args.ids ?? null, all: Boolean(args.all), importance: args.importance ?? null },
        serverOverview,
      };
      return formatResponse(args.response_format, summarize(args), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${args.direction} notifications: ${message}`);
    }
  };
}

/**
 * Registers the ungated `notification_archive` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationArchive(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Archive or Unarchive Notifications",
      description:
        "Archive (hide) or unarchive (restore to unread) notifications — reversible. Target specific `ids` (from notification_list — archive expects currently-unread ids, unarchive expects archived ids) or `all: true` (optionally one `importance`). Reports the action; confirm with notification_list.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    createNotificationArchiveHandler(client),
  );
}
```

> The `ids` param help string carries the bucket rule (the one correctness caveat); the design's deeper findings stay in the doc.

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-archive.ts src/tools/notification/notification-archive.test.ts
git commit -m "feat(notification): add ungated notification_archive (action-based reporting)"
```

---

## Task 7: `notification_delete` (GATED mutation) — race-free counts

**Files:**
- Create: `src/tools/notification/notification-delete.ts`
- Test: `src/tools/notification/notification-delete.test.ts`

**Behavior:** `scope: one|all_archived`; `one` needs `id`+`type`; gate via `requireConfirmation`; report resulting counts.

**Step 1: Write the failing test:**
```typescript
import { describe, expect, it } from "vitest";
import {
  DeleteArchivedNotificationsDocument,
  DeleteNotificationDocument,
  type DeleteNotificationMutation,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createNotificationDeleteHandler } from "./notification-delete.js";

const overview = {
  unread: { info: 1, warning: 0, alert: 0, total: 1 },
  archive: { info: 0, warning: 0, alert: 0, total: 0 },
} satisfies DeleteNotificationMutation["deleteNotification"];
const cannedOne = { deleteNotification: overview } satisfies DeleteNotificationMutation;

describe("notification_delete gate + validation", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "one",
      id: "srv:a.notify",
      type: "unread",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects scope:one without id+type", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "one",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects scope:all_archived combined with id/type", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "all_archived",
      id: "srv:a.notify",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("notification_delete dispatch + reporting", () => {
  it("deletes one by id+type and reports resulting counts", async () => {
    const { executor, calls } = recordingExecutor(cannedOne);
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "one",
      id: "srv:a.notify",
      type: "archive",
      confirm: true,
    });
    expect(calls[0]?.document).toBe(DeleteNotificationDocument);
    expect(calls[0]?.variables).toEqual({ id: "srv:a.notify", type: "ARCHIVE" });
    expect(firstText(result)).toBe("Deleted 1 notification; now 1 unread / 0 archived.");
  });

  it("deletes all archived and reports resulting counts", async () => {
    const { executor, calls } = recordingExecutor({ deleteArchivedNotifications: overview });
    const result = await createNotificationDeleteHandler(executor)({
      response_format: "concise",
      scope: "all_archived",
      confirm: true,
    });
    expect(calls[0]?.document).toBe(DeleteArchivedNotificationsDocument);
    expect(firstText(result)).toBe("Deleted all archived notifications; now 1 unread / 0 archived.");
  });

  it("returns an error result when the client throws (e.g. wrong type, ENOENT)", async () => {
    const { executor } = recordingExecutor(cannedOne);
    const throwing = { execute: async () => { throw new Error("ENOENT"); } };
    const result = await createNotificationDeleteHandler(throwing)({
      response_format: "concise",
      scope: "one",
      id: "srv:missing.notify",
      type: "unread",
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to delete/);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`notification-delete.ts`):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  DeleteArchivedNotificationsDocument,
  DeleteNotificationDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { type Overview, TYPE_TO_API, type TypeInput } from "./_shared.js";

const TOOL_NAME = "notification_delete";

type Scope = "one" | "all_archived";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  scope: z.enum(["one", "all_archived"]),
  id: z.string().optional(),
  type: z.enum(["unread", "archive"]).optional(),
  confirm: z.boolean().optional(),
};

interface DeleteArgs {
  response_format: ResponseFormat;
  scope: Scope;
  id?: string;
  type?: TypeInput;
  confirm?: boolean;
}

/** Validates scope arguments: `one` needs id+type; `all_archived` takes neither. */
function validateScope(args: DeleteArgs): string | null {
  if (args.scope === "one" && (!args.id || !args.type)) {
    return "`scope: one` requires both `id` and `type`. No changes were made.";
  }
  if (args.scope === "all_archived" && (args.id || args.type)) {
    return "`scope: all_archived` takes no `id`/`type`. No changes were made.";
  }
  return null;
}

/** Runs the scoped delete and returns the resulting (race-free) overview. */
async function runDelete(client: GraphQLExecutor, args: DeleteArgs): Promise<Overview> {
  if (args.scope === "all_archived") {
    return (await client.execute(DeleteArchivedNotificationsDocument)).deleteArchivedNotifications;
  }
  // validateScope guarantees id+type are present here.
  const id = args.id as string;
  const type = TYPE_TO_API[args.type as TypeInput];
  return (await client.execute(DeleteNotificationDocument, { id, type })).deleteNotification;
}

/** Builds the resulting-counts summary (deletes are race-free, so counts are reportable). */
function summarize(scope: Scope, overview: Overview): string {
  const tally = `now ${overview.unread.total} unread / ${overview.archive.total} archived`;
  const what = scope === "all_archived" ? "all archived notifications" : "1 notification";
  return `Deleted ${what}; ${tally}.`;
}

/**
 * Creates the `notification_delete` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to delete notifications.
 * @returns An MCP handler that permanently deletes notifications behind a confirm gate.
 */
export function createNotificationDeleteHandler(client: GraphQLExecutor) {
  return async (args: DeleteArgs): Promise<CallToolResult> => {
    const refusal = requireConfirmation(args.confirm, `delete notifications (${args.scope})`);
    if (refusal) {
      return refusal;
    }
    const invalid = validateScope(args);
    if (invalid) {
      return toolError(invalid);
    }
    try {
      const overview = await runDelete(client, args);
      return formatResponse(args.response_format, summarize(args.scope, overview), { overview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to delete notifications: ${message}`);
    }
  };
}

/**
 * Registers the destructive `notification_delete` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationDelete(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Delete Notifications",
      description:
        "⚠ Permanently deletes notifications (irreversible). `scope`: `one` (needs `id` and its `type`) or `all_archived` (every archived notification). Requires `confirm: true`. Reports the resulting counts.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createNotificationDeleteHandler(client),
  );
}
```

> Gate-first, then validate, then execute (mirrors `vm_action`: the refusal echoes intent without a wasted call).

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-delete.ts src/tools/notification/notification-delete.test.ts
git commit -m "feat(notification): add gated notification_delete (race-free counts)"
```

---

## Task 8: `notification_create` (ungated mutation)

**Files:**
- Create: `src/tools/notification/notification-create.ts`
- Test: `src/tools/notification/notification-create.test.ts`

**Behavior:** `mode: always|if_unique`; `NotificationData` input (4 required + optional `link`); `if_unique` null → "already exists" (never asserts creation). Report created title; do not present the returned id as reusable.

**Step 1: Write the failing test:**
```typescript
import { describe, expect, it } from "vitest";
import {
  CreateNotificationDocument,
  type CreateNotificationMutation,
  NotifyIfUniqueDocument,
  type NotifyIfUniqueMutation,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createNotificationCreateHandler } from "./notification-create.js";

const created = {
  createNotification: {
    id: "srv:Made_1700000010.notify",
    title: "Backup done",
    subject: "Appdata",
    description: "Completed in 4m",
    importance: "INFO",
    link: null,
    type: "UNREAD",
    timestamp: "1700000010",
    formattedTimestamp: "2023-11-14 12:02",
  },
} satisfies CreateNotificationMutation;

const baseArgs = {
  response_format: "concise" as const,
  title: "Backup done",
  subject: "Appdata",
  description: "Completed in 4m",
  importance: "info" as const,
};

describe("notification_create", () => {
  it("creates always via CreateNotification with the mapped importance", async () => {
    const { executor, calls } = recordingExecutor(created);
    const result = await createNotificationCreateHandler(executor)({ ...baseArgs, mode: "always" });
    expect(calls[0]?.document).toBe(CreateNotificationDocument);
    expect(calls[0]?.variables).toEqual({
      input: { title: "Backup done", subject: "Appdata", description: "Completed in 4m", importance: "INFO", link: undefined },
    });
    expect(firstText(result)).toBe("Created notification 'Backup done' (INFO).");
  });

  it("passes link through when provided", async () => {
    const { executor, calls } = recordingExecutor(created);
    await createNotificationCreateHandler(executor)({ ...baseArgs, mode: "always", link: "/Dashboard" });
    expect((calls[0]?.variables as { input: { link?: string } }).input.link).toBe("/Dashboard");
  });

  it("if_unique creates when no duplicate exists", async () => {
    const canned = { notifyIfUnique: created.createNotification } satisfies NotifyIfUniqueMutation;
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationCreateHandler(executor)({ ...baseArgs, mode: "if_unique" });
    expect(calls[0]?.document).toBe(NotifyIfUniqueDocument);
    expect(firstText(result)).toBe("Created notification 'Backup done' (INFO).");
  });

  it("if_unique reports 'already exists' on a null return and never asserts creation", async () => {
    const canned = { notifyIfUnique: null } satisfies NotifyIfUniqueMutation;
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationCreateHandler(executor)({ ...baseArgs, mode: "if_unique" });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toBe("An equivalent unread notification already exists; not created.");
    expect(firstText(result)).not.toMatch(/Created/);
  });

  it("returns an error result when the client throws", async () => {
    const throwing = { execute: async () => { throw new Error("bad input"); } };
    const result = await createNotificationCreateHandler(throwing)({ ...baseArgs, mode: "always" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to create notification/);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`notification-create.ts`):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  CreateNotificationDocument,
  NotifyIfUniqueDocument,
} from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";
import { IMPORTANCE_TO_API, type ImportanceInput } from "./_shared.js";

const TOOL_NAME = "notification_create";

type Mode = "always" | "if_unique";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  mode: z.enum(["always", "if_unique"]),
  title: z.string().min(1),
  subject: z.string().min(1),
  description: z.string().min(1),
  importance: z.enum(["alert", "warning", "info"]),
  link: z.string().optional(),
};

interface CreateArgs {
  response_format: ResponseFormat;
  mode: Mode;
  title: string;
  subject: string;
  description: string;
  importance: ImportanceInput;
  link?: string;
}

/** A created notification (the shape both create mutations return), or null for a skipped duplicate. */
interface CreatedNotification {
  title: string;
  importance: string;
}

/** Runs the chosen create mutation; `if_unique` may resolve to null (duplicate exists). */
async function runCreate(
  client: GraphQLExecutor,
  args: CreateArgs,
): Promise<CreatedNotification | null> {
  const input = {
    title: args.title,
    subject: args.subject,
    description: args.description,
    importance: IMPORTANCE_TO_API[args.importance],
    link: args.link,
  };
  if (args.mode === "if_unique") {
    return (await client.execute(NotifyIfUniqueDocument, { input })).notifyIfUnique;
  }
  return (await client.execute(CreateNotificationDocument, { input })).createNotification;
}

/**
 * Creates the `notification_create` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to create notifications.
 * @returns An MCP handler that writes a notification into Unraid's center.
 */
export function createNotificationCreateHandler(client: GraphQLExecutor) {
  return async (args: CreateArgs): Promise<CallToolResult> => {
    try {
      const notification = await runCreate(client, args);
      if (!notification) {
        return formatResponse(
          args.response_format,
          "An equivalent unread notification already exists; not created.",
          { created: false, notification: null },
        );
      }
      const concise = `Created notification '${notification.title}' (${notification.importance}).`;
      return formatResponse(args.response_format, concise, { created: true, notification });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to create notification: ${message}`);
    }
  };
}

/**
 * Registers the ungated `notification_create` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationCreate(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Create Notification",
      description:
        "Creates a notification in Unraid's notification center. `mode: always` always creates; `mode: if_unique` skips creation when an equivalent unread one already exists. `importance`: alert/warning/info.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    createNotificationCreateHandler(client),
  );
}
```

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-create.ts src/tools/notification/notification-create.test.ts
git commit -m "feat(notification): add ungated notification_create (always | if_unique)"
```

---

## Task 9: `notification_recalculate` (ungated mutation)

**Files:**
- Create: `src/tools/notification/notification-recalculate.ts`
- Test: `src/tools/notification/notification-recalculate.test.ts`

**Step 1: Write the failing test:**
```typescript
import { describe, expect, it } from "vitest";
import {
  RecalculateOverviewDocument,
  type RecalculateOverviewMutation,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createNotificationRecalculateHandler } from "./notification-recalculate.js";

const canned = {
  recalculateOverview: {
    unread: { info: 2, warning: 1, alert: 0, total: 3 },
    archive: { info: 4, warning: 0, alert: 0, total: 4 },
  },
} satisfies RecalculateOverviewMutation;

describe("notification_recalculate", () => {
  it("dispatches RecalculateOverview and reports the re-synced counts", async () => {
    const { executor, calls } = recordingExecutor(canned);
    const result = await createNotificationRecalculateHandler(executor)({ response_format: "concise" });
    expect(calls[0]?.document).toBe(RecalculateOverviewDocument);
    expect(firstText(result)).toBe("Overview re-synced from disk: 3 unread / 4 archived.");
  });

  it("returns the overview in detailed format", async () => {
    const { executor } = recordingExecutor(canned);
    const result = await createNotificationRecalculateHandler(executor)({ response_format: "detailed" });
    expect(JSON.parse(firstText(result))).toEqual(canned.recalculateOverview);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createNotificationRecalculateHandler(throwingExecutor("refresh failed"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to recalculate/);
  });
});
```

**Step 2: Run → FAIL.**

**Step 3: Implement** (`notification-recalculate.ts`):
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { RecalculateOverviewDocument } from "../../types/unraid/graphql.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "notification_recalculate";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
};

/**
 * Creates the `notification_recalculate` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to re-sync the overview.
 * @returns An MCP handler that recomputes the overview counts from disk.
 */
export function createNotificationRecalculateHandler(client: GraphQLExecutor) {
  return async ({ response_format }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const { recalculateOverview } = await client.execute(RecalculateOverviewDocument);
      const concise = `Overview re-synced from disk: ${recalculateOverview.unread.total} unread / ${recalculateOverview.archive.total} archived.`;
      return formatResponse(response_format, concise, recalculateOverview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to recalculate notification overview: ${message}`);
    }
  };
}

/**
 * Registers the ungated `notification_recalculate` tool.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerNotificationRecalculate(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Recalculate Notification Overview",
      description:
        "Re-syncs the notification overview counts from disk (corrects cache drift after bulk changes). Returns the refreshed counts.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    createNotificationRecalculateHandler(client),
  );
}
```

**Step 4: Run → PASS.**

**Step 5: Commit.**
```bash
git add src/tools/notification/notification-recalculate.ts src/tools/notification/notification-recalculate.test.ts
git commit -m "feat(notification): add ungated notification_recalculate (overview re-sync)"
```

---

## Task 10: Register all 7 tools + per-tool annotation-contract tests

**Files:**
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/registry.test.ts`

**Step 1: Write the failing annotation tests** — append to `registry.test.ts` (one per tool; assert the contract that distinguishes reads / ungated-writes / the gated delete):
```typescript
  it("registers the three notification reads as read-only", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    for (const name of ["notification_overview", "notification_list", "notification_alerts"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("registers notification_archive/create/recalculate as ungated non-destructive writes", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    for (const name of ["notification_archive", "notification_create", "notification_recalculate"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("registers notification_delete as destructive", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    const reg = registrations.find((r) => r.name === "notification_delete");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({ destructiveHint: true });
  });
```

**Step 2: Run → FAIL** (`registerAllTools` doesn't register them yet).
Run: `npx vitest run src/tools/registry.test.ts`

**Step 3: Wire the registry.** In `registry.ts` add the imports and calls:
```typescript
import { registerNotificationAlerts } from "./notification/notification-alerts.js";
import { registerNotificationArchive } from "./notification/notification-archive.js";
import { registerNotificationCreate } from "./notification/notification-create.js";
import { registerNotificationDelete } from "./notification/notification-delete.js";
import { registerNotificationList } from "./notification/notification-list.js";
import { registerNotificationOverview } from "./notification/notification-overview.js";
import { registerNotificationRecalculate } from "./notification/notification-recalculate.js";
```
And inside `registerAllTools`, after the VM registrations:
```typescript
  registerNotificationOverview(server, client);
  registerNotificationList(server, client);
  registerNotificationAlerts(server, client);
  registerNotificationArchive(server, client);
  registerNotificationDelete(server, client);
  registerNotificationCreate(server, client);
  registerNotificationRecalculate(server, client);
```

**Step 4: Run → PASS.** `npx vitest run src/tools/registry.test.ts`

**Step 5: Commit.**
```bash
git add src/tools/registry.ts src/tools/registry.test.ts
git commit -m "feat(notification): register the 7 notification tools + annotation contracts"
```

---

## Task 11: README + full verification + idempotency + stdio smoke

**Files:**
- Modify: `README.md` (promote notification tools from "planned" to shipped — mirror how VM tools are listed; one row per tool with its gate/annotation).

**Step 1: Update the README tool table/section** to list the 7 notification tools (3 read, `notification_archive`/`notification_create`/`notification_recalculate` ungated writes, `notification_delete` gated). Note in the doc that overview/list/alerts are reads and that counts come from a cache (`notification_list` is the source of truth) — keep it brief, matching the VM section's tone.

**Step 2: Full quality gate.**
Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all pass; no Biome findings.

**Step 3: Codegen idempotency.**
Run: `npm run generate && git diff --exit-code src/types/unraid/graphql.ts`
Expected: exit 0 (no diff).

**Step 4: Stdio `initialize → tools/list` smoke** (independent of unit tests; via the MCP SDK client, as the VM PR did). Build first, then run a throwaway script that spawns the server over stdio and lists tools:
```bash
npm run build
node --input-type=module -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, UNRAID_API_URL: "http://localhost/graphql", UNRAID_API_KEY: "smoke" } });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const want = ["notification_alerts","notification_archive","notification_create","notification_delete","notification_list","notification_overview","notification_recalculate"];
const missing = want.filter((n) => !names.includes(n));
const del = tools.find((t) => t.name === "notification_delete");
console.log("present:", want.filter((n) => names.includes(n)).length, "/7; missing:", missing);
console.log("delete destructiveHint:", del?.annotations?.destructiveHint);
await client.close();
if (missing.length || del?.annotations?.destructiveHint !== true) process.exit(1);
'
```
Expected: `present: 7 /7; missing: []` and `delete destructiveHint: true`; exit 0. (Env vars confirmed against `src/config/env.ts`: `UNRAID_API_URL` must be a valid URL, `UNRAID_API_KEY` non-empty — the dummy values above satisfy validation, and `tools/list` registers statically with no network call, so no reachable/mocked endpoint is needed.)

**Step 5: Commit.**
```bash
git add README.md
git commit -m "docs: promote notification tools to shipped"
```

---

## Definition of done

- [ ] 7 tools implemented TDD, each with colocated tests; all green.
- [ ] `notification_archive` proven (by test) to report the action and NOT echo returned counts; silent-swallow test present.
- [ ] `notification_delete` gated (no `confirm` → no executor call) and reports race-free counts.
- [ ] `notification_recalculate` shipped.
- [ ] Per-tool annotation-contract tests pass (reads `readOnlyHint:true`; archive/create/recalculate `destructiveHint:false`; delete `destructiveHint:true`).
- [ ] `npm run typecheck && npm run build && npm test && npm run lint` all pass.
- [ ] `npm run generate` is a no-op (idempotent).
- [ ] Stdio smoke lists all 7 tools with correct delete annotation.
- [ ] `src/tools/notification/` holds 8 source `.ts` (under the 10-file cap); tests + `.graphql` colocated.
- [ ] README updated.

## Independent verification (run by a separate verify agent, not the implementer)

Re-run from a clean checkout of the branch: `npm run typecheck && npm run build && npm test && npm run lint`, the codegen idempotency check, and the stdio smoke. Confirm no `any`, methods ≤25 lines / ≤2 nesting, JSDoc on exports, no magic numbers (the `DEFAULT_OFFSET`/`DEFAULT_LIMIT` constants in `notification-list.ts` cover the only literals). Spot-check that no tool `description` leaks the deep race/dual-write caveats (they belong in the design doc/PR).
