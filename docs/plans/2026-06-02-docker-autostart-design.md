# better-unraid-mcp — Docker Autostart Tool Design (PR #3.5)

**Date:** 2026-06-02
**Author:** Matt White (mswdev)
**Status:** Approved — ready for implementation planning
**Branch:** `feature/docker-autostart` → draft PR into `develop`

## Goal

Ship `docker_autostart_set`, the autostart mutation deliberately **deferred from
PR #3** because the underlying `updateAutostartConfiguration` is **REPLACE-all**,
not merge. A naive partial call silently drops every unlisted container's
autostart. This tool is therefore the domain's first (and only) **read-modify-
write** tool: it reads the current autostart config, merges the requested
change(s), and resubmits the complete, correctly-ordered set so unlisted
containers are untouched. It is the 4th gated Docker mutation.

## Validated semantics (source-read, not live-verified)

A focused source-validation pass over `unraid/api` confirmed (each claim
independently re-checked) — see [[reference-unraid-docker-api]]:

- **Faithful round-trip.** The read (`Query.docker.containers` →
  `transformContainer`/`getAutoStartEntry`) and the write share **one** backing
  file `/var/lib/docker/unraid-autostart` via `DockerAutostartService`. So
  reading `{autoStart, autoStartWait}` and resubmitting them is a faithful,
  idempotent round-trip. `autoStart` and `autoStartWait` map 1:1.
- **Ordering is positional and load-bearing.** `autoStartOrder` is the file line
  index, **not** a writable input field (`DockerAutostartEntryInput` is exactly
  `{id, autoStart, wait?}`); the write derives order from the entries-array
  index. `Docker.containers` returns **Docker daemon listing order, not autostart
  order**. ⇒ the snapshot MUST be **sorted by read-back `autoStartOrder`
  ascending** before submit, or boot order is scrambled (functional: DB before
  dependent app).
- **`persistUserPreferences:true` is destructive to WebGUI order.** It rewrites
  flash `userprefs.cfg` for **all** submitted entries in **submitted order**, and
  **nothing reads `userprefs.cfg` back** (write-only) — so the existing WebGUI
  display order cannot be preserved, and an `autoStartOrder`-sorted snapshot
  (non-autostart containers, null order, dumped to one end) would irreversibly
  reorder the Docker page. ⇒ default `persist` **false**; expose `true` only as a
  loud opt-in.
- **Feature flag.** `updateAutostartConfiguration` is behind
  `@UseFeatureFlag('ENABLE_NEXT_DOCKER_RELEASE')`, which **omits the field from
  the schema** when off. The read can work while the write does not exist, so on
  an older/non-flagged server the mutation errors — surface a clear capability
  message, not a generic GraphQL field error.

## Decisions

- **Tool API:** `docker_autostart_set(changes, persist?, confirm, response_format)`.
  - `changes`: non-empty array of `{ id: string, auto_start: boolean, wait?: int >= 0 }`.
    Omitting `wait` preserves the container's current wait.
  - `persist`: boolean, **default false** (opt-in `true`, loudly warned).
  - `confirm`: required `true` (gated mutation, like the PR #3 mutations).
- **Merge-safe, full-snapshot, sorted.** Build the snapshot strictly from the
  read-back container set (never fabricate names); sort by `autoStartOrder`.
- **No reordering feature in v1** (YAGNI): the tool preserves current order; it
  does not expose a way to change boot order.

## Tool

`readOnlyHint:false, destructiveHint:true, openWorldHint:false`; gated by
`confirm:true`.

**Description:** "Sets which containers auto-start on boot. Merge-safe: reads the
current autostart config, applies your changes, and resubmits the complete set
(sorted to preserve boot order) so unlisted containers are untouched. Boot-time
only — does not start/stop running containers now; takes effect on the next
array/Docker start. `persist:true` also writes the WebGUI's saved prefs but
⚠ reorders the Docker-page container list irreversibly — leave it false unless
you want that. Requires `confirm:true`. Needs Unraid OS 7.3+
(ENABLE_NEXT_DOCKER_RELEASE)."

## Behavior

1. `requireConfirmation(confirm, …)` — returns the refusal **before** any
   `client.execute`.
2. Read all containers (`DockerAutostartState`).
3. Validate `changes` against the read set: reject **duplicate ids** and
   **unknown ids** (ids not present), with an explicit message, **before** the
   mutation.
4. Merge into a full snapshot of every container:
   `autoStart = change?.auto_start ?? current.autoStart`;
   `wait = change?.wait ?? current.autoStartWait`.
5. **Sort the snapshot by `autoStartOrder` ascending, nulls last (stable).**
6. Submit `DockerSetAutostart(entries, persistUserPreferences: persist)`.
7. Format the response.

## GraphQL operations (2)

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

(`data.docker.updateAutostartConfiguration` is a `Boolean`.)

## Output

- **Concise:** the requested changes by slash-stripped name, e.g.
  `Autostart updated: plex ON (wait 30s), sonarr OFF — autostart file only;
  effective next array/Docker start.` (note "persisted to WebGUI prefs" when
  `persist:true`).
- **Detailed:** `{ ok: boolean, persisted: boolean, changes: [{id, name, autoStart, wait}] }`.

## Error handling

`try/catch → toolError`. The read and mutation are two `execute` calls; a read
failure errors before any mutation. Validation errors (unknown/duplicate ids)
return `toolError` after the read, before the mutation. A non-flagged server
surfaces the mutation's GraphQL error via `toolError` (copy notes the 7.3+/flag
requirement).

## Testing

This tool carries the **heaviest tests in the domain**, as promised at deferral.

**New shared test helper — `sequencedExecutor`** (`src/tools/_shared/test-support.ts`):
this is the first handler making **two** `execute` calls, so the single-result
`recordingExecutor` cannot serve a containers-query result *and* a mutation
result each `satisfies`-typed. `sequencedExecutor([readResult, mutationResult])`
returns results in call order and records all calls.

Cases:
- **gate-not-called**: no `confirm` → `isError`, executor never called.
- **merge correctness** (the meaty one): a single change leaves every other
  container's `autoStart`/`wait` intact; the submitted `entries` (`calls[1].variables`)
  contain **all** containers, correctly flagged, **sorted by `autoStartOrder`**.
- **unknown id** → `isError` listing the id, and the **mutation is never called**
  (`calls.length === 1`, only the `DockerAutostartState` read).
- **duplicate id in `changes`** → `isError`, no mutation.
- **`wait`**: provided wait is submitted; omitted wait preserves current.
- **order preservation**: containers whose `autoStartOrder` differs from daemon
  order are submitted in `autoStartOrder` order.
- **`persist`**: default `false` passes `persistUserPreferences: false`; `true`
  passes through (concise notes the WebGUI write).
- **concise/detailed** output.
- **error paths**: read throws; mutation throws.

`satisfies DockerAutostartStateQuery` / `DockerSetAutostartMutation` fixtures so
codegen drift breaks the build (via the call-site `satisfies` clause).

## Placement

```
src/tools/docker/
  autostart-set.{ts,graphql,test.ts}   # new (docker/ → 9 source .ts, under the 10 cap)
src/tools/_shared/test-support.ts      # + sequencedExecutor
src/tools/registry.ts                  # registers docker_autostart_set
src/types/unraid/graphql.ts            # regenerated (2 new operations)
README.md                              # promote autostart from "planned" to shipped
```

## Out of scope / residual unknowns

- **Not verified against a live Unraid box.** All semantics are from static reads
  of `unraid/api@main` (a moving branch); pin/re-verify against the server's API
  version.
- No boot-order **reordering** feature (v1 preserves current order only).
- No introspection **capability probe** for the feature flag (graceful error +
  docs instead).
- Orphan autostart entries (a stale name with no listed container) are dropped by
  the REPLACE-all write; `getRawContainers` defaults `all=true` so this is rare,
  but not eliminable.

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, codegen
idempotency (`npm run generate` no-diff), and an independent stdio `tools/list`
smoke confirming `docker_autostart_set` registers with `destructiveHint:true`.
