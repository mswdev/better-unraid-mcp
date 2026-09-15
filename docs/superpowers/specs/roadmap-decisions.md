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
