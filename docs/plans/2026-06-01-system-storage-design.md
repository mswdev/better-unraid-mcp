# better-unraid-mcp — System & Storage Tools Design (PR #2)

**Date:** 2026-06-01
**Author:** Matt White (mswdev)
**Status:** Approved — ready for implementation planning
**Branch:** `feature/system-storage-tools` → draft PR into `develop`

## Goal

Grow the first real domain of read-only tools onto the merged scaffold: the
**system & storage** picture (array/parity health, physical disks, user
shares). All tools are read-only — this PR introduces no destructive operations
(those land with Docker/VM domains later) and validates the consolidated,
resource-namespaced tool design at slightly larger scale before the confirm-gate
is needed.

## Decisions carried in

- **Naming convention: resource-first** (`<resource>_<action>`), standardized
  across the project. The scaffold's `get_system_info` is renamed to
  `system_info` for consistency (pre-1.0, develop-only — safe).
- **Approach A — resource-consolidated** (chosen over finer-grained splits and a
  storage mega-tool): one tool per resource-question, each consolidating the
  relevant fields and concise-by-default.
- Reuse every established pattern: the `GraphQLExecutor` seam, `response_format`
  concise/detailed via `_shared/respond.ts`, `readOnlyHint` annotations,
  vendored SDL + graphql-codegen single committed types file, hermetic tests
  with hand-written fakes.

## Tools (4 new + 1 rename)

| Tool | Source | Concise summary | Detailed |
|------|--------|-----------------|----------|
| `system_info` | rename of `get_system_info` | (unchanged) | (unchanged) |
| `array_status` | `array { state, capacity, parityCheckStatus, parities, disks, caches }` | state, capacity %, parity status, count of OK vs problem disks | full per-disk list (status, temp, fs used, errors, spinning) |
| `parity_history` | `parityHistory` (optional `limit`, default 5) | last check: date, status, errors, speed | list of recent checks |
| `disk_list` | `disks` (physical `Disk`) | one line per disk: model, size, `smartStatus`, °C, interface | full disks incl. partitions, serial, firmware |
| `share_list` | `shares` (optional `name` filter) | name + used/total per share | full shares incl. include/exclude disks, cache, comment |

All four new tools: `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: true`.

`parity_history` is the most optional tool but is kept — it is a distinct
question from `array_status` (history vs current state) and cheap.

Bounded-set note: Unraid has at most dozens of disks/shares, so `disk_list` /
`share_list` returning the full set (concise by default) is appropriate rather
than forcing a search interface; the optional `share_list` `name` filter covers
"show me share X".

## Placement

```
src/tools/
  system/system-info.ts          # renamed from get-system-info.*
  system/system-info.graphql
  system/system-info.test.ts
  array/array-status.{ts,graphql,test.ts}
  array/parity-history.{ts,graphql,test.ts}
  disk/disk-list.{ts,graphql,test.ts}
  share/share-list.{ts,graphql,test.ts}
  _shared/format-bytes.ts        # + .test.ts (new)
  registry.ts                    # registers all 5 tools
```

One domain directory per resource (≤10 files/dir, colocated tests). `registry.ts`
imports each domain's `register*` and calls all five.

## Units (the one real implementation detail)

Sizes arrive in mixed units across the schema:

- `ArrayDisk` (`size`, `fsFree`, `fsUsed`) and `Share` (`free`, `used`, `size`):
  **KB**, scalar **`BigInt`**.
- physical `Disk.size`: **bytes**, scalar **`Float`**.
- `array.capacity` (`free`/`used`/`total`): **String** (KB).

Therefore:

1. Map the `BigInt` scalar in `codegen.ts` (currently unmapped → falls to
   `defaultScalarType: "unknown"`) to **`string`** — Unraid serializes `BigInt`
   as a JSON string to preserve precision. Strings are parsed where arithmetic
   is needed (capacity %, humanization).
2. Add `src/tools/_shared/format-bytes.ts` — a small helper that converts a
   KB or byte count to a human string (`1.8 TB`, `512 GB`), with its own unit
   tests. Concise summaries use it; detailed output returns the raw payload.

## Error handling & nullability

Same as the scaffold: each handler wraps its `client.execute` in try/catch and
returns `toolError(...)` on failure. Many `ArrayDisk` fields are nullable, and
`temp` is `NaN`/null when the array is **stopped** — `summarize()` guards every
nullable field with fallbacks, and tests cover a stopped-array payload.

## Testing

Hermetic, hand-written fake `GraphQLExecutor` per tool returning canned
array/disk/share payloads (typed via `satisfies <Operation>Query` so codegen
drift breaks the build). Each tool covers: concise summary content, detailed
JSON, null/stopped-array fallbacks, and the error path. `format-bytes` gets
dedicated unit tests (KB/bytes boundaries, zero, large TB values).

## Rename ripple

`get_system_info` → `system_info`: rename the files (`system/system-info.*`),
the exported `register*`/handler symbols, the MCP tool name, the `.graphql`
operation (`query SystemInfo`), and update `registry.ts`, the tool's test, and
the README tool list + status. No behavior change beyond the name.

## Out of scope (future PRs)

Destructive operations (array start/stop, parity check control), Docker, VMs,
notifications, rclone, live subscriptions. The confirm-gate helper stays unused
until the first destructive domain.

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, plus codegen
idempotency (`npm run generate` leaves no diff).
