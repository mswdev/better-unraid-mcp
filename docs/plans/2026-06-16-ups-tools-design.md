# UPS Domain Tool — Design (PR #10)

**Date:** 2026-06-16
**Branch:** `feature/ups-tools` (off `develop`)
**Status:** Approved + **source-validation reconciled (revision 1)**
**Validation pin:** unraid/api @ `264ddf0` (v4.35.0); UPS resolver byte-identical on current `origin/main` — source-validated only, **NOT live-verified**

## Goal

Give the MCP read-only visibility into the server's UPS: operational status, battery
charge/runtime, and power load/voltage. This completes the triage story
(`notification_alerts` → `system_metrics` → `logs` → **UPS**): an *On Battery* / *Low
Battery* UPS is an alert-worthy power condition a triage caller wants to confirm
quickly. UPS reads verified **real** (not stubs) by direct read of the upstream
resolver + service.

| Tool | Root | Purpose |
|------|------|---------|
| `ups_status` | `Query.upsDevices` | Live UPS telemetry: status + battery + power (concise \| detailed) |

## Scope decision: read-only, one tool

- **Ship `ups_status` only.** Single read of `Query.upsDevices`.
- **Drop `upsDeviceById`.** Pure redundancy: the box always reports a single UPS, it
  calls the *same* `getUPSData()` then filters by an id the caller can't know without
  first calling `upsDevices`, and it returns that one device or `null` — zero new
  information (`ups.resolver.ts:52-60`). The `id` is returned **raw** (plain `ID`
  scalar, no PrefixedID middleware), i.e. literally the model string or `'ups1'`.
- **Defer `Mutation.configureUps`.** It is **destructive-tier**, not a plain
  settings-write: `configureUPS` stops the apcupsd daemon, rewrites
  `/etc/apcupsd/apcupsd.conf`, conditionally **edits `/etc/rc.d/rc.6`** (the system
  shutdown script, to toggle UPS killpower when `service==='enable'`), then restarts
  the daemon (`ups.resolver.ts:83-90`, `ups.service.ts` `configureUPS`/`modifyRc6File`).
  It is also **completely ungated upstream** (no `@UsePermissions`, no API-layer
  confirmation) — so if it is ever shipped, our `requireConfirmation` gate is the
  *only* protection. Off the read-only roadmap; deferred with `upsConfiguration`.
- **Defer the `upsConfiguration` read.** Low value with no write to pair it, and it
  surfaces operational detail — including the `device` field, which for an SNMP-type
  UPS embeds an **SNMP community string** (a credential). Not exposing it sidesteps a
  credential leak. Revisit only if a UPS settings-write PR is scoped (and mask
  `device` then).

## Upstream read semantics (source-validated @ 264ddf0; adversarially verified)

The tool's value is the `status` field. The resolver's defaulting makes parts of the
payload **confidently dishonest** on a UPS-less / degraded box. Our client (which
throws `UnraidApiError` on any `errors[]`) sees exactly **three** outcomes from
`upsDevices` — never an empty array:

### Outcome A — one real device
apcaccess reported data including a `MODEL`. Render normally.

### Outcome B — one PHANTOM device (the footgun)
apcaccess **exists** but emits non-blank, non-UPS text (e.g. `Error contacting apcupsd
@ localhost:3551: Connection refused` when the daemon is down, or any junk). Then:
`parseUPSData` yields `{}`/non-UPS keys → `UPSSchema.parse` (all fields
`z.string().optional()`, strips unknowns) **succeeds** returning `{}` → `getUPSData()`
returns `{}` (does **not** throw) → `createUPSDevice` fabricates a full healthy device
from `||` defaults: `status:'Online'`, `chargeLevel:100`, `loadPercentage:25`,
`inputVoltage/outputVoltage:120.5`, `estimatedRuntime:3600`, `model:'APC Back-UPS Pro
1500'`, `name:'My UPS'` (`ups.resolver.ts:16-42`, `ups.service.ts:50-64`).
**→ The tool must NOT report this as a healthy UPS.**

**Identity detection (source-airtight):** `name = upsData.MODEL || 'My UPS'` and `model
= upsData.MODEL || 'APC Back-UPS Pro 1500'` both read the *same* `MODEL` key, so the
pair `name === 'My UPS' && model === 'APC Back-UPS Pro 1500'` can only co-occur when
`MODEL` was **absent** — a real UPS named "APC Back-UPS Pro 1500" would set `name` to
that string too, never to "My UPS". MODEL-absent ⟺ apcaccess reported no device
identity. This is a logical identity from the source, not a value heuristic, so it
cannot false-positive on a genuinely Online/100% UPS.

**Suppression is gated on a SAFE status, so it can never hide an alert.** `status =
upsData.STATUS || 'Online'` is **independent of MODEL**: apcaccess could (empirically —
not source-rulable, and nothing here is live-verified) emit a record with no `MODEL`
but a real alert `STATUS` (e.g. `ONBATT`). Flatly suppressing on the identity pair
alone would hide the exact *On Battery* signal the tool exists to surface. So:
- **Full no-data suppression** only when `name === 'My UPS' && model === 'APC Back-UPS
  Pro 1500' && status === 'Online'`. The title-case `'Online'` is itself the default
  fingerprint — real apcaccess `STATUS` is uppercase (`ONLINE`/`ONBATT`/`COMMLOST`), so
  the title-case literal specifically marks the *default*, not a live reading. Reports
  **"no live UPS data — apcupsd may be stopped or no UPS attached; the API returned
  placeholder values"** (a normal result, like `plugin_list`'s empty honesty — *not* an
  error). Detailed mode carries `{ upsDetected: false, note, placeholderPayload: data }`.
- **Identity-placeholder but non-safe status** (MODEL absent, `status !== 'Online'`) →
  **surface the status** via the normal summary **plus** a caveat that apcaccess
  reported no device identity and the model/name and unchanged values may be upstream
  defaults — verify the connection. The reading is shown, never suppressed.

The invariant this buys: suppression can only ever swallow an `'Online'`/safe reading,
never a battery/alert reading — the property a triage tool requires, correct whether or
not the empirical no-MODEL-with-alert edge exists.

### Outcome C — `UnraidApiError`
Two sub-cases, both surfaced as `toolError`:
- **Blank/whitespace stdout or missing `/sbin/apcaccess` binary** (ENOENT →
  `reject:false` → `stdout===undefined` → blank-guard) → throws exactly `Failed to get
  UPS data: No UPS data returned from apcaccess` (`ups.service.ts:50-64`).
- **NaN serialize throw (low-likelihood third mode):** unguarded `parseInt`/`parseFloat`
  on a present-but-non-numeric source field yields `NaN` in a non-null `Int!`/`Float!`
  scalar; graphql-js v16.11 `serialize()` throws → the `[UPSDevice!]!` chain nulls to
  root → `data:null` + `errors[]`. Real apcaccess values are numeric-leading so this
  is unlikely, but it lands in the same `catch` → `toolError`.

The tool description notes an error here usually means no UPS attached / apcupsd not
running (not a server failure); the error **text** stays the raw propagated message so
a genuine transport error is not mislabeled.

### Fields that are not real telemetry
- **`battery.health` is an unconditional `'Good'` literal** (`ups.resolver.ts:33`) —
  there is no battery-health source key at all; it can never read "Replace"/"Unknown".
  The SDL description claiming those values is a lie. **Omitted from the query entirely.**
- **Partial data with a real MODEL** (e.g. COMMLOST, where `STATUS` is present so the
  *status* is real, but battery/power keys may be omitted and thus defaulted) is **not
  client-detectable** — we surface the real `status` (which would itself be troubled)
  and carry a description caveat that battery/power values may be upstream defaults when
  apcaccess data is incomplete. We never assert authority over individual scalars.
- **`status` is a free-form `String`**, not an enum — passthrough; don't validate
  against the six documented examples (apcaccess can emit `ONLINE`/`ONBATT`/`COMMLOST`/
  compound flags). A reported `'Online'` may be the default (see Outcome B).
- **`nominalPower`/`currentPower` null is the COMMON case** (most consumer/USB UPSes
  don't emit `NOMPOWER`); they are the only nullable selected scalars and move together.
  Treat null as normal — omit the watts note, never an error.
- **`estimatedRuntime`** = `TIMELEFT` minutes × 60 = **seconds** (conversion correct,
  matches the SDL "Unit: seconds"). `chargeLevel`/`loadPercentage` are `parseInt`-
  truncated from fractional percent (99.7 → 99) — don't present as exact.

### RBAC (confirmed)
The UPS resolver carries **no `@UsePermissions`** (unlike metrics/settings/vars/docker).
The global `nest-authz` `AuthZGuard` does `if (!permissions) return true` for an
undecorated handler → **default-ALLOW**: UPS reads are reachable by **any authenticated
key** (no role/scope required), though authentication is still required (no `@Public`).
The description states no special permission is needed; this is **version-fragile**
(an upstream oversight) — pin to v4.35.0 and re-verify if upstream adds a decorator.

## Tool design — `ups_status` (read-only)

- **Input:** `response_format: "concise" | "detailed"` (default `concise`). No other
  params — battery + power come from one cheap `apcaccess` call.
- **Operation** (`ups-status.graphql`) — `health` deliberately not selected:
  ```graphql
  query UpsStatus {
    upsDevices {
      id
      name
      model
      status
      battery { chargeLevel estimatedRuntime }
      power { inputVoltage outputVoltage loadPercentage nominalPower currentPower }
    }
  }
  ```
- **Handler flow:**
  1. `execute` → on throw (Outcome C) → `toolError("Failed to fetch UPS status: <msg>")`.
  2. Defensive empty guard: `upsDevices.length === 0` → "No UPS devices reported."
     (upstream can't currently produce this — documented as defensive against
     `[UPSDevice!]!` ever changing; cheap and tested).
  3. **No-data suppression (Outcome B, gated):** identity-pair sentinel **AND**
     `status === 'Online'` → `formatResponse(format, PLACEHOLDER_NOTE, { upsDetected:
     false, note: PLACEHOLDER_NOTE, placeholderPayload: data })`. No healthy claim.
  4. **Identity-placeholder + alert status:** identity-pair sentinel but `status !==
     'Online'` → `summarize(data)` **with the no-identity caveat appended** (status
     shown); detailed → raw `data`.
  5. Otherwise (Outcome A, real device) → `formatResponse(format, summarize(data), data)`.
- **`summarize()`** (pure, per device): `<name> (<model>) — <status> · battery
  <chargeLevel>% · ~<runtime> left · load <loadPercentage>%<watts note>`. Runtime
  humanized from seconds via named `SECONDS_PER_MINUTE`/`MINUTES_PER_HOUR` constants
  (no magic numbers). Watts note `(<currentPower>W / <nominalPower>W)` omitted when
  null.
- **detailed:** full JSON payload via `formatResponse` (voltages + watts in full;
  `health` absent).
- **Annotations:** `readOnlyHint: true, destructiveHint: false, openWorldHint: false`.
- **Description:** read-only live UPS telemetry; error usually means no UPS / apcupsd
  down; any authenticated key (no special permission); battery/power values may be
  upstream defaults when apcaccess data is incomplete.

## Architecture

- **Directory:** `src/tools/ups/` — `ups-status.ts` (1 `.ts`; colocated `.graphql` +
  `.test.ts` don't count). Fresh directory, no cap concern.
- **Shared reuse:** `GraphQLExecutor`; `_shared/respond.ts`
  (`formatResponse`, `toolError`, `ResponseFormat`). No `confirm.ts` (read-only).
- **Codegen:** per-tool `.graphql` → `npm run generate` → single committed
  `src/types/unraid/graphql.ts`. Fixtures use `satisfies UpsStatusQuery`.
- **Registry:** `registerUpsStatus(server, client)` in `registry.ts` with `@returns`
  JSDoc; `registry.test.ts` count (30 → 31) + name assertions. README documents it.

## Error handling

- Handler wraps `execute` in try/catch → `toolError("Failed to fetch UPS status:
  <message>")`. Client throws `UnraidApiError` (joined `errors[]`); partial data
  discarded — schema nullability is not a degradation path. Both Outcome-C sub-cases
  (blank-stdout throw, NaN serialize throw) land here.
- The placeholder (Outcome B) is a **success** result, not an error — surfaced via the
  honest no-data text, never as a healthy reading.

## Testing

Hermetic, `satisfies UpsStatusQuery` fixtures, fakes from `_shared/test-support.ts`.

- On-battery real device → concise asserts `status`, charge%, runtime, load%.
- Online real device → concise.
- **No-data suppression** (`name:'My UPS', model:'APC Back-UPS Pro 1500', status:'Online'`)
  → both formats report the no-live-data note, NOT a healthy reading; detailed carries
  `upsDetected:false` + raw payload.
- **Identity-placeholder + alert status** (same name/model but `status:'ONBATT'`) → the
  status is **shown** (not suppressed) with the no-identity caveat — the alert is never
  hidden.
- Runtime humanization: seconds → minutes and minutes→hours boundaries.
- Null `nominalPower`/`currentPower` (the common case) → watts note omitted.
- Empty array → "No UPS devices reported." (defensive guard).
- `detailed` (real device) → JSON payload; asserts `health` absent.
- Error path (`throwingExecutor`) → `toolError`; `String(error)` branch
  (`rejectingExecutor`).
- `recordingExecutor` asserts the typed `UpsStatusDocument` is dispatched.

## Source-validation — resolved (revision 1)

Focused Workflow over unraid/api @ `264ddf0` (7 adversarial verifiers + completeness
critic). Net changes from validation:
- **New:** Outcome B (phantom-healthy device) + the identity-pair sentinel detection —
  the load-bearing honesty change. `throw-on-no-data` was **PARTIAL**: the throw is
  guaranteed only for blank stdout / missing binary, not "every no-UPS box."
- **Confirmed:** `health` hardcoded `'Good'` (omit); RBAC default-allow / any
  authenticated key; `status` free-form String; runtime conversion correct; no
  caching (live reading valid; 10 s apcaccess timeout the only latency caveat).
- **Reinforced defer:** `device` config field can embed an SNMP community credential;
  `configureUps` is destructive-tier and ungated upstream.
- **Critic-surfaced:** NaN serialize → total query failure (Outcome C sub-case);
  `nominalPower`/`currentPower` null is the common case; parseInt truncates fractional
  percent.

## Release gate

Source-validated against `unraid/api @ 264ddf0` (v4.35.0) + `main`. **NOT
live-verified against a real Unraid box** — flagged in the PR body, consistent with
PRs #1–#9.
