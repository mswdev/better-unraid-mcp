# better-unraid-mcp — VM Tools Design (PR #5)

**Date:** 2026-06-02
**Author:** Matt White (mswdev)
**Status:** Approved + source-validation reconciled — ready for implementation planning
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

## Validated semantics (source-read, not live-verified)

A focused source-validation Workflow over `unraid/api` (`main` @ `264ddf0`,
v4.35.0) — each design-blocking claim independently re-checked by an adversarial
verifier — settled the assumptions the SDL does not state. Findings drive the
design below; **none is live-verified against a real Unraid box** (a moving
branch + public libvirt docs), flagged here and in the PR.

1. **`domains` is canonical; use it.** `vms.resolver.ts`: `domains()` is the real
   implementation (calls `VmsService.getDomains()`); `domain()` is literally
   `return this.domains();` — a passthrough alias. Neither is `@deprecated`
   (whereas `VmDomain.uuid` is), but `domains` is the primary declaration.
   **Both `.graphql` files select `domains` only**, never `domain`, never both
   (selecting both runs the libvirt enumeration twice).

2. **Disabled VM service → the `domains` field *throws*** (it does **not** return
   a benign empty list). `Query.vms` itself always succeeds (returns a hardcoded
   `{ id: "vms" }`), but the `domains` field resolver runs
   `getDomains() → ensureHypervisorAvailable() → initializeHypervisor()`; with
   libvirt down, `isLibvirtRunning()` is false → throws, re-wrapped as
   `Error("Failed to retrieve VM domains: VMs are not available")`. On the wire:
   `data.vms.domains = null` **plus an `errors[]` entry**. Our client
   (`UnraidClient.execute`) **throws `UnraidApiError` on any `errors[]`**
   (`client.ts:38`), so a disabled service surfaces through `vm_list`'s
   `catch → toolError` automatically. The benign **"No VMs found."** copy is
   reserved for the genuinely empty case (libvirt up, zero VMs → `domains: []`,
   no errors). ⇒ do **not** collapse disabled and empty into one message.

3. **`Boolean!` is `true`-or-throw; the resolver *awaits to completion*.** Every
   `VmsService` method `return true` on success or `throw new GraphQLError(...)`
   on failure — there is **no code path that returns `false`.** Per-action
   (verified in `vms.service.ts`):
   - `start` → `domain.create()` (SHUTOFF) / `domain.resume()` (PAUSED).
   - `stop` → `domain.shutdown()` (graceful ACPI), then **polls** ~10×1s for
     SHUTOFF, **force-destroying** on timeout. ⇒ `true` = actually reached
     SHUTOFF. **"Stopped VM X" is accurate** — no "Requested shutdown" hedge.
   - `pause` → `domain.suspend()`; `resume` → `domain.resume()`.
   - `forceStop` → `domain.destroy()` (immediate hard kill).
   - `reboot` → `domain.shutdown()` + ~10s poll; **throws** "Graceful shutdown
     failed, please force stop the VM and try again" if the guest ignores ACPI
     (**no force fallback**), else `domain.create()`. ⇒ `true` = shut down and
     restarted.
   - `reset` → `domain.destroy()` + `domain.create()` (hard kill + cold boot —
     **not** a clean `virDomainReset`).

   ⇒ Use uniform **completed past-tense** copy (the API earns it by awaiting).
   `false` is unreachable per source, but we **keep a minimal defensive guard**
   (see Output) — this is defensive `Boolean!`-contract handling for an
   un-live-verified moving API, **not** the autostart no-op lesson (which does
   not apply: false-means-no-op is genuinely absent here). The ~10s block for
   `stop`/`reboot` is safe under undici's ~300s default timeout — no client
   change.

4. **No feature flag — runtime RBAC instead.** None of the seven mutations nor
   `Query.vms` carry `@UseFeatureFlag`, so they are **always in the schema**
   (unlike Docker's `ENABLE_NEXT_DOCKER_RELEASE`). They are guarded by
   `@UsePermissions` (nest-authz/Casbin): `vms` needs `READ_ANY` on `VMS`; all
   mutations need `UPDATE_ANY` on `VMS`. ⇒ **drop any "needs Unraid 7.x / feature
   flag" copy**; a key lacking `VMS` permission fails at runtime with an
   authorization error (surfaced via `toolError`). Note in the description that
   the API key needs VM permission.

5. **`id` round-trips, but tolerate both forms.** `VmDomain.id` is the raw libvirt
   **UUID**; the `PrefixedID` scalar serializes it on output as `"<serverId>:<uuid>"`
   (colon-joined, **no** base64/typename) and on input `split(":")` returns the
   post-colon segment when there are exactly 2 parts, else the value unchanged —
   so a **bare uuid also round-trips**. The mutations look up by UUID
   (`domainLookupByUUIDString`), never by name. ⇒ `vm_list` surfaces the prefixed
   `id`, but `getServerIdentifier()` can be empty on some builds, and a human may
   paste the **bare** uuid (the Unraid UI / deprecated `uuid` field form). The
   resolver's id match **must tolerate both** (exact, or post-`:` segment), or our
   layer is stricter than the API for no reason (see Resolve).

6. **VM names are unique per host.** libvirt enforces domain-name uniqueness per
   connection (`virDomainDefineXML` rejects a duplicate name), and Unraid uses one
   `qemu:///system`. ⇒ `vm_action`'s duplicate-name ambiguity branch is
   **effectively unreachable** on a healthy host. We **keep it as a cheap,
   documented defensive guard** (with a test) — same category as the defensive
   `false` guard — but it is not expected to fire in practice.

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
| graceful | `stop`, `reboot` | guest-cooperative ACPI shutdown/reboot (server waits ~10s) |
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
2. **Tolerant `id` match** first, then **exact case-insensitive `name` match**.
3. `0` matches → `toolError` ("No VM matches '<vm>'.").
4. `>1` name matches → `toolError` listing the candidate ids ("Multiple VMs named
   '<vm>': <ids>. Pass the id to disambiguate.").
5. Use the resolved VM's `id` (the prefixed form, verbatim from the read) for the
   mutation.

**Tolerant id match (finding #5):** `domain.id === vm` OR
`stripServerPrefix(domain.id) === stripServerPrefix(vm)`, where `stripServerPrefix`
mirrors the `PrefixedID` scalar exactly (`split(":")`; return the second part only
when there are exactly two, else the value). This matches whether the caller pastes
the prefixed `serverId:uuid` from `vm_list` **or** a bare `uuid` (the Unraid UI /
deprecated-`uuid` form), and is robust to an empty `getServerIdentifier()`. Without
it, exact-only matching would be **stricter than the API**, which accepts both.

Exact (not substring) matching for the **name** target prevents acting on the wrong
VM; a null `name` simply never matches by name. **Gate-first-then-resolve** so the
confirm refusal echoes the raw `vm` input the caller typed (intended — mirrors what
they asked for; no wasted network call on an unconfirmed request).

## Tools

### `vm_list`

**Description (read-only):** "Read-only. Lists virtual machines with their run
state (RUNNING, SHUTOFF, PAUSED, …). Use `name` to filter by a VM-name substring."

### `vm_action`

**Description (gated):** "Changes a VM's run state. `action`:
`start`/`resume` (bring up / un-pause), `stop` (graceful ACPI shutdown — waits up
to ~10s, then force-kills if the guest doesn't respond), `reboot` (graceful — and
**fails** if the guest ignores ACPI within ~10s; use `forceStop` then `start`),
`pause` (freeze in memory), or `forceStop`/`reset` (⚠ ungraceful hard kill /
hard kill-and-cold-boot that can corrupt the guest filesystem). `vm` accepts a VM
name or id. Requires `confirm: true`; `forceStop` and `reset` additionally require
`acknowledge_risk: true`. The configured Unraid API key must have VM permission."

## Behavior (`vm_action`)

1. **Gate (fail-fast, before any `client.execute`):**
   - ungraceful action (`forceStop`/`reset`): require `confirm:true` AND
     `acknowledge_risk:true`; missing-either → one combined `toolError`.
   - otherwise: `requireConfirmation(confirm, "<action> VM <vm>")`.
2. **Resolve** `vm` → id via the `VmResolve` read (tolerant id, else exact
   case-insensitive name; 0 / >1 → `toolError`).
3. **Dispatch** the typed mutation for `action` (`VmStart` … `VmReset`),
   variables `{ id }` (the resolved VM's prefixed id).
4. On a `true` result → completed past-tense copy. On `false` → the **defensive
   guard** copy (finding #3: `false` is unreachable per source, kept as
   `Boolean!`-contract insurance for an un-live-verified API; a code comment cites
   the true-or-throw finding so the next reader knows it is a deliberate guard,
   not a live failure mode).
5. `try/catch → toolError` around the read + mutation. Thrown `GraphQLError`s —
   invalid state transition, VM not found, permission denied (key lacks `VMS`),
   reboot ACPI-timeout — all surface here with their upstream message.

## GraphQL operations

```graphql
# vm-list.graphql
query VmList {
  vms {
    domains {   # canonical (finding #1); never `domain`, never both
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
  empty domains → `"No VMs found."` (a disabled VM service does **not** reach here
  — it throws and is caught as a `toolError`; see finding #2).
- **Detailed:** `{ id, name, state }[]`.

### `vm_action`

- **Concise.** The resolver awaits to completion and is `true`-or-throw
  (finding #3), so a returned `true` earns uniform **completed past-tense** copy:
  - `start → "Started VM <label>."` (note: the guest continues booting)
  - `stop → "Stopped VM <label>."` (graceful; force-killed after ~10s if needed)
  - `pause → "Paused VM <label>."`
  - `resume → "Resumed VM <label>."`
  - `forceStop → "Force-stopped VM <label>."`
  - `reboot → "Rebooted VM <label>."`
  - `reset → "Reset VM <label>."`
  - `<label>` = resolved name, or id when the name is null.
- **Concise — defensive `false` guard** (finding #3; should be unreachable):
  `"VM <label>: <action> returned false instead of confirming success. Run
  vm_list to check the current state."` (states the literal fact + a verification
  path — deliberately **not** "no state change took effect", which is the
  autostart meaning that does not hold for VMs).
- **Detailed:** `{ ok: boolean, action, id, name }`.

## Error handling

`try/catch → toolError` around both `execute` calls (resolve read + mutation).
Gate refusals and resolve failures (0 / >1 match) return `toolError` **before**
the mutation. A disabled VM service throws on the `domains` field → our client
re-throws `UnraidApiError` → `toolError` (finding #2). Runtime failures all arrive
as thrown `GraphQLError`s and surface with their upstream message via `toolError`:
invalid state transition, VM not found, **permission denied** (key lacks `VMS` —
finding #4; no version/flag gate), and `reboot`'s ACPI-timeout. No capability
probe; no "needs 7.x" copy.

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
- **resolve — tolerant id match (finding #5):** a caller-supplied **bare uuid**
  matches a VM whose read `id` is the **prefixed** `serverId:uuid`, **and**
  vice-versa; the resolved prefixed id is what's passed to the mutation. Fixtures
  cover **both** forms (a prefixed-only fixture would be a false green).
- **resolve — id-vs-name precedence:** input equal to an id matches that VM even
  if a different VM's name collides.
- **resolve — exact name match (case-insensitive).**
- **resolve — zero matches** → `isError`, **mutation never called**
  (`calls.length === 1`, only the `VmResolve` read).
- **resolve — duplicate names** (defensive, unreachable-per-source) → `isError`
  listing ids, mutation never called.
- **resolve — null-name VM** never matches by name (falls through to no-match).
- **dispatch:** each `action` calls its typed mutation Document with `{ id }`.
- **bool branch:** `true` → completed past-tense copy (per-action; e.g. `stop` →
  "Stopped VM …", `reboot` → "Rebooted VM …"); `false` (defensive,
  unreachable-per-source) → the "returned false instead of confirming success…
  Run vm_list…" guard copy.
- **concise vs detailed.**
- **error paths:** resolve read throws; mutation throws (`sequencedExecutor`
  with an `Error` in the second slot) — covers the thrown-`GraphQLError` classes
  (state transition / not-found / permission / reboot-timeout).

## Placement

```
src/tools/vm/                         # new domain dir (2 source .ts, under the 10 cap)
  vm-list.{ts,graphql,test.ts}
  vm-action.{ts,graphql,test.ts}
src/tools/registry.ts                 # registers vm_list + vm_action
src/types/unraid/graphql.ts           # regenerated (VmList + VmResolve + 7 mutations)
README.md                             # promote VM tools from "planned" to shipped
```

**No `vm/_shared.ts`.** The two tools format their label differently (`vm_list`
wraps a null-name id in parens, `vm_action` uses a bare `name ?? id`), so there is
no genuinely-shared label helper. The one pure helper — `stripServerPrefix(id)`
(the `PrefixedID` colon rule, used only by `vm_action`'s resolver) — is **exported
from `vm-action.ts` and unit-tested directly**, exactly as `autostart-set.ts`
exports `compareByOrder`. A single-consumer `_shared.ts` would be premature.

## Out of scope / residual unknowns

- **Not verified against a live Unraid box.** All semantics from static reads of
  `unraid/api@main` (`264ddf0`, v4.35.0 — a moving branch) + public libvirt docs;
  pin/re-verify against the server's API version.
- **Two deliberate defensive guards** for cases the source proves unreachable but
  we have not live-verified: the `false` `Boolean!` branch (finding #3) and the
  duplicate-name branch (finding #6). Each is tested and carries a code comment
  citing the finding, so they read as intentional insurance, not live failure
  modes.
- No VM **creation / deletion / editing** (libvirt XML, disks, devices) — v1 is
  lifecycle control only.
- The server already polls `stop`/`reboot` to a settled state (~10s); the tool
  does **not** add its own post-action polling, and reports the awaited result.
- No introspection **capability probe**; VM fields are always in-schema
  (finding #4), so a missing `VMS` permission surfaces as a runtime auth error,
  not a schema/version error.

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, codegen
idempotency (`npm run generate` no-diff), and an independent stdio
`initialize → tools/list` smoke confirming `vm_list` (`readOnlyHint:true`) and
`vm_action` (`destructiveHint:true`) register.
