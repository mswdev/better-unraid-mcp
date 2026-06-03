# better-unraid-mcp — Notification Tools Design (PR #6)

**Date:** 2026-06-03
**Author:** Matt White (mswdev)
**Status:** Approved + source-validation reconciled — ready for implementation planning
**Branch:** `feature/notification-tools` → draft PR into `develop` (PR #5 already merged; no overlap)

## Goal

Ship the notifications domain: triage and manage Unraid's notification center over
the `Query.notifications` reads and the top-level `Mutation.*Notification*` writes.
Reuses every established convention — the `GraphQLExecutor` seam, per-tool `.graphql`
operation files, vendored-SDL + graphql-codegen pipeline, and the `_shared` helpers
(`respond.ts` `formatResponse`, `confirm.ts` `requireConfirmation`, `test-support.ts`
fakes).

The notification surface is **14 GraphQL fields** (3 reads + 11 top-level mutations).
We consolidate to **7 tools** — proportionate, not 1:1 and not a mega-enum across
incompatible return shapes.

## Validated semantics (source-read, NOT live-verified)

A focused source-validation Workflow over `unraid/api` (`main` @ `264ddf0`, v4.35.0) —
8 questions, each independently re-checked by an adversarial verifier, plus a
completeness critic — settled the assumptions the SDL does not state. **None is
live-verified against a real Unraid box** (a moving branch + static reads); flagged
here and in the PR. Findings (with file:line in `unraid-api/.../notifications/`):

1. **Notifications are FILES in two sibling dirs (`unread/`, `archive/`); the `id` is
   the `.notify` filename and does NOT encode its bucket.** `paths()` maps each
   `NotificationType` to `join(basePath, type.toLowerCase())` (`service.ts:80-94`);
   `getIdFromPath = basename(path)` (`service.ts:892-894`). `archiveNotification`
   looks **only** in `unread/` (`service.ts:520-528`, throws `AppError(404)` if
   absent); `markAsUnread` **only** in `archive/` (`service.ts:556-562`);
   `deleteNotification` uses `join(paths()[type], id)` (`service.ts:398`). ⇒ direction
   must match the id's current bucket, and delete's `type` must match the bucket the
   id came from.

2. **The overview is a drifting in-memory cache; bulk archive/unarchive return RACY
   counts. Only the per-`importance` "all" branch and the deletes are accurate.**
   `getOverview()` returns `structuredClone` of a **static** field
   (`service.ts:48-61, 217-219`), maintained incrementally. `moveNotification`
   **decrements the FROM bucket synchronously** (`service.ts:502`) but the **TO bucket
   increment is deferred to the async chokidar `add` watcher** (`service.ts:198`); the
   single-move path guards this with a `snapshot` (`service.ts:539-546`), but:
   - `archiveNotifications(ids)` / `unarchiveNotifications(ids)` resolvers call
     `getOverview()` **after** `archiveIds`/`unarchiveIds` (`resolver.ts:97-104,
     135-142`) → TO bucket under-counted.
   - `archiveAll()` / `unarchiveAll()` **without** importance return the static cache
     (`service.ts:585-588, 607-610`) → same race.
   - `archiveAll(importance)` / `unarchiveAll(importance)` return an accurate
     `snapshot` that received both deltas (`service.ts:590-601, 613-624`).
   - `deleteNotification` (sync `decrement`, `service.ts:406, 414`) and
     `deleteNotifications`→`emptyDir` + zero (`service.ts:423-436`) are **accurate**.
   - `recalculateOverview` rebuilds from disk (`service.ts:251-256`) — but
     `buildOverviewSnapshot` counts `archive/` **without** the unread-dedup that the
     `list` read applies (`service.ts:279-284` vs `674-680`), so it can **double-count
     legacy dual-writes** and disagree with `notification_list`.

3. **`notification_list` is the only SELF-CONSISTENT ground truth.** It dedups
   archive-vs-unread (excludes archive files that also exist in `unread/`,
   `service.ts:674-680`) and shows each notification once in its real bucket. Overview
   (racy cache), bulk-mutation returns (racy), and recalculate (double-counts
   dual-writes) are three approximations with **distinct failure modes**; the list is
   truth. ⇒ every reporting decision points the caller back to `notification_list`.

4. **`unreadNotification` ≡ unarchive (merge SAFE), but bulk swallows bad input.**
   `unarchiveIds(ids)` is literally `batchProcess(ids, id => markAsUnread({id}))`
   (`service.ts:651-653`); `archiveIds` is `batchProcess(ids, id =>
   archiveNotification({id}))` (`service.ts:637-639`); the same `moveNotification`
   underlies all paths. So folding the single `unreadNotification` out is mechanically
   safe. **BUT** `batchProcess` uses `Promise.allSettled` and **never throws**
   (`utils.ts:58-71`); the `archiveNotifications`/`unarchiveNotifications` resolvers
   **discard** its result and return an overview (`resolver.ts:97-104, 135-142`). ⇒ a
   bogus / wrong-bucket id in a batch **silently succeeds** with no per-id signal.
   (The single mutations would `throw AppError(404)`, but we don't use them.)

5. **`deleteNotification`'s wrong-`type` is not always an error.** For an id unique to
   one dir, a wrong `type` → `readFile` ENOENT → the mutation rejects → our
   `catch → toolError`. **But** legacy dual-writes put the same id in **both** dirs
   (`service.ts:674-680`); a wrong-`type` delete then finds the file, unlinks the
   **wrong** dir's copy, and decrements that bucket (`service.ts:404-406`), leaving the
   other copy. ⇒ delete is per-bucket; document "deletes the copy in the named bucket;
   a dual-written id may still exist in the other bucket."

6. **`notifyIfUnique` null === an equivalent UNREAD notification exists.** Computes a
   5-field fingerprint `importance|title|subject|description|link` (each text field
   `.trim()`ed; `service.ts:1013-1040`), checks **unread only**
   (`service.ts:988-1002`); duplicate → `return null` (`service.ts:697-702`), else
   `createNotification` (`service.ts:704`). `createNotification` has **no** dedup —
   always writes and returns a `Notification` of type `UNREAD` (`service.ts:302-323`),
   or throws on IO failure (never null). An equivalent **archived** notification does
   **not** suppress creation. ⇒ Create's `if_unique` branch on null reports "already
   exists; not created" and never asserts creation.

7. **`createNotification`'s returned `id` may NOT match the on-disk filename.** The
   happy path shells out to the external legacy `notify` script with `-i/-e/-s/-d/-l`
   only (no filename, `service.ts:307-308, 334-346`); the script picks its own
   on-disk name. Only the **catch-fallback** `writeFile` uses the locally-generated id
   (`service.ts:314-317`). ⇒ do **not** present `notification_create`'s returned id as
   reusable for a follow-up archive/delete; re-list to get the authoritative id.

8. **`NotificationFilter` bounds + ordering.** Validators: `offset @Min(0)`,
   `limit @Min(1)`, **no `@Max`**; `type` required (non-null + `@IsNotEmpty`);
   `importance` optional (`model.ts:26-49`). Enforced by the **global `ValidationPipe`
   (`transform + whitelist + forbidNonWhitelisted`, `main.ts:79-84`)** — so `limit<=0`
   is rejected and unknown/missing fields are rejected; the API does **not** cap
   `limit`. **Pagination footgun:** `loadNotificationsFromPaths` slices
   `files.slice(offset, limit + offset)` **before** filtering by `importance`
   (`service.ts:800` vs `811-815`) ⇒ with `importance` set, `limit` caps the
   **pre-filter scan window**, not the result count (can under-return). Ordering is
   effectively **file birthtime desc** — `sortLatestFirst` is a NaN no-op because the
   timestamp is an ISO string (`Number(ISO)=NaN`, `service.ts:1004-1007`), so the
   `listFilesInFolder` birthtime sort wins (`service.ts:757`).

9. **`warningsAndAlerts`: unread ALERT+WARNING, 5-field dedup, latest-first, cap 50.**
   `getWarningsAndAlerts(limit=50)` loads unread, keeps only ALERT/WARNING
   (`service.ts:722-727`), dedups by the same fingerprint (`service.ts:1009-1040`),
   newest-first, breaks at 50 (`service.ts:737-739`); the resolver calls it with no
   arg. SDL doc-comment matches.

10. **Permissions: reads gated, mutations default-ALLOW; no feature flags.** The
    `notifications` query carries `@UsePermissions(READ_ANY, NOTIFICATIONS)`
    (`resolver.ts:28-32`); **no mutation carries `@UsePermissions`**, and nest-authz
    default-allows when the metadata is absent. ⇒ a key lacking `NOTIFICATIONS`
    permission fails on **reads** (auth error → `toolError`) but the **mutations run
    regardless** — there is **no permission-denied path to handle for mutations**
    (unlike VM). No member is `@UseFeatureFlag` → always in-schema (no "needs 7.x"
    copy). The confirm-gate on delete is correct MCP-level safety **independent** of
    the API's default-allow; the default-allow is a PR security note, not something we
    build gating around.

11. **`PrefixedID` round-trips (same scalar as VM).** `serialize` prepends
    `serverId:` unless already prefixed; `parseValue`/`parseLiteral` `split(':')` and
    return part[1] only when exactly 2 parts, else the value unchanged
    (`prefixed-id-scalar.ts:56-106`). A colon-free filename id round-trips; a
    `serverId:filename` parses back to the filename. ⇒ **read ids pass straight into
    archive/delete verbatim — no name-resolve/tolerant-match helper needed** (unlike
    VM, finding #1's bucket rule is the only constraint).

## Gate policy — proportionate (a deliberate departure from Docker/VM)

Only the genuinely irreversible op is gated.

| Class | Tools | Gate | Annotations |
|-------|-------|------|-------------|
| read | `notification_overview`, `notification_list`, `notification_alerts` | none | `readOnlyHint:true, destructiveHint:false, openWorldHint:false` |
| reversible / additive write | `notification_archive`, `notification_create`, `notification_recalculate` | **none** | `readOnlyHint:false, destructiveHint:false, openWorldHint:false` |
| irreversible write | `notification_delete` | **`confirm:true`** | `readOnlyHint:false, destructiveHint:true, openWorldHint:false` |

This makes `destructiveHint:true` mean something (only delete), removes friction from
reversible triage, and introduces **ungated mutations with `destructiveHint:false`** —
a first for this repo ⇒ the annotation-contract tests must be **per-tool**.

## Tools (7)

Descriptions stay **clean and action-oriented** (the calling LLM reads them for
selection); at most one load-bearing caveat each. The deep findings above stay in this
doc / the PR, NOT in the descriptions.

### Reads (3)

| Tool | GraphQL | Args | Description (clean) |
|------|---------|------|---------------------|
| `notification_overview` | `notifications.overview` | `response_format?` | "Read-only. Notification counts: unread and archived, each by importance (alert/warning/info) plus total." |
| `notification_list` | `notifications.list(filter)` | `type` (unread\|archive, req), `importance?`, `offset?=0`, `limit?=25` | "Read-only. Lists notifications of one `type`, newest first. Optional `importance`; paginate with `offset`/`limit`. The source of truth for which notifications exist and their ids." |
| `notification_alerts` | `notifications.warningsAndAlerts` | `response_format?` | "Read-only. Deduplicated unread warnings and alerts, newest first — the 'needs attention now' view (up to 50)." |

- `notification_list.type` mirrors `NotificationType {UNREAD, ARCHIVE}`; tool supplies
  the API-required `offset`/`limit` defaults (never sends `limit:0`).
- `importance` is the lowercase tool enum `alert|warning|info` mapped to the SDL
  `NotificationImportance`.

### Mutations (4)

| Tool | GraphQL | Gate | Reporting |
|------|---------|------|-----------|
| `notification_archive` | `archiveNotifications(ids)` / `unarchiveNotifications(ids)` / `archiveAll(importance?)` / `unarchiveAll(importance?)` | ungated | **action-based** (see Reporting) |
| `notification_delete` | `deleteNotification(id,type)` / `deleteArchivedNotifications` | **confirm** | **resulting counts** (race-free) |
| `notification_create` | `createNotification(input)` / `notifyIfUnique(input)` | ungated | created title (or "already exists") |
| `notification_recalculate` | `recalculateOverview` | ungated | re-synced counts |

- **`notification_archive`** `(response_format?, direction: archive|unarchive, ids?: string[], all?: boolean, importance?)`:
  - target = **exactly one of** `ids` (non-empty) **xor** `all:true`; `importance`
    valid **only** with `all:true`. Validate fail-fast → `toolError` before any call.
  - uses **batch/all forms only** (never single `archiveNotification`/`unreadNotification`).
  - `ids` param description carries the bucket rule: "archive expects currently-unread
    ids; unarchive expects archived ids (both from notification_list)."
  - Description (clean): "Archive (hide) or unarchive (restore to unread) notifications
    — reversible. Target `ids` (from notification_list) or `all: true` (optionally one
    `importance`). Reports the action — confirm with notification_list."
- **`notification_delete`** `(response_format?, scope: one|all_archived, id?, type?, confirm?)`:
  - `one` requires `id`+`type`; `all_archived` takes neither. Validate fail-fast.
  - Description: "⚠ Permanently deletes notifications (irreversible). `scope`: `one`
    (needs `id` + its `type`) or `all_archived`. Requires `confirm: true`. Reports the
    resulting counts."
- **`notification_create`** `(response_format?, mode: always|if_unique, title, subject, description, importance, link?)`:
  - input mirrors `NotificationData` exactly (4 required + optional `link`); the global
    `whitelist + forbidNonWhitelisted` pipe rejects extra/missing fields, so the zod
    schema must match exactly.
  - Description: "Creates a notification in Unraid's notification center. `mode: always`
    always creates; `mode: if_unique` skips if an equivalent unread one already exists.
    `importance`: alert/warning/info."
- **`notification_recalculate`** `(response_format?)`:
  - Description: "Re-syncs the notification overview counts from disk (corrects cache
    drift after bulk changes). Returns the refreshed counts."

## Reporting (the core, source-driven design)

Apply the autostart/VM lesson HONESTLY: report **real, knowable** state, never assert
state the API doesn't actually confirm.

- **`notification_archive` — ACTION-based, NOT counts.** The returned overview is racy
  for the `ids` and `all`-without-importance paths (finding #2), and bulk silently
  swallows bad ids (finding #4) — so we report **what was requested** (certain) and
  point to the ground truth:
  - concise: `Requested archive of 3 notification(s); verify with notification_list.`
    / `Requested unarchive of all WARNING notifications; verify with notification_list.`
  - The summary **must not** derive counts from the returned overview.
  - detailed: `{ requested: {direction, ids?|all, importance?}, serverOverview: <raw returned — may lag> }` (the overview is included verbatim but labeled as the server's running tally).
- **`notification_delete` — resulting counts** (deletes are **race-free**: a synchronous
  `decrement`/zero with no async watcher catch-up, finding #2 — so unlike the bulk
  move-race we can report the returned counts. They remain cache-derived, so a legacy
  dual-write id carries the same cache-vs-list discrepancy noted in residual-unknowns;
  we do NOT add a "verify with list" pointer here — that would blur the clean
  race/no-race line):
  - concise: `Deleted 1 notification; now N unread / M archived.` /
    `Deleted all archived notifications; now N unread / 0 archived.`
- **`notification_create`:** created → `Created notification '<title>' (<importance>).`
  (verb "Created", not "delivered"); `if_unique` null →
  `An equivalent unread notification already exists; not created.` Do **not** present
  the returned id as reusable (finding #7). detailed: `{ created: boolean, notification }`.
- **`notification_recalculate`:** `Overview re-synced from disk: N unread / M archived.`
- **`notification_overview` / `notification_list` / `notification_alerts`:** see Output.

## GraphQL operations (per-tool `.graphql`)

A shared `NotificationCounts` selection (`info warning alert total`) recurs across the
Overview-returning ops; factor a GraphQL **fragment** (`overviewFields` /
`counts`) if codegen + DRY warrant it, else repeat the small explicit selection.

```graphql
# notification-overview.graphql
query NotificationOverview { notifications { overview { unread { info warning alert total } archive { info warning alert total } } } }

# notification-list.graphql
query NotificationList($filter: NotificationFilter!) {
  notifications { list(filter: $filter) { id title subject description importance link type timestamp formattedTimestamp } }
}

# notification-alerts.graphql
query NotificationAlerts { notifications { warningsAndAlerts { id title subject description importance link type timestamp formattedTimestamp } } }

# notification-archive.graphql  (returns NotificationOverview — kept in detailed only)
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

# notification-recalculate.graphql
mutation RecalculateOverview { recalculateOverview { unread { info warning alert total } archive { info warning alert total } } }
```

## Output

- **`notification_overview` — concise:** `Unread: T (a alert / w warning / i info). Archived: T (…).`; **detailed:** the `{ unread, archive }` counts.
- **`notification_list` / `notification_alerts` — concise:** one line per notification `[IMPORTANCE] <title> — <subject> (<formattedTimestamp>)`; **detailed:** the `Notification[]`. Empty-result copy distinguishes the cases (mirroring the VM filter-empty-vs-none precedent):
  - `notification_list`, `importance` set → `No <type> notifications match importance <X>.`
  - `notification_list`, no `importance` → `No <type> notifications.`
  - `notification_alerts` → `No unread warnings or alerts.`
- **mutations:** see Reporting; detailed carries the structured payload.

## Error handling

`try/catch → toolError` around every `client.execute`. The client throws
`UnraidApiError` on any `errors[]`. Reads can hit a **permission-denied** auth error
(key lacks `READ_ANY NOTIFICATIONS`, finding #10) → surfaces via catch. **Mutations are
default-allow** → no permission-denied path to handle for them. Gate refusal
(`notification_delete`) and input-validation failures (archive target xor; delete
scope/args) return `toolError` **before** any call. A wrong-`type` delete of a
single-bucket id throws ENOENT → caught (finding #5). Bulk archive/unarchive of a
bogus id does **not** error (silently swallowed, finding #4) — hence action-based
reporting + "verify with notification_list."

## Testing

Hand-written fakes only (`test-support.ts`): `firstText`, `recordingExecutor`,
`throwingExecutor`/`rejectingExecutor`. No handler here is multi-call (each tool issues
exactly one `execute`), so `sequencedExecutor` is not needed. Every fixture typed
`satisfies <Op>Query/Mutation` so codegen drift breaks the build.

- **Reads:** counts rendering; empty vs non-empty; null `timestamp`/`link`; filter-empty
  vs none copy; concise vs detailed; read permission-denied error path.
- **`notification_list`:** default `offset=0`/`limit=25` applied (never 0); `type`
  passed through; `importance` optional.
- **`notification_archive` (reporting is the executable spec for the redesign):**
  - target xor: neither / both → `isError`, **executor never called**; `importance`
    with `ids` → `isError`.
  - each `direction`×target dispatches the correct Document with correct variables.
  - **action-requested copy** asserted (e.g. `Requested archive of N…; verify with
    notification_list.`).
  - **silent-swallow test:** the fixture returns an **arbitrary / empty** overview;
    assert the concise summary reports the **requested** action and **does NOT** parrot
    or derive counts from the returned overview (proves we don't trust racy counts).
  - error path.
- **`notification_delete`:** **gate** (no `confirm` → `isError`, executor never called);
  `one` without `id`+`type` → `isError`; `all_archived` with `id`/`type` → `isError`;
  each scope dispatches the right Document; **resulting-counts copy** asserted; error.
- **`notification_create`:** `always` → "Created '<title>'" copy; `if_unique` **null
  return** → "already exists" copy and **does not** assert creation; each mode
  dispatches the right Document; input schema requires the 4 fields + optional `link`;
  concise vs detailed; error.
- **`notification_recalculate`:** re-synced-counts copy; dispatches `RecalculateOverview`;
  error.
- **Registration / annotations (per-tool):** all 7 register; reads `readOnlyHint:true`;
  `notification_archive`/`notification_create`/`notification_recalculate`
  `readOnlyHint:false, destructiveHint:false, openWorldHint:false`; `notification_delete`
  `destructiveHint:true`.

## Placement

```
src/tools/notification/               # new domain dir — 8 source .ts (under the 10-file cap)
  _shared.{ts,test.ts}                # formatCounts/summarizeOverview + importance mapping
  notification-overview.{ts,graphql,test.ts}
  notification-list.{ts,graphql,test.ts}
  notification-alerts.{ts,graphql,test.ts}
  notification-archive.{ts,graphql,test.ts}
  notification-delete.{ts,graphql,test.ts}
  notification-create.{ts,graphql,test.ts}
  notification-recalculate.{ts,graphql,test.ts}
src/tools/registry.ts                 # registers the 7 notification tools
src/types/unraid/graphql.ts           # regenerated (notification ops)
README.md                             # promote notification tools to shipped
```

- **Shared helper:** the concise `NotificationCounts` summary (`T (a alert / w warning
  / i info)`) is shared by overview / delete / recalculate ⇒ a small
  `formatCounts(counts)` / `summarizeOverview(overview)` in
  `notification/_shared.ts`, exported + unit-tested directly (justified, unlike the VM
  domain which had no genuine shared helper). The `importance` enum↔SDL mapping, if
  needed, lives there too. Finalize shape in the plan.

## Out of scope / residual unknowns

- **Not verified against a live Unraid box** — all semantics from static reads of
  `unraid/api@264ddf0` (v4.35.0, a moving branch) + the vendored SDL.
- **Subscriptions** (`notificationAdded`, `notificationsOverview`,
  `notificationsWarningsAndAlerts`) — deferred (no subscription transport yet).
- **Known server quirks we surface but cannot fix** (PR notes): the overview cache
  race (finding #2); bulk silently swallows bad ids (#4); dual-write wrong-`type`
  delete (#5); recalculate double-counts dual-writes (#2); list `importance`+`limit`
  under-return (#8); birthtime-vs-content-timestamp ordering (#8); `createNotification`
  returned-id may not match on-disk (#7); `notifyIfUnique` dedup false-negative on
  HTML-entity / interior-whitespace differences (#6, never a spurious null).
- **External legacy `notify` script** filename scheme and chokidar polling latency are
  environment-dependent and unread from source.
- No notification settings / SMTP / agent configuration.

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, codegen idempotency
(`npm run generate` no-diff), and an independent stdio `initialize → tools/list` smoke
(via the MCP SDK client) confirming all 7 tools register with the correct annotations
(reads `readOnlyHint:true`; `notification_delete` `destructiveHint:true`; the other
three writes `destructiveHint:false`).
