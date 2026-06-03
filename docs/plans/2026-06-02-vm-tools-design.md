# better-unraid-mcp — VM Tools Design (PR #5)

**Date:** 2026-06-02
**Author:** Matt White (mswdev)
**Status:** Approved — pending source-validation reconciliation before implementation planning
**Branch:** `feature/vm-tools` → draft PR into `develop`

## Goal

Ship the VM (libvirt) domain: one read tool `vm_list` and one gated mutation
tool `vm_action`. This is the second mutation domain after Docker and reuses the
same `requireConfirmation` gate, `GraphQLExecutor` seam, vendored-SDL + codegen
pipeline, and `_shared` helpers (`respond.ts`, `confirm.ts`, `test-support.ts`).

The VM mutations (`Mutation.vm: VmMutations`) expose seven lifecycle actions —
`start`, `stop`, `pause`, `resume`, `forceStop`, `reboot`, `reset` — each
`(id: PrefixedID!): Boolean!`. We consolidate all seven into a single `vm_action`
tool with an `action` enum (per the project's "consolidated, not 1:1" tool
philosophy), and surface VM state via `vm_list`.

## Explicit assumptions — settle in source-validation BEFORE writing-plans

These are behavioral facts the SDL does not state. A focused source-validation
Workflow over `unraid/api` (plus online docs) must settle them; a flip on any of
the **design-blocking** three must be reconciled into this doc before the plan is
written, so a stale assumption does not silently invalidate the plan.

**Design-blocking:**

1. **`domains` vs `domain` on `type Vms`.** The SDL exposes both
   `domains: [VmDomain!]` and `domain: [VmDomain!]` (both nullable lists). One is
   almost certainly an alias/legacy field of the other. Determine the canonical
   one from the `unraid/api` `Vms` resolver. **Both** `.graphql` files (`VmList`
   and `VmResolve`) use whichever wins — do not default-and-hope.
2. **Disabled-VM-service behavior of `Query.vms`.** `vms: Vms!` is non-null but
   `domains`/`domain` are nullable. When libvirt / the VM service is disabled,
   does the resolver (a) throw a GraphQL error, (b) return `domains: null`, or
   (c) return an empty list? This drives whether `vm_list` degrades to a clear
   `toolError` or a benign "No VMs found (the VM service may be disabled)."
3. **`Boolean!` semantics — accepted vs completed.** Does `true` mean the
   operation *completed*, or merely that it was *accepted/issued*? libvirt
   graceful `stop` (ACPI shutdown) and `reboot` are inherently asynchronous and
   guest-dependent, so `true` almost certainly means "accepted." This drives the
   affirmative concise copy (see **Output**): async ops must read "Requested
   shutdown/reboot of VM X", not "Stopped VM X" (repeating the autostart
   over-claim the project already learned to avoid).

**Non-blocking (informs copy / edge handling, not structure):**

4. **Capability / feature-flag gating on `VmMutations`.** Are any of the seven
   mutations behind a feature flag (which would omit them from the schema when
   off, like Docker's `ENABLE_NEXT_DOCKER_RELEASE`)? If so, an older server
   surfaces a GraphQL field error — copy should note the requirement.
5. **PrefixedID round-trip.** Confirm the `id` returned by the `vms` read is the
   exact `PrefixedID` the mutations accept (so resolve-by-id is a faithful
   round-trip). Note the PrefixedID encoding.
6. **VM name uniqueness.** Can two VMs share a `name` in Unraid/libvirt? This
   informs the resolver's ambiguity branch (it errors on duplicate-name matches
   regardless, but confirms how reachable that path is).

**None of this is live-verified against a real Unraid box.** All findings come
from static reads of `unraid/api` (a moving branch) plus public docs — flagged
here, in the PR, and in residual unknowns.

## Decisions

### `vm_list` (read)

- API: `vm_list(response_format?, name?)`.
- `name`: optional **case-insensitive substring** filter on VM name (exploratory
  read — broad matching is fine here, unlike the action resolver).
- Query selects `{ id, name, state }`. `name: String` is **nullable** — handle a
  null name in display (fall back to the id) and in the resolver (a null-name VM
  never matches by name).
- Annotations: `readOnlyHint: true, destructiveHint: false, openWorldHint: false`.

### `vm_action` (gated mutation)

- API: `vm_action(response_format?, vm, action, confirm?, acknowledge_risk?)`.
  - `vm`: VM **name or id** (resolved before mutating — see Behavior).
  - `action`: enum `start | stop | pause | resume | forceStop | reboot | reset`.
  - `confirm`: the standard state-changing gate.
  - `acknowledge_risk`: the **extra** acknowledgement required only for the two
    ungraceful actions (see gate policy).
- Annotations: `readOnlyHint: false, destructiveHint: true, openWorldHint: false`
  (all seven actions are gated, including restorative `start`/`resume`, for
  consistency with the Docker mutations).

### Two-tier confirm-gate policy

The seven actions split by how they affect a running guest:

| Tier | Actions | Effect |
|------|---------|--------|
| restorative | `start`, `resume` | bring a VM up / un-pause |
| graceful | `stop`, `reboot` | signal the guest OS (ACPI); async |
| safe-pause | `pause` | freeze vCPUs in memory (reversible) |
| **ungraceful** | **`forceStop`, `reset`** | **hard power-cut / hard reset — can corrupt the guest filesystem like yanking the power cord** |

- **Graceful tier** (`start, stop, pause, resume, reboot`): require
  `confirm: true` via the **existing `requireConfirmation`** helper, unchanged —
  this keeps the refusal wording identical to every other mutation tool.
- **Ungraceful tier** (`forceStop, reset`): require `confirm: true` **and**
  `acknowledge_risk: true`. A **layered** check on top of `requireConfirmation`;
  if either flag is missing, return **one combined refusal** naming both (so the
  caller does not need two round-trips to discover both gates). The flag is named
  `acknowledge_risk` (self-documenting; deliberately not `force`, which would
  overload the `forceStop` already in the action name).

### Resolve by name or id

The mutations require `id: PrefixedID!`, but users think in VM names. `vm_action`
resolves before mutating:

1. Read VMs (own `VmResolve` query, mirroring how `autostart_set` owns its read).
2. **Exact `id` match** first; else **exact case-insensitive `name` match**.
3. `0` matches → `toolError` ("No VM matches '<vm>'.").
4. `>1` name matches → `toolError` listing the candidate ids ("Multiple VMs named
   '<vm>': <ids>. Pass the id to disambiguate.").
5. Use the resolved id for the mutation.

Exact (not substring) matching for the action target prevents acting on the wrong
VM. **Gate-first-then-resolve** so the confirm refusal echoes the raw `vm` input
the caller typed (intended — mirrors what they asked for; no wasted network call
on an unconfirmed request).

## Tools

### `vm_list`

**Description (read-only):** "Read-only. Lists virtual machines with their run
state (RUNNING, SHUTOFF, PAUSED, …). Use `name` to filter by a VM-name substring."

### `vm_action`

**Description (gated):** "Changes a VM's run state. `action`:
`start`/`resume` (bring up / un-pause), `stop`/`reboot` (graceful ACPI signal to
the guest — asynchronous), `pause` (freeze in memory), or `forceStop`/`reset`
(⚠ ungraceful hard power-cut / hard reset that can corrupt the guest filesystem).
`vm` accepts a VM name or id. Requires `confirm: true`; `forceStop` and `reset`
additionally require `acknowledge_risk: true`."

## Behavior (`vm_action`)

1. **Gate (fail-fast, before any `client.execute`):**
   - ungraceful action (`forceStop`/`reset`): require `confirm:true` AND
     `acknowledge_risk:true`; missing-either → one combined `toolError`.
   - otherwise: `requireConfirmation(confirm, "<action> VM <vm>")`.
2. **Resolve** `vm` → id via the `VmResolve` read (exact id, else exact
   case-insensitive name; 0 / >1 → `toolError`).
3. **Dispatch** the typed mutation for `action` (`VmStart` … `VmReset`),
   variables `{ id }`.
4. **Branch on the `Boolean!`** result (the autostart lesson — report a false /
   no-op result, never assert success blindly).
5. `try/catch → toolError` around the read + mutation.

## GraphQL operations

```graphql
# vm-list.graphql
query VmList {
  vms {
    domains {   # or `domain` — settled in source-validation
      id
      name
      state
    }
  }
}

# vm-action.graphql
query VmResolve {
  vms {
    domains {   # same field as VmList
      id
      name
    }
  }
}

mutation VmStart($id: PrefixedID!)     { vm { start(id: $id) } }
mutation VmStop($id: PrefixedID!)      { vm { stop(id: $id) } }
mutation VmPause($id: PrefixedID!)     { vm { pause(id: $id) } }
mutation VmResume($id: PrefixedID!)    { vm { resume(id: $id) } }
mutation VmForceStop($id: PrefixedID!) { vm { forceStop(id: $id) } }
mutation VmReboot($id: PrefixedID!)    { vm { reboot(id: $id) } }
mutation VmReset($id: PrefixedID!)     { vm { reset(id: $id) } }
```

(Each mutation field is a `Boolean!`.)

## Output

### `vm_list`

- **Concise:** one line per VM `name — state`; a null-name VM → `(<id>) — state`;
  empty/null domains → `"No VMs found (the VM service may be disabled)."`
- **Detailed:** `{ id, name, state }[]`.

### `vm_action`

- **Concise — pending source-validation #3 (accepted vs completed).** Branch on
  the bool. Working copy, assuming `true` = "accepted":
  - immediate ops (`start`, `pause`, `resume`, `forceStop`, `reset`) →
    `"Started / Paused / Resumed / Force-stopped / Reset VM <label>."`
  - **async graceful ops (`stop`, `reboot`) → `"Requested shutdown / reboot of VM
    <label>."`** (NOT "Stopped" — `true` means the ACPI signal was accepted, not
    that the guest is off; completion is guest-dependent).
  - `false` → `"VM <label> was not <action>ed (API returned false); no state
    change took effect."`
  - `<label>` = resolved name, or id when the name is null.
- **Detailed:** `{ ok: boolean, action, id, name }`.

If source-validation proves the resolver *blocks until completion*, the async-op
copy can be promoted to completed phrasing; until then it stays honest-async.

## Error handling

`try/catch → toolError` around both `execute` calls (resolve read + mutation).
Gate refusals and resolve failures (0 / >1 match) return `toolError` **before**
the mutation. A disabled VM service surfaces per assumption #2; a feature-flagged
mutation (assumption #4) surfaces its GraphQL field error via `toolError`.

## Testing

Hand-written fakes only (no mocking libs), `satisfies VmListQuery` /
`VmResolveQuery` fixtures so codegen drift breaks the build. `vm_action` is a
two-call handler (resolve read + mutation) → use `sequencedExecutor`.

**`vm_list`:**
- empty / null domains → "No VMs found…".
- multiple VMs → one line each; **null-name VM** renders `(<id>) — state`.
- `name` substring filter (case-insensitive); non-matching filter → empty.
- concise vs detailed; error path (`throwingExecutor` / `rejectingExecutor`).

**`vm_action`:**
- **gate, graceful:** no `confirm` → `isError`, executor never called.
- **gate, ungraceful:** `forceStop`/`reset` with `confirm:true` but no
  `acknowledge_risk` → `isError` (combined message), executor never called;
  with both → proceeds.
- **resolve — id-vs-name precedence:** input equal to an id matches that VM even
  if a different VM's name collides.
- **resolve — exact name match (case-insensitive).**
- **resolve — zero matches** → `isError`, **mutation never called**
  (`calls.length === 1`, only the `VmResolve` read).
- **resolve — duplicate names** → `isError` listing ids, mutation never called.
- **resolve — null-name VM** never matches by name (falls through to no-match).
- **dispatch:** each `action` calls its typed mutation Document with `{ id }`.
- **bool branch:** `true` → affirmative copy (async ops say "Requested …");
  `false` → "was not …" no-op copy.
- **concise vs detailed.**
- **error paths:** resolve read throws; mutation throws (`sequencedExecutor`
  with an `Error` in the second slot).

## Placement

```
src/tools/vm/                         # new domain dir (3 source .ts, under the 10 cap)
  vm-list.{ts,graphql,test.ts}
  vm-action.{ts,graphql,test.ts}
src/tools/registry.ts                 # registers vm_list + vm_action
src/types/unraid/graphql.ts           # regenerated (1 query + 7 mutations + VmResolve)
README.md                             # promote VM tools from "planned" to shipped
```

A `vm/_shared.ts` (e.g. a `vmLabel(name, id)` helper) will be added **only if**
both tools genuinely share logic during implementation; otherwise the label
helper stays local to avoid a one-function file. Decided at build time, not
forced here.

## Out of scope / residual unknowns

- **Not verified against a live Unraid box.** All semantics from static reads of
  `unraid/api@main` (a moving branch) + public docs; pin/re-verify against the
  server's API version.
- No VM **creation / deletion / editing** (libvirt XML, disks, devices) — v1 is
  lifecycle control only.
- No **wait-for-state** / polling after an async `stop`/`reboot`; the tool
  reports the accepted/rejected result, not the eventual settled state.
- No introspection **capability probe** for any feature flag (graceful error +
  docs instead, as with Docker autostart).

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, codegen
idempotency (`npm run generate` no-diff), and an independent stdio
`initialize → tools/list` smoke confirming `vm_list` (`readOnlyHint:true`) and
`vm_action` (`destructiveHint:true`) register.
