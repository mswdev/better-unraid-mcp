# better-unraid-mcp — Notification Tools Design (PR #6)

**Date:** 2026-06-03
**Author:** Matt White (mswdev)
**Status:** Approved (design) — source-validation pending (findings reconcile before planning)
**Branch:** `feature/notification-tools` → draft PR into `develop` (PR #5 already merged; no overlap)

## Goal

Ship the notifications domain: triage and manage Unraid's notification center over
the `Query.notifications` reads and the top-level `Mutation.*Notification*` writes.
This reuses every established convention — the `GraphQLExecutor` seam, per-tool
`.graphql` operation files, vendored-SDL + graphql-codegen pipeline, and the
`_shared` helpers (`respond.ts` for `formatResponse` concise/detailed, `confirm.ts`
for `requireConfirmation`, `test-support.ts` fakes).

The notification surface is **14 GraphQL fields** (3 reads + 11 top-level
mutations). We consolidate to **6 tools** — proportionate, not 1:1 and not a
mega-enum across incompatible return shapes.

## Gate policy — a deliberate departure from Docker/VM

Docker and VM gated **every** mutation. Notifications is the first domain where we
gate **proportionately**: only the genuinely irreversible operation is gated.

| Class | Tools | Reversible? | Gate | `destructiveHint` |
|-------|-------|-------------|------|-------------------|
| read | `notification_overview`, `notification_list`, `notification_alerts` | — (read) | none | n/a (`readOnlyHint:true`) |
| reversible write | `notification_archive` (archive/unarchive), `notification_create` | yes (inverse op / delete exists) | **none** | `false` |
| irreversible write | `notification_delete` | **no — permanent** | **`confirm:true`** | `true` |

This makes `destructiveHint:true` *mean something* (only the delete carries it) and
removes friction from fully-reversible triage (re-archiving what you just
unarchived). It introduces **ungated mutations with `destructiveHint:false`** — a
first for this repo — so the annotation-contract tests must be **per-tool**, and the
registration test must assert the un-gated tools are annotated `destructiveHint:false`.
(`recalculateOverview` placement is deferred — see Provisional, below.)

## Tools

### Reads (3 — all `readOnlyHint:true, destructiveHint:false, openWorldHint:false`)

#### `notification_overview`
- **GraphQL:** `notifications.overview` → `NotificationOverview { unread, archive }`,
  each a `NotificationCounts { info, warning, alert, total }`.
- **API:** `notification_overview(response_format?)`.
- **Description:** "Read-only. Returns notification counts: unread and archived,
  each broken down by importance (alert / warning / info) plus total."

#### `notification_list`
- **GraphQL:** `notifications.list(filter: NotificationFilter!)` →
  `[Notification!]!`, where
  `NotificationFilter { importance: NotificationImportance, type: NotificationType!, offset: Int!, limit: Int! }`.
- **API:** `notification_list(response_format?, type, importance?, offset?, limit?)`.
  - `type`: enum `unread | archive` — **required by the API**, mirrors
    `NotificationType {UNREAD, ARCHIVE}` exactly (no synthetic value).
  - `importance?`: enum `alert | warning | info` — optional server-side filter.
  - `offset?`: default `0`. `limit?`: default `25`. The API marks both `Int!`
    (no server default), so the **tool** supplies the defaults, autostart-style.
- **Description:** "Read-only. Lists notifications of one `type` (`unread` or
  `archive`), newest-relevant first. Optional `importance` filter
  (`alert`/`warning`/`info`); paginate with `offset` (default 0) and `limit`
  (default 25)."

#### `notification_alerts`
- **GraphQL:** `notifications.warningsAndAlerts` → `[Notification!]!`
  (deduplicated unread WARNING+ALERT, sorted latest first — per the SDL doc-comment).
- **API:** `notification_alerts(response_format?)` — **zero domain args**.
- **Rationale:** its own honest tool, **not** a `type=alerts` mode on
  `notification_list`. `warningsAndAlerts` takes no filter/pagination and applies
  its own dedup+sort; a synthetic `alerts` mode would silently ignore
  `importance`/`offset`/`limit` (a schema that lies). Three honest reads beat two
  where one lies.
- **Description:** "Read-only. The 'what needs my attention now' shortcut:
  deduplicated unread warnings and alerts, latest first. No paging — returns the
  current attention set."

### Mutations (3)

#### `notification_archive` — reversible state move (ungated, `destructiveHint:false`)
- **GraphQL (batch/all forms only):**
  `archiveNotifications(ids)` / `unarchiveNotifications(ids)` /
  `archiveAll(importance?)` / `unarchiveAll(importance?)` — all return
  `NotificationOverview!`.
- **API:** `notification_archive(response_format?, direction, ids?, all?, importance?)`.
  - `direction`: enum `archive | unarchive`.
  - **Target — exactly one of:** `ids` (non-empty `string[]`) **xor** `all: true`.
  - `importance?`: enum `alert | warning | info`, **valid only with `all: true`**
    (maps to `archiveAll(importance)` / `unarchiveAll(importance)`; omitted = all
    of that direction). The batch-by-`ids` forms take no importance.
- **Validation (fail-fast, before any mutation):**
  - exactly one of `ids`(non-empty) | `all:true` — else `toolError` ("No changes
    were made.").
  - `importance` with `ids` (not `all`) → `toolError`.
- **Reporting:** all four forms return `NotificationOverview!` → uniform resulting
  counts: `"Now N unread (a alert / w warning / i info); M archived."`
- **Named tradeoff:** we use the **batch/all** forms exclusively (never the single
  `archiveNotification(id)` / `unreadNotification(id)`), so reporting is uniform
  Overview counts at the cost of the single mutations' changed-`Notification` return
  (we do not echo the archived title). Accepted for v1; **no dual single+batch
  paths.**
- **Description:** "Archive (hide) or unarchive (restore to unread) notifications.
  Reversible. Target either specific `ids` (from `notification_list`) **or**
  `all: true` (optionally narrowed by `importance`). Reports the resulting unread
  and archived counts."

#### `notification_delete` — irreversible (GATED, `confirm:true`, `destructiveHint:true`)
- **GraphQL:** `deleteNotification(id, type: NotificationType!)` /
  `deleteArchivedNotifications` — both return `NotificationOverview!`.
- **API:** `notification_delete(response_format?, scope, id?, type?, confirm?)`.
  - `scope`: enum `one | all_archived`.
  - `one`: requires **both** `id` and `type` (`unread | archive`) — the API needs
    `type` to locate which bucket the notification lives in (see Provisional #3).
  - `all_archived`: no `id`/`type` (deletes every archived notification).
  - There is **no "delete all unread"** mutation, so we model **no** generic
    `all`+`type`; `all_archived` is the only bulk delete.
- **Gate:** `requireConfirmation(confirm, "<...>")` — reuse the shared helper.
- **Validation:** `one` without `id`+`type` → `toolError`; `all_archived` with
  `id`/`type` → `toolError` (reject mixed input rather than silently ignore).
- **Reporting:** returns `NotificationOverview!` → resulting counts (subject to the
  freshness finding — Provisional #3).
- **Description:** "⚠ Permanently deletes notifications (irreversible). `scope`:
  `one` (needs `id` + its `type`) or `all_archived` (every archived notification).
  Requires `confirm: true`. Reports the resulting counts."

#### `notification_create` — additive write (ungated, `destructiveHint:false`)
- **GraphQL:** `createNotification(input: NotificationData!)` → `Notification!`;
  `notifyIfUnique(input: NotificationData!)` → `Notification` (**nullable**).
- **API:** `notification_create(response_format?, mode, title, subject, description, importance, link?)`.
  - `mode`: enum `always | if_unique`.
  - `NotificationData { title!, subject!, description!, importance!, link? }`.
- **`if_unique` null branch:** `notifyIfUnique` returns **null** when an equivalent
  unread notification already exists. The handler **branches on null** and reports
  `"An equivalent unread notification already exists; not created."` — it **never
  asserts creation** on a null return (subject to Provisional #1 confirmation of the
  null semantics).
- **Reporting:** on a created `Notification` → `"Created notification '<title>'
  (<importance>)."` (echo title + importance; the create forms return the
  Notification, so we *do* echo it here — unlike archive).
- **Description:** "Writes a new notification into Unraid's notification center.
  `mode: always` always creates; `mode: if_unique` skips creation when an
  equivalent unread one already exists (reports 'already exists'). `importance`:
  alert/warning/info."

## Provisional — revisited at the post-source-validation reconcile checkpoint

These three are **designed but not locked**; the source-validation Workflow over
`unraid/api` decides them, and the doc is revised before planning.

1. **`unreadNotification` ≡ unarchive (merge).** `NotificationType` is only
   `UNREAD | ARCHIVE`, so "mark unread" should be the **same** archive→unread
   transition as unarchive; the `notification_archive` grid folds it in (and we use
   `unarchiveNotifications`/`unarchiveAll`, never the single `unreadNotification`).
   **If validation shows distinct semantics** (e.g. `unreadNotification` resets a
   read-flag without changing bucket), split it into its own path/tool. Also
   confirm `notifyIfUnique`'s **null == duplicate-unread-exists** semantics
   (Create's null branch depends on it).

2. **`recalculateOverview` — deferred from v1 pending the staleness finding.** The
   SDL calls `overview` a *cached* value and exposes `recalculateOverview` to
   recompute it — implying it can be stale. **If** the mutations' returned
   `Overview`s already reflect fresh post-mutation counts (and/or `overview` is
   effectively live), `recalculate` is low-value → **omit from v1**. **If**
   `overview` is genuinely stale and mutations do **not** refresh it, add a
   standalone `notification_recalculate` tool (mutation, returns Overview, ungated).
   **Never** fold it as a `refresh:true` flag on `notification_overview` — that
   would make a `readOnly` tool perform a mutation (annotation lie). Decision lands
   at reconcile.

3. **Delete / Overview freshness + why `deleteNotification` needs `type`.** Confirm
   (a) why `deleteNotification(id, type)` requires the `type` (which bucket — likely
   the backend stores unread vs archive separately, so it must know which to delete
   from), and (b) whether the `Overview` returned by `deleteNotification` /
   `archive*` / `unarchive*` reflects **fresh post-mutation counts** or a stale
   cache. If stale, our "resulting counts" reporting is misleading and we either
   call `recalculateOverview` after, or caveat the copy. Same dependency as #2.

## Additional source-validation questions (SDL does not state)

- **`NotificationFilter` bounds:** does the API **cap** `limit` (and reject
  negative `offset`/`limit`)? Is `type` genuinely required (it is `Int!`/non-null
  in the SDL, but confirm the resolver does not default it)? Sets our default-`25`
  / `offset-0` story and whether we clamp client-side.
- **RBAC / feature-flag gating:** VM had `@UsePermissions` on a VMS-like Resource
  and **no** feature flag. Confirm the notifications resolvers' permission
  resource/action (likely `NOTIFICATIONS`) and that **none** is `@UseFeatureFlag`
  (so no "needs Unraid 7.x" copy). A key lacking permission fails at runtime →
  surfaced via `toolError`.
- **`PrefixedID` round-trip:** `Notification.id` is `PrefixedID!` — confirm it is
  the same `serverId:rawId` scalar as VMs. Here ids come **straight from the list
  read** (no name→id resolve needed), so we pass them through verbatim; we do **not**
  need the tolerant-match helper. Confirm a list-returned id is accepted as-is by
  `archive*`/`delete`.
- **`warningsAndAlerts` dedup + sort:** confirm the dedup key (by subject? by
  title+subject?) and that sort is by timestamp descending, so our description
  ("deduplicated … latest first") is accurate.

## GraphQL operations (per-tool `.graphql`; subject to reconcile)

```graphql
# notification-overview.graphql
query NotificationOverview {
  notifications {
    overview { unread { info warning alert total } archive { info warning alert total } }
  }
}

# notification-list.graphql
query NotificationList($filter: NotificationFilter!) {
  notifications {
    list(filter: $filter) {
      id title subject description importance link type timestamp formattedTimestamp
    }
  }
}

# notification-alerts.graphql
query NotificationAlerts {
  notifications {
    warningsAndAlerts { id title subject description importance link type timestamp formattedTimestamp }
  }
}

# notification-archive.graphql
mutation ArchiveNotifications($ids: [PrefixedID!]!)   { archiveNotifications(ids: $ids) { unread { info warning alert total } archive { info warning alert total } } }
mutation UnarchiveNotifications($ids: [PrefixedID!]!) { unarchiveNotifications(ids: $ids) { unread { info warning alert total } archive { info warning alert total } } }
mutation ArchiveAll($importance: NotificationImportance)   { archiveAll(importance: $importance) { unread { info warning alert total } archive { info warning alert total } } }
mutation UnarchiveAll($importance: NotificationImportance) { unarchiveAll(importance: $importance) { unread { info warning alert total } archive { info warning alert total } } }

# notification-delete.graphql
mutation DeleteNotification($id: PrefixedID!, $type: NotificationType!) { deleteNotification(id: $id, type: $type) { unread { info warning alert total } archive { info warning alert total } } }
mutation DeleteArchivedNotifications { deleteArchivedNotifications { unread { info warning alert total } archive { info warning alert total } } }

# notification-create.graphql
mutation CreateNotification($input: NotificationData!) { createNotification(input: $input) { id title subject description importance link type timestamp formattedTimestamp } }
mutation NotifyIfUnique($input: NotificationData!)     { notifyIfUnique(input: $input) { id title subject description importance link type timestamp formattedTimestamp } }
```

A shared `overview { … }` selection appears across the Overview-returning mutations
— if codegen + DRY warrant it, factor a fragment in the plan; otherwise repeat the
six-field selection (it is small and explicit).

## Output

- **`notification_overview` — concise:** `"Unread: T (a alert / w warning / i info).
  Archived: T (…)."`; **detailed:** the full `{ unread, archive }` counts object.
- **`notification_list` / `notification_alerts` — concise:** one line per
  notification — `"[IMPORTANCE] <title> — <subject> (<formattedTimestamp>)"`; empty
  list distinguishes filter-empty from none: `notification_list` →
  `"No <type> notifications match…"` vs `notification_alerts` → `"No unread
  warnings or alerts."`; **detailed:** the `Notification[]` array.
- **`notification_archive` / `notification_delete` — concise:** resulting counts
  (see each tool); **detailed:** `{ overview, <op metadata> }`.
- **`notification_create` — concise:** created → `"Created notification '<title>'
  (<importance>)."`; `if_unique` duplicate → `"An equivalent unread notification
  already exists; not created."`; **detailed:** `{ created: boolean, notification }`.

## Error handling

`try/catch → toolError` around every `client.execute`. The client throws
`UnraidApiError` on any `errors[]`, so a field-resolver error (permission denied,
unknown id, invalid `type`) surfaces via the handler's catch. Gate refusals
(`notification_delete`) and input-validation failures (archive target xor, delete
scope/args) return `toolError` **before** any mutation.

## Testing

Hand-written fakes only (`test-support.ts`): `firstText`, `recordingExecutor`,
`throwingExecutor`/`rejectingExecutor`, and `sequencedExecutor` only where a handler
makes >1 call (none here is multi-call unless reconcile adds a post-mutation
`recalculate`). Every fixture typed `satisfies <Op>Query/Mutation` so codegen drift
breaks the build.

- **Reads:** counts rendering; empty vs non-empty; null `timestamp`/`link` handling
  (both nullable); filter-empty vs none copy; concise vs detailed; error path.
- **`notification_list`:** default `offset`/`limit` applied; `type` passed through;
  `importance` optional; (client-side clamp if reconcile says the API caps `limit`).
- **`notification_archive`:** target xor (neither / both → `isError`, mutation never
  called); `importance` with `ids` → `isError`; each `direction`×target dispatches
  the right Document; resulting-counts copy; concise vs detailed; error path.
- **`notification_delete`:** **gate** (no `confirm` → `isError`, executor never
  called); `one` without `id`+`type` → `isError`; `all_archived` with `id`/`type` →
  `isError`; each scope dispatches the right Document; resulting-counts copy; error.
- **`notification_create`:** `always` → created copy; `if_unique` **null return** →
  "already exists" copy (and does **not** assert creation); each mode dispatches the
  right Document; concise vs detailed; error.
- **Registration / annotations (per-tool):** all 6 register; reads `readOnlyHint:true`;
  `notification_archive`/`notification_create` `readOnlyHint:false, destructiveHint:false,
  openWorldHint:false`; `notification_delete` `destructiveHint:true`.

## Placement

```
src/tools/notification/               # new domain dir — 6 source .ts, == the 10-file cap (OK)
  notification-overview.{ts,graphql,test.ts}
  notification-list.{ts,graphql,test.ts}
  notification-alerts.{ts,graphql,test.ts}
  notification-archive.{ts,graphql,test.ts}
  notification-delete.{ts,graphql,test.ts}
  notification-create.{ts,graphql,test.ts}
src/tools/registry.ts                 # registers the 6 notification tools
src/types/unraid/graphql.ts           # regenerated (notification ops)
README.md                             # promote notification tools to shipped
```

- **Directory cap:** 6 source `.ts` files (tests + `.graphql` do not count) — within
  the 10-file cap. If `recalculate` is added (reconcile), that is 7 — still under.
- **Shared selection helper:** a `notification/_shared.ts` is **only** introduced if
  two tools genuinely share logic (e.g. an Overview-counts formatter used by both
  `notification_archive` and `notification_delete`). The concise Overview-counts
  summary *is* shared by those two → a small `formatOverviewCounts(overview)` helper
  in `_shared.ts` is justified (exported + unit-tested directly), unlike the VM domain
  which had no genuine shared helper. Decide final shape in the plan.

## Out of scope / residual unknowns

- **Not verified against a live Unraid box.** All semantics from static reads of
  `unraid/api` + the vendored SDL; no live verification. Flagged here and in the PR.
- **Subscriptions** (`notificationAdded`, `notificationsOverview`,
  `notificationsWarningsAndAlerts`) — **deferred**: there is no subscription
  transport in the server yet. Note and revisit when streaming lands.
- **`recalculateOverview`** — deferred from v1 pending the staleness finding
  (Provisional #2).
- No notification **settings / SMTP / agent configuration** — v1 is read + manage +
  create only.

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, codegen
idempotency (`npm run generate` no-diff), and an independent stdio
`initialize → tools/list` smoke (via the MCP SDK client) confirming all 6
notification tools register with the correct annotations (reads `readOnlyHint:true`;
`notification_delete` `destructiveHint:true`; the other two writes
`destructiveHint:false`).
