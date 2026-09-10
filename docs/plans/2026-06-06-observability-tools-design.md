# System Observability Tools — Design (PR #8)

**Date:** 2026-06-06
**Branch:** `feature/observability-tools` (off `develop`)
**Status:** Approved + source-validation reconciled (revision 2)
**Validation pin:** unraid/api @ `264ddf0` (v4.35.0) — source-validated only, **NOT live-verified**

## Goal

Complete the triage story started by `notification_alerts`: an alert fires → the
model reads metrics and greps logs. Three read-only tools over the Unraid
GraphQL observability surface:

| Tool | Query root | Purpose |
|------|-----------|---------|
| `log_list` | `logFiles` | Inventory of log files (name, size, modified) |
| `log_read` | `logFile(path, lines, startLine)` | Tail or window one log file |
| `system_metrics` | `metrics` + `systemTime` | Point-in-time health snapshot |

## Decisions (settled in brainstorming; revised after source validation)

1. **`log_read` security stance: preflight allowlist.** Before each `logFile`
   call, fetch `logFiles` and require the requested `path` to match a listed
   file's `path` or `name`; otherwise refuse client-side with the valid names.
   **Validated guarantee level (revision 2):** upstream normalizes with
   `join(logBasePath, basename(path))` — string traversal and absolute paths
   are neutralized, but **symlinks inside the log dir are followed** (no
   `lstat`/`realpath`/containment check), and the base dir is env-overridable
   (`PATHS_UNRAID_LOG_BASE`). The allowlist therefore guarantees *"a filename
   listed by `logFiles`"*, *not* the resolved target file; a symlink swapped
   between preflight and read (TOCTOU) is upstream's exposure and cannot be
   closed client-side. The allowlist still exactly matches upstream's real
   capability surface, survives upstream regression, and keeps
   `readOnlyHint: true` honest. Tool description states the guarantee
   honestly.
2. **`systemTime` folds into `system_metrics`; `Query.online` is cut.**
   A metrics snapshot stamped with server time has direct triage value.
   `online` is tautological. Validated RBAC note: `systemTime` is
   `VARS`/`READ_ANY` while `metrics` is `INFO`/`READ_ANY` — one document
   couples the two, but ADMIN/VIEWER/CONNECT roles all hold both (GUEST holds
   neither), so the coupling only bites exotic direct-permission keys.
   Documented, accepted.
3. **`service_list` is cut.** `Query.services` is vestigial upstream: at most
   two synthetic entries (`unraid-api`, always `online: true`; plus
   `dynamic-remote-access` when Connect is configured). Revisit if upstream
   ever populates real services.
4. **Out of scope:** UPS, all writes, `Subscription.logFile`.
5. **Caps:** `DEFAULT_LINES = 100` (mirrors the upstream resolver default);
   `MAX_LINES = 2000` (consistent with `docker_container_logs`). Validated:
   the server applies **no** range validation and **no** upper bound on
   `lines` — the client caps are load-bearing.
6. **Temperature is opt-in (revision 2):** `include_temperature: boolean`
   defaulting to **false**, implemented with a single document and
   `@include(if: $includeTemperature)`. Rationale: cold temperature probes
   exec `smartctl` per disk with **no timeout** (lm_sensors/ipmi are capped at
   3 s each; the disk path is unbounded), and our client has no timeout — a
   default-on selection could hang the triage tool for many seconds on a cold
   multi-disk box. Temperature itself is safe (never throws; degrades to
   null). The description tells the model to pass `true` when chasing thermal
   alerts and warns it may be slow.

## Validated findings (unraid/api @ 264ddf0 — 6 areas, adversarially verified + completeness critic)

### Logs
- `logFile` **tails by default**: `lines` defaults to 100; omitted
  `startLine` → last-N-lines mode. The response `startLine` is reliable in
  tail mode (verifier re-derived the algebra: reported value equals the
  actual first emitted line in all cases); in position mode it echoes the
  caller's value verbatim (even 0/negative — we clamp ≥ 1 client-side).
- Out-of-range arguments never throw: `lines <= 0` → empty content;
  `startLine` past EOF → empty content with real `totalLines`. Zod guards
  (positive ints) prevent dispatching the confusing cases.
- Errors are a single string `"Failed to read log file: <node fs error>"`
  (ENOENT/EACCES/EISDIR indistinguishable except by substring; the resolved
  absolute path is embedded). Allowlist makes these rare; `toolError`
  surfaces them as-is.
- Cost model: a tail query streams the **whole file three times** upstream
  (two line-counts + content pass), unbounded memory only for the requested
  slice. No server-side size guard. Three passes at three instants → on
  fast-growing logs, `totalLines`/`startLine`/content can be mutually
  inconsistent. Documented in the tool description.
- Content normalization: non-empty content always ends with exactly one
  `\n`; CRLF is normalized to LF; a missing final newline is not detectable.
- `logFiles` lists only direct children of the log dir that pass
  `stat().isFile()` (symlinks followed), **swallows errors into `[]`**, and
  `size`/`modifiedAt` are live stat data. Round-trip validated: passing a
  listed `path` back into `logFile` resolves to the same file; allowlist
  matching must compare on listed `path` or `name` (basename) since the
  server collapses any input to its basename.
- Log content is read live from disk per query — no store snapshot.

### Metrics
- `Query.metrics` returns only `{ id }`; **each section is a ResolveField
  executed only when selected** — selecting a subset runs exactly that
  subset. This makes the `@include` opt-out effective.
- **Per-section null degradation is real only for temperature** (its service
  catches everything and returns null — disabled poller, no sensors, probe
  failure all → null, never throw). For cpu/memory/network: populated or the
  whole call fails — our client throws on any `errors[]`, so schema
  nullability is *not* a degradation path.
- cpu/memory effectively cannot throw at this pin (systeminformation never
  rejects; exec enrichment is try/caught). All `MemoryUtilization` fields are
  populated, units bytes. **`used` includes buffers/cache; `percentTotal` is
  pressure-based (`(total − available)/total`)** — the concise summary must
  pair `percentTotal` with `available`, never with `used`.
- network: normal path cannot reject; the residual risk is GraphQL
  serialization of non-finite values (`Math.floor(NaN)` on BigInt fields;
  `NaN ?? 0 === NaN` reaching non-null Float `rxSec`/`txSec`) on malformed
  system data — rare, fails the whole call, accepted and documented.
  `rxSec`/`txSec` are 0 (not null) on the first sample after API start —
  rates warm up; noted in description. Loopback and virtual interfaces are
  included as reported by systeminformation.
- temperature: when non-null, `sensors[]` is never empty and `summary` is
  always present. **`sensors[].location` is always null at the pin — dropped
  from the selection.** Value unit honors the configured default unit.
- `systemTime`: `currentTime` is the live OS clock at request time
  (ISO-8601 UTC); `timeZone`/`useNtp` come from the emhttp var store
  (config-level staleness only).

### RBAC / errors
- `logFiles`/`logFile` = `LOGS`/`READ_ANY`; `metrics` (+ all its
  ResolveFields, which carry no extra decorators) = `INFO`/`READ_ANY`;
  `systemTime` = `VARS`/`READ_ANY`. No feature flags on any in-scope query.
- Roles: ADMIN, VIEWER, CONNECT all hold LOGS/INFO/VARS `READ_ANY`; GUEST
  holds none of them. **A read-only VIEWER key suffices for all three
  tools** — documented.
- Under-privileged/missing key → HTTP 200 with `errors[]`
  (UnauthorizedException/ForbiddenException messages); our client throws →
  `toolError`. Do not match on `extensions.code` (library-default, not
  source-guaranteed at this pin) — message text only.

## Tool designs

### `log_list`

- **Inputs:** `response_format: concise|detailed` (default concise).
- **Query (`log-list.graphql`):** `logFiles { name path size modifiedAt }`.
- **Concise:** sorted `modifiedAt` desc, one line per file:
  `syslog — 1.2 MB, modified 2026-06-06T11:58Z` (via `formatBytes`). Empty:
  "No log files listed (the API returns an empty list when the log directory
  is unreadable, too)." — upstream swallows listing errors, so an empty
  result must not assert an empty directory.
- **Detailed:** the sorted JSON array.

### `log_read`

- **Inputs:**
  - `path: string` — full path or bare name, as returned by `log_list`.
  - `lines: int > 0, max MAX_LINES (2000), default DEFAULT_LINES (100)`.
  - `start_line: int > 0` optional — 1-indexed; omitted = tail.
  - `response_format`.
- **Flow:** ① `LogReadAllowlist` (`logFiles { name path }`); match input
  against listed `path` (exact) or `name` (basename); miss → `toolError`
  naming valid files (client-side refusal). ② `LogReadContent`
  (`logFile(path: <canonical listed path>, lines, startLine) { path content totalLines startLine }`).
  Both operations in `log-read.graphql`.
- **Concise:** header + paging hints + raw content:

  ```
  syslog — lines 5832–5931 of 5931
  — earlier: re-call with start_line=5732
  <raw lines>
  ```

  Later-hint when the window stops before EOF (`start_line` mode). Explicit
  messages for an empty file and `start_line` past EOF (upstream returns
  empty content, never throws). Header math may trust the server `startLine`
  (validated reliable in tail mode; clamped ≥ 1 in position mode by zod).
- **Detailed:** JSON `{ path, content, totalLines, startLine }`.
- **Description caveats:** cap bounds line *count*, not bytes; figures may
  drift on rapidly-growing logs (three-pass upstream read); reads are
  confined to filenames the server lists in its log directory (symlinked
  entries are read as the server resolves them).

### `system_metrics`

- **Inputs:** `response_format`; `include_temperature: boolean`, default
  **false** (see Decision 6).
- **Query (`system-metrics.graphql`), one document, two root fields:**

  ```graphql
  query SystemMetrics($includeTemperature: Boolean!) {
    metrics {
      cpu { percentTotal cpus { percentTotal } }
      memory { total used free available percentTotal swapTotal swapUsed percentSwapTotal }
      temperature @include(if: $includeTemperature) {
        sensors { name type current { value unit status } warning critical }
        summary { average warningCount criticalCount hottest { name current { value unit } } }
      }
      network { name operstate rxSec txSec utilizationPercent bytesReceived bytesSent
                receiveErrors transmitErrors receiveDropped transmitDropped lastUpdated }
    }
    systemTime { currentTime timeZone useNtp }
  }
  ```

- **Deliberately excluded:** `sensors.history`/`min`/`max`,
  `sensors.location` (always null at pin), per-core user/system split,
  packet counters, `ntpServers`, `id` fields.
- **Concise (~5–6 lines):**

  ```
  As of 2026-06-06T12:00:08Z (America/New_York, NTP on):
  CPU: 12% total, 24 threads (busiest 45%)
  Memory: 46% used — 17.0 GB available of 31.4 GB (swap 0%)
  Temperature: avg 42.1°C — 0 warning, 0 critical (hottest: CPU Package 55.5°C)
  Network: eth0 up — rx 1.2 MB/s, tx 340.0 KB/s, 0 errors
  ```

  Memory pairs `percentTotal` with `available` (validated: `used` includes
  cache and contradicts `percentTotal` — never render them together).
  **Temperature absent-vs-null distinction:** not requested (flag false) →
  omit the line entirely; requested but null → `Temperature: unavailable
  (no sensors or collection disabled)`. Null `cpu`/`memory` → 
  `"<section>: unavailable"` (defensive only — validated as effectively
  non-occurring).
- **Detailed:** the full JSON payload.
- **Description notes:** rates warm up after an API restart (first sample
  reads 0); temperature may take seconds on multi-disk boxes (opt-in flag).

## Architecture

```
src/tools/log/                  (new domain dir — singular, matches array/disk/vm)
  log-list.ts / .graphql / .test.ts
  log-read.ts / .graphql / .test.ts
src/tools/system/
  system-metrics.ts / .graphql / .test.ts   (joins system-info; dir at 2 source files)
src/tools/registry.ts           (+3 register calls — bundled into each tool's build task)
```

- Constants `DEFAULT_LINES`/`MAX_LINES` in `log-read.ts`; no magic numbers.
- All three tools: `annotations: { readOnlyHint: true, destructiveHint: false,
  openWorldHint: false }`.
- Codegen: `npm run generate`; single committed `graphql.ts` (note:
  `@include` makes `temperature` optional in the generated type — the
  absent-vs-null distinction flows from there).

## Error handling

- Convention: `catch` → `toolError("Failed to <verb>: ${message}")`. Match on
  message text only, never `extensions.code`.
- Allowlist miss → client-side refusal listing valid names.
- Permissions: a VIEWER (read-only) key suffices for all three tools (LOGS +
  INFO + VARS `READ_ANY`); GUEST keys fail with an auth error surfaced via
  `toolError`. Stated in the README/tool docs.
- Accepted residual risks (documented, no code): network NaN serialization
  fails the whole `system_metrics` call (rare, malformed system data);
  INFO/VARS coupling for exotic direct-permission keys.

## Testing

Hermetic, per convention (`_shared/test-support.ts` fakes; `satisfies
<Op>Query` fixtures):

- `log_list`: newest-first sort, byte formatting, empty-list message, executor
  error → toolError, detailed passthrough.
- `log_read`: allowlist hit by exact path / by bare name / miss (error lists
  names); tail-default header math; earlier/later paging hints; window at
  file start (no earlier hint); `start_line` past EOF (empty content
  message); empty file; preflight failure vs content-fetch failure
  (`sequencedExecutor`); zod cap/default/positivity enforcement.
- `system_metrics`: full snapshot summary; `include_temperature` false →
  temperature line omitted AND variable false in recorded request; true +
  null → "unavailable" line; true + populated → rendered; memory line uses
  available (never `used`); zero interfaces; error path; detailed
  passthrough; pinned detailed payload (PR #7 review lesson).
- `registry.test.ts`: tool count + names.
- Gate: `npm run typecheck && npm run build && npm test && npm run lint`,
  codegen idempotency, stdio initialize → tools/list smoke via the MCP SDK
  client.

## Release gate

This PR ships **source-validated** behavior only (unraid/api @ `264ddf0`,
v4.35.0). Nothing is live-verified against a real Unraid box; the PR body
must carry this flag (standing gate tracked since PR #7).
