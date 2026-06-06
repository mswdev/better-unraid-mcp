# better-unraid-mcp — Array & Parity Control Design (PR #7)

**Date:** 2026-06-06
**Author:** Matt White (mswdev)
**Status:** Implemented — see docs/plans/2026-06-06-array-parity-tools.md
**Branch:** `feature/array-tools` → draft PR into `develop` (PR #6 unmerged at branch time; only
overlap is `src/tools/registry.ts` — trivial merge)

## Goal

Complete the array domain's operational control: the reads (`array_status`,
`parity_history`, `disk_list`) shipped in PR #2; this PR adds the writes —
array power (`Mutation.array.setState`) and parity-job control
(`Mutation.parityCheck.start/pause/resume/cancel`). Reuses every established
convention — the `GraphQLExecutor` seam, per-tool `.graphql` operation files,
vendored-SDL + graphql-codegen pipeline, and the `_shared` helpers
(`respond.ts` `formatResponse`, `confirm.ts` `requireConfirmation`,
`test-support.ts` fakes).

The surface is **5 mutations** consolidated into **2 tools**, split by concern:
array power vs the parity job. `correct` is only meaningful for parity start,
and the two tools' GraphQL contracts differ (typed `UnraidArray!` return vs
opaque `JSON!`), so a single mega-tool would couple incompatible shapes.

## Validated semantics (source-read, NOT live-verified)

A focused source-validation Workflow over `unraid/api` (`main` @ `264ddf0`,
v4.35.0 — the same pin as PR #6's validation) — 8 questions, each independently
re-checked by an adversarial verifier, plus a completeness critic whose two new
load-bearing claims were then spot-verified first-hand. **Nothing in this repo
is live-verified against a real Unraid box**; flagged here and in the PR.
Findings (file:line in `api/src/`):

1. **`setState` returns the PRE-mutation state — never report it as the
   result.** `updateArrayState` awaits one `emcmd` HTTP call to the emhttpd
   unix socket, then returns `getArrayData()` with **no store reload in
   between** (`unraid-api/graph/resolvers/array/array.service.ts:177→183`).
   `getArrayData` reads `state: emhttp.var.mdState` straight from the Redux
   store (`core/modules/array/get-array-data.ts:107`), which refreshes only
   **out-of-band** via the chokidar StateManager watching `var.ini`
   (`store/watch/state-watch.ts:61-67,100-102`). Whether emcmd→emhttpd itself
   blocks until the array settles is emhttpd-side and unknowable from this
   repo; either way the returned state is racy and typically the OLD state
   (`array_action start` on a stopped array would "return" STOPPED). The spec
   file mocks the target state — test-authored fiction, not evidence.

2. **`setState` is NOT idempotent; error states fake the no-op message.**
   START-while-STARTED / STOP-while-STOPPED throw
   `BadRequestException(AppError("The array is already STARTED|STOPPED"))`
   before emcmd is ever called (`array.service.ts:148-153`; `arrayIsRunning()`
   at `:112-116` checks `mdState === STARTED`). A concurrent change throws
   `"Array state is still being updated..."` (`:134-138`, `pendingState`
   guard). **Because `isRunning` is true only for STARTED, every error state
   (NEW_ARRAY, TOO_MANY_MISSING_DISKS, …) is treated as not-running: STOP in
   an error state throws the MISLEADING `"The array is already STOPPED"`**,
   and START in an error state passes the guard and is forwarded blindly to
   emhttpd (accept/reject OS-side, unknowable; a daemon rejection surfaces as
   a thrown `Error` carrying the response body).

3. **STOP is a blind passthrough; the blast radius is real but emhttpd
   performs it.** No API-side check, refusal, or orchestration regarding
   Docker/VMs/mover anywhere in the STOP path — `updateArrayState` builds
   `{ cmdStop: 'Stop', startState: 'STARTED' }` and POSTs it
   (`array.service.ts:157,177`; `emcmd.ts:115-122`). Gate copy must attribute
   the effect to Unraid ("Unraid will take all shares, Docker containers, and
   VMs offline"), not imply the tool or API orchestrates it gracefully.

4. **The parity `JSON!` payload is a stale parity-HISTORY array — identical
   for all four actions; nothing load-bearing inside.** Every resolver
   delegates to `updateParityCheck`, which fires `emcmd` (return value
   discarded) then `return this.getParityHistory()`
   (`parity.service.ts:103-115`) — the history FILE re-read, not the action's
   status. Never parse it.

5. **Failure surfaces only as thrown `errors[]` — but a throw can happen
   AFTER the command fired, and "no error" does not prove effect.**
   - Parity throw taxonomy (all land in `errors[]`): (a) `"Invalid parity
     check state: <action>"` — API guard, action did NOT fire (e.g. `start`
     while `mdResync !== 0`, `parity.service.ts:87-98`); (b) `"Failed to
     update parity check: ..."` — emcmd failure (`:104-113`); (c) `"Parity
     history file not found: <path>"` — a plain Error from the post-emcmd
     history read (`:19-21`), i.e. the action ALREADY fired; treating it as an
     action failure would be false.
   - `setState`'s analogue: `getArrayData` throws
     `GraphQLError("Attempt to get Array Data, but state was not loaded")`
     (`get-array-data.ts:63-68`) on the post-emcmd return path — same
     fired-but-read-failed shape.
   - **Silent no-ops:** pause/resume/cancel with no check running, and start
     while the array is STOPPED, have NO API guard — the payload hardcodes
     `startState: 'STARTED'` and emhttpd decides; an empty-body 200 reads as
     success with zero effect (emhttpd-delegated, unknowable). Copy must say
     "requested", never "done".

6. **`correct: true|false` maps to the UI checkbox; no extra upstream
   guard.** `correct && wantedState === 'start'` adds `optionCorrect:
   'correct'` to the emcmd body; otherwise omitted (`parity.service.ts:99-106`).
   The flag is a required Boolean upstream; no API-side warning distinguishes
   correcting from read-only checks. Confirm-only gate stands.

7. **`parityCheckStatus` is computed from the SAME racy store, and its
   `running`/`correcting`/`paused`/`errors` fields are NEVER populated.**
   Verified first-hand: `getParityCheckStatus` returns only
   `{ status, speed, date, duration, progress }`
   (`core/modules/array/parity-check-status.ts`); the RUNNING/PAUSED
   distinction lives in the **status enum** (`mdResyncPos > 0` +
   `mdResyncDt`). A follow-up read right after a mutation has no
   happens-before vs the emcmd POST and commonly returns pre-mutation status.
   ⇒ no follow-up read can confirm anything; and the already-shipped
   `array_status` selection of `running`/`paused`/`errors` yields nulls from
   this resolver (its "0 errors" summary line is misleading mid-check).

8. **RBAC: all five mutations require an ADMIN-role key.** `@UsePermissions(
   UPDATE_ANY, ARRAY)` on `setState` and all four parity fields; no feature
   flags (the VM model, not the notification default-allow model). VIEWER /
   GUEST keys fail via the global casbin AuthZGuard → ForbiddenException in
   `errors[]` (default message "Forbidden resource", **may be Apollo-masked in
   production — branch on error presence, never exact text**). Missing/bad key
   → UnauthorizedException "User not found".

9. **Subscriptions are not a completion signal (and stay out of scope).** The
   ARRAY pubsub publishes only from the `disks` state-file branch, debounced
   5s, diff-gated — `var.ini` transitions piggyback on the next disks.ini
   event, which may never come after STOP (disk I/O ceases). No publisher for
   `parityHistorySubscription` was found at all. Pointing callers at
   `array_status` is the reliable path.

10. **Encrypted arrays:** `ArrayStateInput` also carries `decryptionPassword`
    / `decryptionKeyfile`; START with a keyfile writes it to disk server-side
    (`array.service.ts:94-106`). v1 does NOT expose these (no secret channel
    through MCP tool input); an encrypted array's start will be refused by
    emhttpd — **stated in the tool description** (use the web UI).

11. **Upstream marks ParityCheckMutations "WIP, response types and
    functionaliy will change"** (`mutation.model.ts:45-48`). Behavior here is
    pinned to v4.35.0; the vendored-SDL + codegen pipeline (`npm run
    schema:update` + idempotency check) is the drift detector.

## Tools

Both tools are **1-call: gate → mutation → report-action-and-point** (the
`docker_autostart_set` precedent). Validation killed both richer options: the
mutation returns can't prove the result (findings 1, 4) and no pre- or
post-read can either (finding 7 — same un-reloaded store; finding 9 — no
usable subscription). There is no target to resolve (one array, one parity
job), so `vm_action`'s resolve-read precedent does not apply. Success copy
always says **"requested"** + "run `array_status` to confirm; state reads may
lag a few seconds" — never "done" (finding 5's silent no-ops).

### `array_action` — array power control

```
array_action { action: "start" | "stop", confirm?, acknowledge_risk?, response_format }
```

- Maps lowercase `start|stop` → SDL `ArrayStateInputState.START|STOP` via a
  small tested map (the lowercase-enum convention).
- One GraphQL call: `array { setState(input: { desiredState: $state }) { id state } }`.
  Minimal selection; the returned `state` is **never** surfaced as the result
  (finding 1). The `detailed` payload may echo it labeled
  `preMutationState` — explicitly named for what it is.
- Error mapping (catch on `UnraidApiError`, best-effort message matching with
  an honest fallback — messages may be Apollo-masked):
  - `"The array is already STARTED"` / `"already STOPPED"` → **benign no-op
    result** (not an error). Copy hedges the error-state lie (finding 2):
    "Unraid reports the array is already stopped — or it is in a state where
    stop does not apply (run `array_status` to see the actual state)."
  - `"Array state is still being updated"` → transient: another state change
    is in flight; retry shortly.
  - `"Attempt to get Array Data, but state was not loaded"` → the command
    already FIRED (finding 5): report "start/stop was issued but the API
    could not read back the array state — run `array_status`", not failure.
  - Anything else → failure with the message, no key material echoed.
- Description states: ADMIN-role API key required; encrypted arrays cannot be
  started via this tool (use the web UI); stop's effect is performed by
  Unraid (shares/Docker/VMs go offline).

### `parity_check` — parity job control

```
parity_check { action: "start" | "pause" | "resume" | "cancel", correct?, confirm?, response_format }
```

- Four per-action mutation documents (switch dispatch, like
  `vm_action.runAction`): `parityCheck.start(correct: $correct)`, `.pause`,
  `.resume`, `.cancel`.
- `correct` (default `false`) is **only valid with `action: "start"`** —
  supplying it with any other action returns a clear validation error before
  any GraphQL call. Never silently ignored. `correct: true` = the UI's "Write
  corrections to parity" (finding 6).
- The `JSON!` return is **never parsed** (finding 4). Success = the call
  returned; copy reports the action as requested and points to
  `array_status` (whose `status` enum carries RUNNING/PAUSED — finding 7).
- Error mapping (same best-effort matching + fallback):
  - `"Invalid parity check state: <action>"` → real refusal, action did not
    fire (e.g. start while a check is running) → failure with that reason.
  - `"Failed to update parity check"` → emcmd failure → failure.
  - `"Parity history file not found"` → the command already FIRED
    (finding 5): report requested-but-unverified, point to `array_status`.
  - Anything else → failure with the message.
- Description states: ADMIN-role API key required; pause/resume/cancel with
  no check running may be silently accepted with no effect (emhttpd decides);
  upstream marks this mutation group WIP (behavior pinned to v4.35.0).

### `array_status` adjustments (shipped tool, small diff)

- Add `speed` to the `parityCheckStatus` selection (populated; MB/s as a
  string). Do NOT add `correcting` — never populated at v4.35.0 (finding 7).
- Fix the summary's misleading errors clause: `errors` is always null from
  this resolver, so stop asserting "0 errors". When a check is RUNNING /
  PAUSED, report progress + speed; surface error counts only where they exist
  (`parity_history`, whose file-sourced records do carry `errors`).
- The dead `running`/`paused`/`errors` selections stay (upstream-WIP type may
  populate them later; the null-guarded code already tolerates them).
- No dedicated `parity_status` tool: redundant with `array_status`.

## Gate policy

Stopping the array is the single most consequential operation in this server —
**Unraid takes every share, Docker container, and VM offline** (finding 3: the
effect is real; emhttpd performs it; the API does not pre-check or refuse).
But it is graceful and reversible (`start` brings it back): the risk axis is
**blast radius**, not corruption. `vm_action`'s `acknowledge_risk` copy ("can
corrupt the guest filesystem") would be a false statement here — the two-tier
*mechanism* is reused, the *copy* is op-specific and attributes the effect to
Unraid.

| Op | Gate | Rationale |
|----|------|-----------|
| `array_action stop` | `confirm` + `acknowledge_risk` (one combined refusal naming both) | Blast radius: Unraid takes all shares, containers, and VMs offline |
| `array_action start` | `confirm` only | Restores service; reversible |
| `parity_check` all actions | `confirm` only | Correcting checks are routine maintenance (the UI checkbox, finding 6); pause/resume/cancel are job control |

Annotations for both tools: `readOnlyHint: false, destructiveHint: true,
openWorldHint: false` (gated mutations; stop removes availability, cancel
discards an in-progress check, correct writes to parity).

## Scope

**In:** `array_action`, `parity_check`, the `array_status` adjustments above,
registry wiring, README rows.

**Deferred (explicitly out):**
- Disk-level array ops (`addDiskToArray`, `removeDiskFromArray`,
  `mountArrayDisk`, `unmountArrayDisk`, `clearArrayDiskStatistics`) — they
  require a stopped array and carry hardware risk; `array_action` is their
  prerequisite. Later PR. The two tools send ONLY their own fields — no
  sibling mutations leak through the namespaces.
- Encrypted-array start (`decryptionPassword`/`decryptionKeyfile`) — no
  secret channel through MCP tool input in v1 (finding 10); limitation stated
  in `array_action`'s description.
- `arraySubscription` / `parityHistorySubscription` — no subscription
  transport, and finding 9 shows they could not serve as completion signals
  anyway.
- Dedicated `parity_status` read — redundant with `array_status`.

**Files:** `src/tools/array/{array-action,parity-check}.{ts,graphql,test.ts}`,
widened `src/tools/array/array-status.graphql` + summary tweak in
`array-status.ts` (+ its test), regenerated `src/types/unraid/graphql.ts` via
`npm run generate`. The `array/` directory lands at 4 source files — under
the 10-file cap.

## Error handling

- Gate refusals return `toolError` with "No changes were made." before any
  GraphQL call (stop's combined refusal names both flags, mirroring
  `vm_action`).
- `correct` outside `start` → `toolError` validation message, no call.
- The taxonomies above map known v4.35.0 messages; the fallback for unknown /
  masked messages is an honest failure report carrying the message and
  pointing to `array_status`. Branch on error presence, never require exact
  text (finding 8's masking caveat).
- RBAC failures (ForbiddenException / "User not found") surface through the
  same catch; descriptions pre-warn about the ADMIN-key requirement. Never
  echo key material.

## Testing

Hermetic, no network — `_shared/test-support.ts` fakes:
- Gate refusal paths: missing `confirm` (both tools), stop missing
  `acknowledge_risk` (and the combined-refusal copy), gates checked before
  any executor call (`recordingExecutor` sees zero calls).
- `correct`-with-non-start rejection; `correct` default false; `correct:
  true` forwarded to the start document's variables.
- Enum map start/stop → START/STOP (tested map per convention).
- Success copy says "requested" + points to `array_status` (both tools);
  never claims completion; `detailed` labels the echoed setState state
  `preMutationState`.
- Error-mapping table tests pinned to the v4.35.0 message forms: benign no-op
  ("already STARTED/STOPPED" — hedged copy), transient ("still being
  updated"), fired-but-read-failed ("state was not loaded" / "Parity history
  file not found" → requested-but-unverified, NOT failure), guard refusal
  ("Invalid parity check state"), emcmd failure, and the unknown-message
  fallback.
- Error paths via `throwingExecutor`/`rejectingExecutor` pinned to the
  wrapped message form.
- `array_status`: `speed` rendered; summary no longer asserts "0 errors" when
  `errors` is null; RUNNING/PAUSED render progress + speed.
- Both response formats; registration + annotation assertions; fixtures typed
  `satisfies <Op>Mutation/Query` against codegen output.
