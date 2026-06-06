# better-unraid-mcp — Array & Parity Control Design (PR #7)

**Date:** 2026-06-06
**Author:** Matt White (mswdev)
**Status:** Approved — source validation PENDING (§Validated semantics is hypotheses until reconciled)
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
and the two tools' result-reporting contracts differ (typed `UnraidArray!`
return vs opaque `JSON!`), so a single mega-tool would couple incompatible
shapes.

## Tools

### `array_action` — array power control

```
array_action { action: "start" | "stop", confirm?, acknowledge_risk?, response_format }
```

- Maps lowercase `start|stop` → SDL `ArrayStateInputState.START|STOP` via a small
  tested map (the lowercase-enum convention).
- Single GraphQL call: `array { setState(input: { desiredState: $state }) { ... } }`.
  No target resolution (there is exactly one array), so no pre-read — a 1-call
  handler, unlike `vm_action`'s resolve.
- `setState` returns the full typed `UnraidArray!`; the handler reports the
  **resulting `array.state`** directly (the autostart/notification lesson: report
  resulting state, not a bare "done"). `ArrayState` has 11 values — the result can
  be any of them, not just STARTED/STOPPED; the summary prints whatever came back.
  *(Pending validation #1: if the returned state is transient rather than settled,
  fall back to report-and-point-at-`array_status`.)*

### `parity_check` — parity job control

```
parity_check { action: "start" | "pause" | "resume" | "cancel", correct?, confirm?, response_format }
```

- Four per-action mutation documents (switch dispatch, like `vm_action.runAction`):
  `parityCheck.start(correct: $correct)`, `.pause`, `.resume`, `.cancel`.
- `correct` (default `false`) is **only valid with `action: "start"`** — supplying
  it with any other action returns a clear validation error before any GraphQL
  call. Never silently ignored.
- All four mutations return the untyped `JSON!` scalar, and the SDL marks the type
  *"WIP, response types and functionaliy will change"* — the handler **never
  inspects the JSON payload**. The only contract used: the client throws
  `UnraidApiError` on any `errors[]`, so throw = failure, return = accepted.
- **Result reporting:** after the mutation resolves, a follow-up read of
  `array { parityCheckStatus { status progress errors correcting paused running speed } }`
  reports the actual resulting state (2-call handler; `sequencedExecutor` in
  tests). The tool owns this read query per convention. *(Pending validation #3:
  if `parityCheckStatus` is racy immediately post-mutation — the notification
  overview cache was — fall back to reporting the accepted action + pointing to
  `array_status`.)*

### `array_status` widening (shipped tool, tiny diff)

`array-status.graphql` currently selects `parityCheckStatus { status progress
errors running paused }`. Add `correcting` and `speed` so a running check shows
whether it is writing corrections and how fast — keeping `array_status` the
single authoritative parity view that `parity_check`'s description points to.
No dedicated `parity_status` tool: it would be redundant.

## Gate policy

Stopping the array is the single most consequential operation in this server —
it takes **every share, Docker container, and VM offline**. But it is graceful
and reversible (`start` brings it back): the risk axis is **blast radius**, not
corruption. `vm_action`'s `acknowledge_risk` copy ("can corrupt the guest
filesystem") would be a false statement here — the two-tier *mechanism* is
reused, the *copy* is op-specific.

| Op | Gate | Rationale |
|----|------|-----------|
| `array_action stop` | `confirm` + `acknowledge_risk` (one combined refusal naming both) | Blast radius: all shares, containers, and VMs go offline |
| `array_action start` | `confirm` only | Restores service; reversible |
| `parity_check` all actions | `confirm` only | Correcting checks are routine maintenance (a UI checkbox); pause/resume/cancel are job control. *(Pending validation #2: revisit if `correct: true` turns out genuinely dangerous.)* |

Annotations for both tools: `readOnlyHint: false, destructiveHint: true,
openWorldHint: false` (gated mutations; stop removes availability, cancel
discards an in-progress check, correct writes to parity).

## Validated semantics (source-read, NOT live-verified) — PENDING

A focused source-validation Workflow over `unraid/api` (commit pinned at run
time; each behavioral assumption adversarially verified, then a completeness
critic) will settle what the SDL does not state. **Nothing in this repo is
live-verified against a real Unraid box** — flagged here and in the PR.
Hypotheses to test:

1. **`setState` return semantics.** Does START/STOP block until the array
   settles, or return a transient state? Is `setState(START)` while STARTED a
   no-op, an error, or an emhd passthrough? Does STOP fail when Docker/VMs/mover
   are active, or does the platform stop them first? → determines result
   reporting (§array_action) and the gate copy's claims.
2. **Parity `JSON!` returns and throw conditions.** What does the JSON actually
   contain (unused either way)? Does `start` throw if a check is already running
   or the array is stopped? What do `pause`/`resume`/`cancel` do when no check
   is running? Does `correct: true|false` map to the UI's "Write corrections to
   parity" checkbox?
3. **`parityCheckStatus` freshness** immediately after a parity mutation —
   synchronous source or racy cache? → decides the 2-call report vs
   report-and-point fallback.
4. **RBAC / feature flags.** Do `ArrayMutations`/`ParityCheckMutations` carry
   `@UsePermissions` (resource ARRAY?) or `@UseFeatureFlag`? (VM tools were
   RBAC; notification mutations were default-allow.) How does an
   under-privileged key fail at runtime?
5. **`setState` in error states.** Can it be called when the array is in
   NEW_ARRAY / TOO_MANY_MISSING_DISKS / etc., and how does it fail?

## Scope

**In:** `array_action`, `parity_check`, `array_status` selection widening,
registry wiring, README rows.

**Deferred (explicitly out):**
- Disk-level array ops (`addDiskToArray`, `removeDiskFromArray`,
  `mountArrayDisk`, `unmountArrayDisk`, `clearArrayDiskStatistics`) — they
  require a stopped array and carry hardware risk; `array_action` is their
  prerequisite. Later PR.
- `arraySubscription` / `parityHistorySubscription` — no subscription transport
  in the server yet.
- Dedicated `parity_status` read — redundant with `array_status`.

**Files:** `src/tools/array/{array-action,parity-check}.{ts,graphql,test.ts}`
(+ widened `array-status.graphql` and regenerated
`src/types/unraid/graphql.ts` via `npm run generate`). The `array/` directory
lands at 4 source files — under the 10-file cap.

## Error handling

- Gate refusals return `toolError` with "No changes were made." before any
  GraphQL call (stop's combined refusal names both flags, mirroring
  `vm_action`).
- `correct` outside `start` → `toolError` validation message, no call.
- Any `UnraidApiError` (field resolver errors included) surfaces via the
  handler's catch → `toolError` with action context ("Failed to start parity
  check: …").
- The parity follow-up read failing after a successful mutation must NOT report
  failure of the action — report the action as accepted and the status read as
  unavailable, pointing to `array_status`.

## Testing

Hermetic, no network — `_shared/test-support.ts` fakes:
- Gate refusal paths: missing `confirm` (both tools), stop missing
  `acknowledge_risk` (and the combined-refusal copy), gates checked before any
  executor call (`recordingExecutor` sees zero calls).
- `correct`-with-non-start rejection; `correct` default false; `correct: true`
  forwarded to the start document's variables.
- Enum map start/stop → START/STOP (tested map per convention).
- `array_action` reports the returned state verbatim for non-obvious
  `ArrayState` values (e.g. TOO_MANY_MISSING_DISKS).
- 2-call parity flow via `sequencedExecutor` (mutation then status read);
  follow-up-read-failure path reports accepted-but-unverified.
- Error paths via `throwingExecutor`/`rejectingExecutor` pinned to the wrapped
  message form.
- Both response formats; registration + annotation assertions; fixtures typed
  `satisfies <Op>Mutation/Query` against codegen output.
