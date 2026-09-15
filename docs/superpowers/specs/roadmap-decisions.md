# Roadmap Decision Log

Judgment calls made during the autonomous 0.0.4 → 0.0.9 roadmap run
(spec: `2026-09-14-competitive-roadmap-design.md`, §8). Each entry records
what was decided, why, alternatives considered, and whether owner input is
still wanted.

## Phase 1 — 0.0.4 "Safe by default"

### D1: connection_doctor reports static rate-limit configuration, not live headroom

- **Decided:** The doctor's rate-limit check reports the limiter's static
  configuration (90-request burst, 9/s refill) instead of live token counts.
- **Why:** Exposing live bucket state through the `GraphQLExecutor` seam would
  widen an interface every tool depends on, for one diagnostic line.
- **Alternatives:** A `getRateLimitState()` method on the executor interface
  (rejected: interface creep); a module-level singleton peek (rejected: hidden
  coupling).
- **Owner input:** Not needed. Revisit only if users ask for live headroom.
- **Pre-authorized:** Yes — this exact call was anticipated in the Phase 1 plan.

### D2: system_health parity-error fixture uses COMPLETED, numErrors as string

- **Decided:** The plan's illustrative fixtures used `status: "OK"` and numeric
  `numErrors`; the generated types define `ParityCheckStatus` without an `OK`
  member and `numErrors` as `string | null`. Fixtures were adjusted to
  `"COMPLETED"` and `"0"`, per the plan's own rule ("fix the FIXTURE ... never
  the generated type"). `healthyFixture()` is typed via an explicit
  `: SystemHealthQuery` return annotation (instead of `satisfies`) so tests can
  mutate one field at a time while keeping the codegen-drift tripwire.
- **Owner input:** Not needed.

## Phase 2 — 0.0.5 "Fast"

### D3: Snapshot-cache age travels via a WeakMap, not a mutated payload

- **Decided:** `CachingExecutor` stamps serve-age in a WeakMap read through
  `cacheAgeMs(data)`; the three hot tools add `data_age_ms` to their detailed
  payloads explicitly.
- **Why:** Injecting a `data_age_ms` field into the typed GraphQL payload
  would silently violate the generated types and surprise every consumer;
  the WeakMap keeps the executor honest and the field opt-in per tool.
- **Alternatives:** Mutating the payload (rejected: type lies); widening
  `GraphQLExecutor` with an envelope return (rejected: touches every tool).
- **Owner input:** Not needed.

### D4: shell_exec progress is a heartbeat, not real command progress

- **Decided:** `shell_exec` emits a periodic "still running" heartbeat (every
  5 s) rather than parsing command output for progress.
- **Why:** The executor collects output only at command completion; streaming
  partial output would change the `ShellExecutor` seam the spec says to keep.
  A heartbeat still gives clients liveness for long commands.
- **Owner input:** Not needed. Revisit if streaming output becomes a feature.

### D5: Session idle expiry fixed at 5 minutes, not configurable

- **Decided:** `SESSION_IDLE_EXPIRY_MS` is a named constant (300 000), swept
  every 60 s; no env knob.
- **Why:** The spec asked for "session map with idle expiry" without a knob;
  YAGNI until a user reports needing longer-lived idle sessions.
- **Owner input:** Not needed.

## Phase 3 — 0.0.6 "Modern MCP"

### D6: Elicitation channel is created per-registration from the McpServer

- **Decided:** Each gated tool's `registerX` builds the channel via
  `createElicitationChannel(server)` and passes it as an optional trailing
  factory parameter; capability detection happens lazily per call.
- **Why:** Register functions already receive the server; handler factories
  keep their fake-friendly signatures (tests omit the channel → argument
  path). Lazy `getClientCapabilities()` matters because capabilities are
  unknown until after initialization.
- **Alternatives:** Threading the channel through `RegistryOptions`
  (rejected: widens every registration for 14 consumers); reading
  elicitation support from `extra` (the SDK does not expose it there).
- **Owner input:** Not needed.

### D7: A cancelled elicitation counts as declined; a failed one falls back

- **Decided:** `cancel` and accept-with-false map to a refusal ("the user
  declined"); a thrown elicitation error maps to the argument-fallback path.
- **Why:** Cancel is a human choice — refusing is honest. A protocol error is
  an environment problem — punishing the model with a refusal it can never
  satisfy would be wrong, so it gets the classic instructions instead.
- **Owner input:** Not needed.

### D8: Structured content is redacted by JSON round-trip

- **Decided:** `formatStructuredResponse` redacts by
  `JSON.parse(redactSecrets(JSON.stringify(payload)))`.
- **Why:** Keeps the "no secrets in any output" guarantee for the new
  `structuredContent` channel with one implementation; the redactor already
  guarantees parseable JSON output.
- **Owner input:** Not needed.

## Phase 4 — 0.0.7 "Coverage: GraphQL"

### D9: rclone remotes + flash backup DESCOPED (spec item 4) ⚠ owner review

- **Decided:** Phase 4's "rclone remotes + flash backup" item ships nothing.
- **Why:** Validated upstream findings (2026-09-14, unraid/api v4.35.0 + main):
  `initiateFlashBackup` is a Not-implemented stub; rclone is disabled in
  production builds — `rclone.remotes` silently returns `[]` and the config
  mutations throw; the config reads that do work leak unredacted credentials.
  The same findings already removed backup scope from PR #9. Tools against a
  dead API would fail confusingly on every real server.
- **Alternatives:** Shipping the tools with "may not work" copy (rejected:
  guaranteed-broken is worse than absent); SSH-based flash backup via
  shell_exec guidance (already possible through the escape hatch).
- **Owner input:** WANTED — confirm the descope, and whether to add a
  post-roadmap reminder to revisit when upstream ships a working backup API.

### D10: Disk-op preconditions probe array state before mutating

- **Decided:** `array_disk_action` runs a 1-field array-state probe after the
  gate and refuses add/remove unless STOPPED, mount/unmount/clear unless
  STARTED, naming the actual state and the `array_action` fix.
- **Why:** The upstream error for wrong-state disk ops is unhelpful; the spec
  asked for precondition checks. Probing after the gate keeps declined calls
  free of any server traffic.
- **Owner input:** Not needed.

### D11: API key management is two tools, not five

- **Decided:** `apikey_list` (read) + consolidated `apikey_manage`
  (create/update/add_role/remove_role/delete), matching the owner's
  consolidated-workflow tool preference; list never selects the `key` field;
  create disclosed the key value once, phrased to bypass the redactor's
  key:value pattern deliberately.
- **Owner input:** Not needed.

## Phase 5 — 0.0.8 "Coverage: SSH"

### D12: VM snapshot revert/delete descoped; ZFS snapshot actions ship in full

- **Decided:** VM snapshots ship as `vm_snapshot_list` + `vm_snapshot_create`
  (external, `virsh snapshot-create-as --atomic --disk-only`); revert and
  delete are not offered and both tools say to use the Unraid UI for those.
  ZFS `zfs_snapshot_action` ships create/destroy/rollback in full.
- **Why:** The spec pre-authorized descoping VM revert/delete if
  implementation risk proved too high — and it is: correct external-snapshot
  deletion needs per-disk `blockcommit --pivot` orchestration and a bare
  `snapshot-revert` corrupts Unraid 7's snapshot chains. ZFS snapshots, by
  contrast, are single well-defined CLI commands with safe failure modes
  (rollback refuses non-latest on its own; destroy is validated to only ever
  target `dataset@snapshot`).
- **Owner input:** Not needed (pre-authorized); revisit VM revert/delete as a
  post-roadmap item if users ask.

### D13: gpu_metrics Intel path is detection + bounded raw sample

- **Decided:** NVIDIA gets fully parsed metrics (nvidia-smi CSV); Intel gets
  detection plus a 3-second `timeout intel_gpu_top -J` raw sample, truncated.
- **Why:** intel_gpu_top has no single-shot machine mode; a bounded raw
  sample is honest and still useful, and the spec asked for "detection" with
  clear absence reporting rather than parity.
- **Owner input:** Not needed.

## Phase 6 — 0.0.9 "Live + Launch"

### D14: docker-stats live samples are aggregated per container id

- **Decided:** The `dockerContainerStats` subscription emits ONE container per
  event, so the live-resource pipeline reduces samples into a per-id map
  (`{containers: {id: stats}}`) before storing; `docker_stats` serves from it
  when fresher than 10 s and labels the source, else falls back to SSH.
- **Why:** Storing only the latest single-container event would make the live
  path useless for a whole-box view; the reducer is confined to that topic.
- **Owner input:** Not needed.

### D15: Live metrics resource carries CPU only (for now)

- **Decided:** `unraid://live/metrics` subscribes to `systemMetricsCpu`;
  memory/network/temperature subscriptions are not wired in this release.
- **Why:** One clean topic proves the lifecycle end to end; fanning one
  resource out across four upstream subscriptions multiplies reconnect and
  merge states for little launch value. The `system_metrics` tool still
  covers everything on demand.
- **Owner input:** Optional — say the word and the remaining metric topics
  get wired the same way.

### D16: New runtime dependencies graphql-ws + ws

- **Decided:** Added `graphql-ws` (protocol client) and `ws` (WebSocket impl
  for Node 20) as runtime dependencies.
- **Why:** The spec mandates the graphql-transport-ws subprotocol; Node 20
  (the package's floor) lacks a stable global WebSocket.
- **Owner input:** Not needed.
