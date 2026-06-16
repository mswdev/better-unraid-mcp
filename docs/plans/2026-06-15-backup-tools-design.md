# Backup Domain Tools — Design (PR #9) — ⛔ DEFERRED

**Date:** 2026-06-15
**Branch:** investigated on `feature/backup-tools`; PR #9 pivoted to the **plugins** domain
**Status:** **DEFERRED after source-validation (revision 1)** — the backup domain is
non-functional at v4.35.0 *and* current `main`. The design below is preserved as the
record of what was scoped before validation killed it.
**Validation pin:** unraid/api @ `264ddf0` (v4.35.0), re-checked on `main` @ `6f94aa1`
(2026-06-14) — source-validated only, **NOT live-verified**

## Validation outcome — DEFERRED (read this first)

Source-validation (7-area Workflow + adversarial verify + completeness critic, then
direct re-read of the decisive files) found **no working surface to ship** at this API
version. Two PR-killers, both confirmed identical at the pin and on current `main`:

1. **`initiateFlashBackup` is an unimplemented stub.** `flash-backup.resolver.ts:22`
   is literally `throw new Error('Not implemented')` — no logic, no `@UsePermissions`.
   No `jobId` poll field exists anywhere; no `FLASH_BACKUP` feature flag exists.
2. **rclone is OFF by default in production.** `rclone-api.service.ts`
   `onApplicationBootstrap` early-returns when `ENVIRONMENT === 'production'` (the
   default), leaving `rcloneBaseUrl=''`. On a stock box: `rclone { remotes }` *catches
   the error and returns `[]`* (silent — indistinguishable from "no remotes
   configured", which would mislead the model); `create/deleteRCloneRemote` throw a
   transport error regardless of remote existence. The tools only function on a
   non-production (staging/dev) deployment with rclone installed.

**Decision:** defer the entire backup domain (blocked on upstream implementing the
flash-backup resolver; rclone half not worth shipping for stock-production users).
PR #9 pivots to the **plugins** domain. Validated facts retained for a future revisit
are captured in the project memory (`reference-unraid-backup-api`).

Two design calls were nonetheless *vindicated* by validation, and should carry forward
to any future backup PR: **read-secrecy = name+type only** (both `parameters` and
`config` are verbatim unredacted credential passthrough), and **defer
`createRCloneRemote`** (every completeness-critic gap was create-path-only).

---

## Goal (original — not built)

Cover the top backup admin task: the flash device holds the entire server
config, and rclone remotes are where it gets shipped off-box. Three tools over
the Unraid GraphQL backup surface — two reads/ops plus one outward-egress write:

| Tool | Root | Purpose |
|------|------|---------|
| `rclone_remote_list` | `Query.rclone.remotes` | Enumerate configured rclone remotes (name, type — **no credentials**) |
| `rclone_remote_delete` | `Mutation.rclone.deleteRCloneRemote` | Remove a remote by name (confirm-gated) |
| `flash_backup` | `Mutation.initiateFlashBackup` | Initiate a flash-config backup to a remote (confirm-gated, report-and-point) |

## Decisions (settled in brainstorming; revise after source validation)

This PR's thesis is **no exfiltration primitives**. Four surfaces in the rclone
schema could each leak data off-box; each is closed client-side by default,
independent of upstream behavior (source-validation refines, doesn't gate).

1. **Read secrecy — name+type only.** `RCloneRemote` exposes
   `parameters: JSON!` and `config: JSON!` ("Complete remote configuration"),
   which hold cloud access keys / OAuth tokens / obscured-but-revealable
   passwords. `rclone_remote_list`'s operation selects **`name` and `type`
   only** — `parameters`/`config` never appear in the query string, so no
   credential ever enters model context. name+type is enough to enumerate
   remotes and reference one by name in `flash_backup`/`delete`. Holds whether
   or not upstream redacts (source-validation checks). *Source-validation item:
   confirm `parameters`/`config` are credential-bearing and whether upstream
   redacts at the resolver.*

2. **`sourcePath` — pinned, not exposed.** Upstream `sourcePath` is a bare
   `String!` documented "typically the flash drive." Exposed, it would make
   `flash_backup` an rclone-copy-any-local-path-to-cloud primitive (sharper than
   `log_read` — egress, not just disclosure). Stance: **do not expose
   `sourcePath`**; pin it to a `FLASH_SOURCE_PATH` constant. The mutation's
   intent *is* flash backup (one legitimate source), so pinning is alignment,
   not limitation. An allowlist (log_read-style) doesn't fit — there is no
   "valid source paths" query to build one from. **Value `"/boot"` is
   PROVISIONAL** (the `Flash` type carries no mount-path field; `/boot` is
   Unraid convention). *Source-validation item (correctness, not only security):
   what `sourcePath` does the official flash-backup feature actually send? Pin
   to that. Wrong value → the mutation simply fails.*

3. **`options` — typed allowlist, not raw JSON.** Upstream `options` is
   `JSON?` ("--dry-run or --transfers"). Forwarding arbitrary JSON to rclone is
   a flag/shell-injection surface depending on how the resolver consumes it (a
   `--config`/`--files-from`/filter flag could change what is read or where it
   writes). Stance: replace raw JSON with a **typed, validated allowlist** —
   `dry_run: boolean`, `transfers: number (int)`, `bwlimit: string`. Keeps the
   genuinely-useful `--dry-run` preview; converts trust-client-JSON into a
   checked surface, per the project's no-unknown-passthrough rule. The tool
   assembles these into the `options` JSON; nothing else passes through.
   *Source-validation item: how does the resolver consume `options` (command
   string vs argv array)? Confirm none of the three chosen keys is itself a
   redirect vector.*

4. **`createRCloneRemote` — deferred.** Creating a remote requires passing
   cloud credentials *through the model* as `parameters: JSON!` — the same
   exposure refused on reads (#1). Remote setup is a one-time task served by the
   Unraid UI's guided config form. Ship list + delete + backup; revisit create
   on demand.

5. **`flash_info` — deferred.** `Query.flash { guid, vendor, product }` is the
   thing being backed up, but `flash_backup` pins its own source so nothing
   needs it (YAGNI). `guid` is license-tied (semi-sensitive). If added later:
   `guid` detailed-mode-only or masked, never concise default.

6. **Confirm gates.** `rclone_remote_delete` and `flash_backup` are both
   `requireConfirmation`-gated (single-tier; no execute call until
   `confirm: true`). `flash_backup`'s confirm copy states explicitly that it
   ships the **full flash config off-box** to the named remote.

7. **`flash_backup` is report-and-point.** `initiateFlashBackup` returns
   `FlashBackupStatus { status: String!, jobId: String }`. Per
   [[lesson-unraid-mutations-racy-snapshot]] the tool reports `status` + `jobId`
   and **never claims the backup completed** — `status` reflects *initiation*.
   It points the caller to where progress can be checked. *Source-validation
   item: is the backup synchronous or a job? What does `jobId` map to, and is
   there ANY query to poll it? What does `status` actually report (initiation vs
   completion)?*

8. **Out of scope:** `createRCloneRemote`, `rclone.drives` + `configForm` (only
   needed for the deferred create), `flash_info`, plugins / UPS / Connect /
   settings writes (later PRs).

## Tool designs

### `rclone_remote_list` (read-only)

- **Input:** `response_format: "concise" | "detailed"` (default `concise`).
- **Operation:** `query { rclone { remotes { name type } } }` — selection set is
  the security control; secrets are structurally absent.
- **Output:** concise = remote count + comma-joined names; detailed = name→type
  lines. (Difference is intentionally small — name+type is all we carry.)
- **Annotations:** `readOnlyHint: true, destructiveHint: false, openWorldHint: false`.
- **rclone-absent:** clear "rclone not available" message, not a raw GraphQL
  throw. *Source-validation item: does rclone run by default or behind a feature
  flag / socket availability? What is the error shape when rclone is absent?*

### `rclone_remote_delete` (destructive, confirm-gated)

- **Input:** `name: string (min 1)`, `confirm: boolean`.
- **Gate:** `requireConfirmation(confirm, 'delete rclone remote "<name>"')` →
  returns refusal before any `execute` when not confirmed.
- **Operation:** `mutation { rclone { deleteRCloneRemote(input: { name }) } }`.
- **Output:** reports the requested deletion (mirrors `notification_delete`).
- **Annotations:** `readOnlyHint: false, destructiveHint: true, openWorldHint: false`.
- *Source-validation item: idempotency (error on unknown name?), and what
  `Boolean!` means — true-or-throw like the VM mutations, or true/false?*

### `flash_backup` (state-changing + outward egress, confirm-gated)

- **Input:** `remoteName: string (min 1)`, `destinationPath: string (min 1)`,
  `options?: { dry_run?: boolean, transfers?: number(int>0), bwlimit?: string }`,
  `confirm: boolean`.
- **Pinned:** `sourcePath = FLASH_SOURCE_PATH` (provisional `"/boot"`).
- **Gate:** `requireConfirmation` with copy naming the off-box egress.
- **Operation:** `mutation { initiateFlashBackup(input: { remoteName, sourcePath,
  destinationPath, options }) { status jobId } }`. Typed options assembled into
  the `options` JSON client-side.
- **Output:** report-and-point — `status` + `jobId` (when present) + an explicit
  "initiated, not confirmed complete" note pointing to where to verify.
- **Annotations:** `readOnlyHint: false, destructiveHint: false,
  openWorldHint: true` (reaches an external cloud remote).

## Architecture

- **Directory:** new independent domain `src/tools/backup/`. Source files:
  `rclone-remote-list.ts`, `rclone-remote-delete.ts`, `flash-backup.ts`
  (3 `.ts`; colocated `.graphql` + `.test.ts` don't count) — under the 10-file
  cap. No imports across sibling domains.
- **Shared reuse:** `GraphQLExecutor` seam; `_shared/confirm.ts`
  (`requireConfirmation`); `_shared/respond.ts` (`formatResponse`, `toolError`,
  `ResponseFormat`). `FLASH_SOURCE_PATH` lives as a module constant in
  `flash-backup.ts` (single use).
- **Codegen:** per-tool `.graphql` operation files; `npm run generate` produces
  the single committed `src/types/unraid/graphql.ts`. Scalars per convention
  (JSON→unknown, PrefixedID→string). Codegen idempotency verified in the build.
- **Registry:** each tool gets a `register*` export with `@returns` JSDoc;
  wired in `src/tools/registry.ts` (+ `registry.test.ts` count/name assertions)
  — a trivial union-merge with `develop`. README documents the three tools.

## Error handling

- All handlers wrap `execute` in try/catch → `toolError("Failed to … : <msg>")`;
  the client throws `UnraidApiError` (joined `errors[]`) and partial data is
  discarded, so a thrown error is the only failure signal — schema nullability is
  **not** a degradation path.
- Never include `UNRAID_API_KEY` or any credential in output/errors (security
  rule). `rclone_remote_list` cannot leak secrets it never selected.
- rclone-absent (read) and unknown-remote (delete) get specific messages once
  source-validation pins their error shapes.

## Testing

Hermetic, `satisfies Query/Mutation` fixtures, hand-written fakes from
`_shared/test-support.ts`. Per tool:

- **`rclone_remote_list`:** success (concise + detailed), empty-remotes, and an
  assertion via `recordingExecutor` that the **sent document selects only
  `name`/`type`** (secrets structurally absent); rclone-absent error path
  (`rejectingExecutor`).
- **`rclone_remote_delete`:** confirm gate refuses with **no execute call**
  (recording fake sees zero calls); success path; error/unknown-name path.
- **`flash_backup`:** confirm gate (no execute when unconfirmed);
  `recordingExecutor` asserts `variables.input.sourcePath === FLASH_SOURCE_PATH`
  and that typed options assemble correctly; report-and-point output asserts it
  surfaces `status`+`jobId` and makes **no completion claim**; error path.

## Source-validation TODO (reconcile into a "Validated findings" section)

Focused Workflow over `unraid/api @ 264ddf0`, adversarial verify per assumption
+ completeness critic. Resolvers located:
`api/src/unraid-api/graph/resolvers/rclone/*` and `.../flash-backup/*`.

1. **rclone:** where `remotes`/`parameters`/`config` come from (rclone.conf vs
   `rclone rcd` API); is anything redacted at the resolver; does rclone run by
   default or behind a feature flag / socket availability; error mode when
   rclone is absent.
2. **initiateFlashBackup:** the real `sourcePath` the official feature sends
   (verify `/boot`); `sourcePath`/`destinationPath` validation; sync vs job
   semantics; what `jobId` maps to and whether any query can poll it; what
   `status` reports (initiation vs completion); how `options` JSON is consumed
   (injection surface); RBAC (`@UsePermissions` resource/action) + feature flags
   (`FLASH_BACKUP`?); how an under-privileged key fails.
3. **deleteRCloneRemote:** idempotency, error on unknown name, what `Boolean!`
   actually means (true-or-throw like VM?), RBAC.

## Release gate

Source-validated against `unraid/api @ 264ddf0` (v4.35.0). **NOT live-verified
against a real Unraid box** — flagged in the PR body, consistent with PRs #1–#8.
