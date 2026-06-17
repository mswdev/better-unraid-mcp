# UPS Domain Tool — Design (PR #10)

**Date:** 2026-06-16
**Branch:** `feature/ups-tools` (off `develop`)
**Status:** Approved — **source-validation pending** (revision 0)
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
- **Drop `upsDeviceById`.** Pure redundancy: the box always reports a single UPS,
  `id == model`, and `upsDeviceById` calls the *same* `getUPSData()` then filters by
  id — it adds an arg and a round-trip for zero new information.
- **Defer `Mutation.configureUps`.** It is **destructive-tier**, not a plain
  settings-write: `configureUPS` stops the apcupsd daemon, rewrites
  `/etc/apcupsd/apcupsd.conf`, **edits `/etc/rc.d/rc.6`** (the system shutdown script,
  to toggle UPS killpower), then restarts the daemon
  (`ups.resolver.ts:85-94`, `ups.service.ts` `configureUPS`/`modifyRc6File`). Editing
  the shutdown script is off the read-only roadmap and carries real blast radius.
  Deferred with `upsConfiguration`.
- **Defer the `upsConfiguration` read.** Low value with no write to pair it, and it
  surfaces operational detail (device paths, NIS network-server mode/IP) for no triage
  benefit. Revisit if/when a UPS settings-write PR is scoped.

## Upstream semantics (verified at 264ddf0; re-confirm adversarially in source-validation)

The value of the tool is the `status` field (`Online` / `On Battery` / `Low Battery`
/ `Replace Battery` / `Overload` / `Offline` — a free-form `String`, not an enum). Two
upstream behaviors make parts of the payload **confidently dishonest**, and both land
on triage-relevant fields. The design handles each.

1. **No data → throws (not empty).** `getUPSData()` runs `execa('/sbin/apcaccess')`
   with `reject:false`; if stdout is blank it **throws** `Failed to get UPS data: No
   UPS data returned from apcaccess` (`ups.service.ts:50-67`). So on a box with no UPS,
   no apcupsd, or the binary missing, `upsDevices` **errors** — it never returns `[]`.
   Our client maps that to `UnraidApiError`. **Design:** let the error propagate to
   `toolError`; the tool *description* states an error here usually means no UPS is
   attached or apcupsd is not running (not a server failure). The error *text* stays
   the raw propagated message so a genuine transport error is not mislabeled "no UPS".
2. **Partial data → phantom-healthy device.** `createUPSDevice` fabricates per-field
   defaults when apcaccess omits a key: `status || 'Online'`, `chargeLevel || 100`,
   `loadPercentage || 25`, voltages `|| 120.5`, `model || 'APC Back-UPS Pro 1500'`,
   `name || 'My UPS'`, `TIMELEFT || 60`min (`ups.resolver.ts:17-44`). A comm-lost UPS
   can therefore render as perfectly healthy. We **cannot** detect this client-side
   (the resolver applies defaults before we see the data) → **documented caveat only**;
   we do not assert authority over individual values beyond what the API returns.
3. **`battery.health` is a hardcoded `'Good'` literal** (`ups.resolver.ts:32`), never
   derived — the SDL/model description claiming `Good`/`Replace`/`Unknown`
   (`ups.model.ts`) is a lie. **Design:** omit `health` from the query selection
   entirely (same treatment as backup's non-functional fields). It is never fetched,
   never rendered, never in the detailed JSON.
4. **Single UPS, always.** `upsDevices` returns `[createUPSDevice(...)]` — exactly one
   element, never empty, never multiple (`ups.resolver.ts:47-51`). `summarize()` still
   handles 0/1/many defensively (a cheap honest guard if the assumption ever changes),
   but the normal shape is one device.
5. **`id` round-trip is internally consistent.** `id`, `name`, `model` all derive from
   `MODEL` (or the `'ups1'`/`'My UPS'`/model fallbacks). No read→write round-trip
   concern since no write ships.

## Tool design — `ups_status` (read-only)

- **Input:** `response_format: "concise" | "detailed"` (default `concise`). No other
  params — battery + power come from one cheap `apcaccess` call, so there is no
  expensive opt-in field like `system_metrics`' temperature probe.
- **Operation** (`ups-status.graphql`):
  ```graphql
  query UpsStatus {
    upsDevices {
      id
      name
      model
      status
      battery { chargeLevel estimatedRuntime }   # health omitted — always 'Good' upstream
      power { inputVoltage outputVoltage loadPercentage nominalPower currentPower }
    }
  }
  ```
- **Output** — `summarize()` is a pure function over the device array:
  - **concise** (per device): `<name> (<model>) — <status> · battery <chargeLevel>% ·
    ~<runtime> left · load <loadPercentage>%<power note>`. `estimatedRuntime` is in
    **seconds** → humanized to min/hr via a named `SECONDS_PER_MINUTE` constant (no
    magic numbers). The watts note `(<currentPower>W / <nominalPower>W)` is omitted
    when `nominalPower`/`currentPower` are null.
  - **empty array** (defensive, not expected): "No UPS devices reported."
  - **detailed:** full JSON payload via `formatResponse` — surfaces voltages and
    nominal/current watts in full.
- **Annotations:** `readOnlyHint: true, destructiveHint: false, openWorldHint: false`.
- **Description:** states it is read-only live UPS telemetry; that an error usually
  means no UPS attached / apcupsd not running; and the required RBAC permission
  (**TBD — resolved in source-validation**, see below).

## Architecture

- **Directory:** `src/tools/ups/` — `ups-status.ts` (1 `.ts`; colocated `.graphql` +
  `.test.ts` do not count toward the 10-file cap). Fresh directory, no cap concern.
- **Shared reuse:** `GraphQLExecutor`; `_shared/respond.ts`
  (`formatResponse`, `toolError`, `ResponseFormat`). No `confirm.ts` (read-only).
- **Codegen:** per-tool `.graphql` operation → `npm run generate` → single committed
  `src/types/unraid/graphql.ts`. Fixtures use `satisfies UpsStatusQuery`.
- **Registry:** `registerUpsStatus(server, client)` added to `registry.ts` with
  `@returns` JSDoc; `registry.test.ts` count (30 → 31) + name assertions updated.
  README documents the tool.

## Error handling

- Handler wraps `execute` in try/catch → `toolError("Failed to fetch UPS status:
  <message>")`. The client throws `UnraidApiError` (joined `errors[]`); partial data is
  discarded — schema nullability is not a degradation path.
- The no-UPS / apcupsd-down throw flows through this same path; the tool description
  (not the error text) carries the "likely means no UPS" interpretation.

## Testing

Hermetic, `satisfies UpsStatusQuery` fixtures, fakes from `_shared/test-support.ts`.

- On-battery device → concise asserts `status`, charge%, runtime, load%.
- Online device → concise.
- Runtime humanization: seconds → minutes and minutes→hours boundaries.
- Null `nominalPower`/`currentPower` → watts note omitted.
- Empty array → "No UPS devices reported." (defensive guard).
- `detailed` → output is the JSON payload; asserts `health` is absent.
- Error path (`throwingExecutor`) → `toolError`.
- `String(error)` coercion branch (`rejectingExecutor`).
- `recordingExecutor` asserts the typed `UpsStatusDocument` is dispatched.

## Source-validation — TODO (next pipeline step)

Focused Workflow over unraid/api @ `264ddf0` (adversarial-verify each assumption +
completeness critic), then reconcile into this doc as **revision 1** before planning:

1. **Throw semantics:** confirm `getUPSData()` throws (not returns `[]`/null) on
   blank/absent apcaccess output, and the exact error string.
2. **Partial-data fabrication:** confirm `createUPSDevice` applies the per-field
   defaults listed above (so the phantom-healthy caveat is accurate).
3. **RBAC default:** the UPS resolver has **no `@UsePermissions`** (unlike
   metrics/settings/vars/docker). Confirm what the global GraphQL auth guard does for
   an *undecorated* query — allow (public) or default-deny — so the description states
   the real permission requirement.
4. **`status` value domain:** confirm the documented values are descriptive examples,
   not an enforced enum (it is a `String`), so the tool never assumes a closed set.
5. **`upsConfiguration` safety** (informational, defer-confirming): confirm it returns
   `{}`→all-null when the config file is missing (does not throw), and that the
   deferred fields include device paths / NIS network mode — no credential content.
6. **Completeness critic:** what UPS behavior is unverified or could change the read
   shape (e.g. multiple-UPS support landing, `id` derivation)?

## Release gate

Source-validated against `unraid/api @ 264ddf0` (v4.35.0) + `main`. **NOT
live-verified against a real Unraid box** — flagged in the PR body, consistent with
PRs #1–#9.
