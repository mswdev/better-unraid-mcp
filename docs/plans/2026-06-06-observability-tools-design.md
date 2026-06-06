# System Observability Tools — Design (PR #8)

**Date:** 2026-06-06
**Branch:** `feature/observability-tools` (off `develop`)
**Status:** Approved (brainstorming); pending source-validation reconciliation
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

## Decisions (settled in brainstorming)

1. **`log_read` security stance: preflight allowlist.** Before each `logFile`
   call, fetch `logFiles` and require the requested `path` to match a listed
   file's `path` or `name`; otherwise refuse client-side with the valid names.
   Rationale: upstream confines reads via `join(logBasePath, basename(path))`
   at the pinned version — traversal is structurally impossible **today** —
   but that is an implementation detail, not a schema contract. The allowlist
   exactly matches upstream's real capability surface (flat files in
   `/var/log`), survives upstream regression, and keeps `readOnlyHint: true`
   honest. Cost: one extra cheap readdir-backed query per read.
2. **`systemTime` folds into `system_metrics`; `Query.online` is cut.**
   A metrics snapshot stamped with server time has direct triage value
   (correlating log timestamps, spotting NTP drift). `online: Boolean!` is
   tautological — any successful response proves the API is online.
3. **`service_list` is cut.** Source reading shows `Query.services` is
   vestigial: at most two synthetic entries (`unraid-api`, always
   `online: true`, version = API version, uptime = API process boot time;
   plus `dynamic-remote-access` when Connect is configured). It is not a
   system-service inventory. Revisit if upstream ever populates real services.
4. **Out of scope:** UPS (`upsDevices`/`upsConfiguration` — niche),
   all writes (`updateSystemTime`, `updateTemperatureConfig`, `configureUps`),
   `Subscription.logFile` (no subscription transport).
5. **Caps:** `DEFAULT_LINES = 100` (mirrors the upstream resolver default, so
   omission means the same thing at both layers); `MAX_LINES = 2000`
   (consistent with `docker_container_logs` `MAX_TAIL`).

## Source findings already validated (front-run during brainstorming)

From `api/src/unraid-api/graph/resolvers/logs/logs.service.ts`,
`logs.resolver.ts`, `metrics/metrics.resolver.ts`,
`services/services.resolver.ts` at the pin:

- `logFile` **tails by default**: `getLogFileContent(path, lines = 100,
  startLine?)` calls `readLastLines` when `startLine` is omitted, and the
  response `startLine` is always computed (`max(1, totalLines − lines + 1)`)
  — `log_read` is a thin wrapper; no probe-then-read needed.
- `logFile` path handling: `join(logBasePath, basename(path))`; log base is
  `getters.paths()['unraid-log-base']` = `/var/log` (env-overridable).
  Subdirectory logs are unreachable upstream (basename strips directories).
  Nonexistent file → resolver throws → GraphQL `errors[]` → our client throws
  `UnraidApiError` → `toolError`.
- `logFiles` lists only direct children of `/var/log` that are files
  (`stat.isFile()`, follows symlinks), and **swallows errors into `[]`**.
- RBAC: `logFiles`/`logFile` = `LOGS`/`READ_ANY`; `metrics` = `INFO`/
  `READ_ANY` — viewer-readable, not ADMIN.
- `metrics.cpu/memory/network/temperature` are **live probes per query**
  (ResolveFields calling `generateCpuLoad()` / `generateMemoryLoad()` /
  `getNetworkMetrics()` / `temperatureService.getMetrics()`) — no
  store-snapshot staleness. `temperature` legitimately returns null when
  collection is disabled.

## Tool designs

### `log_list`

- **Inputs:** `response_format: concise|detailed` (default concise).
- **Query (`log-list.graphql`):** `logFiles { name path size modifiedAt }`.
- **Concise:** sorted `modifiedAt` desc (most recently active first), one line
  per file: `syslog — 1.2 MiB, modified 2026-06-06T11:58Z` (via
  `formatBytes`). Empty: "No log files found (the API also returns an empty
  list when the log directory is unreadable)." — upstream swallows errors.
- **Detailed:** the sorted JSON array.

### `log_read`

- **Inputs:**
  - `path: string` — full path or bare name, as returned by `log_list`.
  - `lines: int > 0, max MAX_LINES, default DEFAULT_LINES`.
  - `start_line: int > 0` optional — 1-indexed; omitted = tail.
  - `response_format`.
- **Flow:** ① `LogReadAllowlist` (`logFiles { name path }`); match input
  against `path` or `name`; miss → `toolError` naming valid files (client-side
  refusal, not an exception). ② `LogReadContent`
  (`logFile(path: <canonical>, lines, startLine) { path content totalLines startLine }`).
  Both operations live in `log-read.graphql`.
- **Concise:** header + paging hints + raw content:

  ```
  syslog — lines 5832–5931 of 5931
  — earlier: re-call with start_line=5732
  <raw lines>
  ```

  Later-hint when the window stops before EOF. Explicit messages for an empty
  file and `start_line` past EOF.
- **Detailed:** JSON `{ path, content, totalLines, startLine }`.
- **Documented caveat:** the cap bounds line *count*, not bytes (same property
  as `docker_container_logs`).

### `system_metrics`

- **Inputs:** `response_format` only.
- **Query (`system-metrics.graphql`), one document, two root fields:**

  ```graphql
  metrics {
    cpu { percentTotal cpus { percentTotal } }
    memory { total used free available percentTotal swapTotal swapUsed percentSwapTotal }
    temperature {
      sensors { name type location current { value unit status } warning critical }
      summary { average warningCount criticalCount hottest { name current { value unit } } }
    }
    network { name operstate rxSec txSec utilizationPercent bytesReceived bytesSent
              receiveErrors transmitErrors receiveDropped transmitDropped lastUpdated }
  }
  systemTime { currentTime timeZone useNtp }
  ```

- **Deliberately excluded:** `sensors.history`/`min`/`max` (unbounded/noise),
  per-core user/system split (token bloat on high-core-count boxes), packet
  counters (errors/drops cover triage), `ntpServers`, `id` fields.
- **Concise (~6 lines, per-section null fallbacks):**

  ```
  As of 2026-06-06T12:00:08Z (America/New_York, NTP on):
  CPU: 12% total, 24 cores (busiest core 45%)
  Memory: 45% — 14.2 GiB used of 31.4 GiB (swap 0%)
  Temperature: avg 42°C — 0 warning, 0 critical (hottest: CPU Package 55°C)
  Network: eth0 up — rx 1.2 MB/s, tx 340 kB/s, 0 errors
  ```

  Null `cpu`/`memory`/`temperature` → `"<section>: unavailable"`.
- **Detailed:** the full JSON payload.

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
- Codegen: `npm run generate` after adding the `.graphql` files; single
  committed `graphql.ts`.

## Error handling

- Convention: `catch` → `toolError("Failed to <verb>: ${message}")`.
- Allowlist miss → client-side refusal listing valid names.
- `log_list` empty-vs-error ambiguity documented in the tool description.
- **Known risk (validation item):** the GraphQL client throws on any
  `errors[]`, so a *throwing* (vs null-returning) metrics section probe fails
  the whole `system_metrics` call. If validation shows temperature (or any
  section) is throw-prone, fallback design: split it into a second,
  failure-tolerated document.

## Testing

Hermetic, per convention (`_shared/test-support.ts` fakes; `satisfies
<Op>Query` fixtures):

- `log_list`: newest-first sort, byte formatting, empty-list message, executor
  error → toolError, detailed passthrough.
- `log_read`: allowlist hit by path / by name / miss (error lists names);
  tail-default header math; earlier/later paging hints; window at file start
  (no earlier hint); `start_line` past EOF; empty file; preflight failure vs
  content-fetch failure (`sequencedExecutor`); zod cap/default enforcement.
- `system_metrics`: full-snapshot summary; each nullable section → 
  "unavailable" line; zero interfaces; error path; detailed passthrough;
  pinned detailed payload (PR #7 review lesson — pin it from the start).
- `registry.test.ts`: tool count + names.
- Gate: `npm run typecheck && npm run build && npm test && npm run lint`,
  codegen idempotency, stdio initialize → tools/list smoke via the MCP SDK
  client.

## Remaining validation questions (workflow before writing-plans)

1. Can each metrics section probe **throw** (vs return null)? Under what
   conditions does `temperature` null vs throw? (Drives the split-document
   fallback.)
2. Is every selected field actually populated at the pin — `CpuLoad`
   per-core values, `network` fields (`utilizationPercent` nullable — when?),
   `temperature.summary` (the parityCheckStatus lesson)?
3. `logFiles` symlink/rotated-file semantics in `/var/log` on a real box —
   anything surprising in what gets listed?
4. `systemTime` resolver: RBAC, feature flags, data source.
5. Feature flags (`@UseFeatureFlag`) on any in-scope query; failure mode for
   an under-privileged API key.
6. Huge-file behavior: `countFileLines` streams the whole file per `logFile`
   query (server-side O(file size) I/O, bounded memory) — confirm acceptable;
   any upstream size guard?

Findings reconcile into this doc at a revision checkpoint before
`writing-plans`.

## Release gate

This PR ships **source-validated** behavior only (unraid/api @ `264ddf0`,
v4.35.0). Nothing is live-verified against a real Unraid box; the PR body
must carry this flag (standing gate tracked since PR #7).
