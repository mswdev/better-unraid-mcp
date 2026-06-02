# better-unraid-mcp — Docker Tools Design (PR #3)

**Date:** 2026-06-01
**Author:** Matt White (mswdev)
**Status:** Approved — ready for implementation planning
**Branch:** `feature/docker-tools` → draft PR into `develop`

## Goal

Introduce the **Docker domain** — the **first domain with mutations**. This PR
exercises the previously-stubbed confirm-gate (`requireConfirmation` in
`src/tools/_shared/confirm.ts`) and the `destructiveHint` annotation for the
first time, while keeping the read tools consistent with the system/storage
domain. Seven tools: four read-only, three gated mutations.

The autostart mutation (`updateAutostartConfiguration`) is intentionally **split
out to a focused PR #3.5** — see *Deferred*.

## Decisions carried in

- **Tool shape — consolidated lifecycle + discrete remove/update.** The four
  lifecycle ops share one signature `(id) -> DockerContainer`, so they collapse
  into one `docker_container_action` tool with an `action` enum. `remove`
  (irreversible, has `with_image`) and `update` (pull + recreate) are distinct
  risk tiers / shapes, so each gets its own tool. (Chosen over discrete
  per-action tools and a single mega-action tool.)
- **Uniform confirm-gate.** *Every* mutation requires `confirm: true`; reads are
  ungated. One rule, simple to document. `start`/`unpause` are restorative but
  still gated for consistency.
- **Reuse every established pattern**: `GraphQLExecutor` seam, `response_format`
  concise/detailed via `_shared/respond.ts`, vendored SDL + graphql-codegen
  single committed types file, hermetic hand-written fakes, `readOnly`/
  `destructive` annotations, NodeNext `.js` imports, ≤25-line methods, JSDoc on
  exports, no `any`.

## Validated API semantics

Behavioral facts validated by reading `unraid/api` + `limetech/webgui` source
(multi-agent research, each claim independently re-checked). **None verified
against a live Unraid box** — see *Residual unknowns*.

- **`removeContainer(id, withImage)`** — irreversible; force-kills a running
  container with **no graceful stop**. `withImage: true` is **best-effort** and
  can return `true` without deleting a shared/in-use image. Requires Unraid OS
  **7.3+**.
- **`updateContainer`/`updateContainers`** force-pull unconditionally (ignore
  `isUpdateAvailable`). **`updateAllContainers`** only enqueues
  cached-update-available ids and returns **`[]` (not an error)** on a cold
  cache. Updating an **orphaned** container (`isOrphaned = !templatePath`) is a
  **silent no-op**. Requires **7.3+**.
- **`PrefixedID`** is a plain `<serverId>:<rawId>` colon-delimited string (NOT
  base64/Relay). `DockerContainer.id` round-trips **verbatim** into mutations
  and `logs` — no encode/decode step.
- **`DockerContainer.names`** carries the Docker leading slash (`/plex`) — strip
  `^/` for display and for the `name` substring filter.
- **`logs(id, since, tail)`**: `tail` = trailing-line count (default 200, max
  2000, clamped; `<= 0` → 200). `since` = **inclusive** ISO-8601 lower bound.
  Returned `cursor` = last line's timestamp; re-passing it as `since` re-returns
  the boundary line as a **duplicate** — clients de-dupe.
- **Errors**: the friendly "Docker socket unavailable." mapping exists only on
  the **read** path. Mutations surface raw/generic errors and can throw post-op
  "not found" even after the action partly succeeded — so mutation copy must not
  promise a clean socket message.
- **MCP annotations** (spec 2025-11-25): `destructiveHint` defaults to **true**
  and is only meaningful when `readOnlyHint: false`; a consolidated multi-action
  tool annotates for the **worst case**. The spec puts confirmation on the
  client; our `confirm: true` param is a defensible app-level fallback for a
  server that cannot assume an interactive client.

## Tools (7)

### Reads — `readOnlyHint: true, destructiveHint: false, openWorldHint: false`

| Tool | Args | Source / concise summary |
|------|------|--------------------------|
| `docker_container_list` | `name?`, `response_format` | `Docker.containers`; filter on slash-stripped names. Concise: one line/container — name, state, image, `⬆` when `isUpdateAvailable`. Detailed: full containers. |
| `docker_container_logs` | `id`, `since?`, `tail?`, `response_format` | `Docker.logs(id, since, tail)`. `tail`: `z.number().int().positive().max(2000).default(200)`. Concise: the lines as text + a note that `cursor` can be re-passed as `since` (boundary line repeats — de-dupe). Detailed: full payload incl. `cursor`. |
| `docker_network_list` | `response_format` | `Docker.networks`. Concise: one line/network — name, driver, scope, IPv6/internal. *(SDL-typed; runtime behavior unverified.)* |
| `docker_port_conflicts` | `response_format` | `Docker.portConflicts`. Concise: conflict count + offending container/LAN ports, or "No port conflicts." *(SDL-typed; runtime behavior unverified.)* |

### Mutations — `readOnlyHint: false, destructiveHint: true, openWorldHint: false`; gated by `confirm: true`

| Tool | Args | Behavior / copy |
|------|------|-----------------|
| `docker_container_action` | `id`, `action` (`start`\|`stop`\|`pause`\|`unpause`), `confirm` | Dispatches the enum to one of four mutation Documents. Concise uses **past-tense verbs** ("Started container X") — never asserts the (async) returned `state` as confirmed. |
| `docker_container_remove` | `id`, `with_image?` (default false), `confirm` | `removeContainer(id, withImage)`. Copy: "Permanently deletes the container; force-kills it if running (no graceful shutdown); irreversible." `with_image`: "also attempts to delete the image (best-effort; may report success without deleting a shared/in-use image)." Never claims the image was deleted. **7.3+**. |
| `docker_container_update` | `ids[]` **+** `all?`, `confirm` | **Exactly one** of `ids` (non-empty) or `all: true`, validated **handler-side** (`resolveTarget`), not via a top-level Zod `refine` — see note below. `ids` → `updateContainers(ids)` (a single id is `ids: [one]`); `all` → `updateAllContainers`. Copy: force-pulls regardless of update-available; `all` returning none = "no containers had an available update" (not an error); updating an orphaned container is a silent no-op. **7.3+**. |

> **`ids`/`all` validation — handler-side, not Zod `refine`.** The MCP SDK's
> `inputSchema` is a Zod *raw shape* (a map of field schemas), the convention used
> by all 12 tools in this repo (no `.refine()` appears anywhere in `src/`). The
> XOR is therefore enforced in `resolveTarget` (returning `toolError` before any
> `client.execute`) and covered by tests for both/neither. A top-level
> `z.object().refine(...)` would also be wireable, but Zod refinement predicates
> do not serialize to the introspected JSON Schema, so a `tools/list` client would
> see the same two optional fields either way — no client-facing gain for a lone
> deviation from the repo convention.

### Annotations rationale

`docker_container_action` spans non-destructive (`start`) and disruptive
(`stop`) actions; annotations are per-tool and cannot vary by argument, so it is
annotated `destructiveHint: true` (worst case). All four read tools mirror the
`share_list` convention.

## Three wiring firsts

These are new to the repo and are spelled out so the TDD build does not
rediscover them mid-stream:

1. **Mutation nesting.** Operations are `mutation { docker { start(id: $id)
   { … } } }`; the handler reads `data.docker.start`, **not** `data.start`.
   These are the first mutation operations in the codebase.
2. **One tool → N Documents.** `docker_container_action` imports four mutation
   Documents (`DockerStart`/`DockerStop`/`DockerPause`/`DockerUnpause`) and
   switches on the `action` enum; `docker_container_update` imports two
   (`DockerUpdateContainers`/`DockerUpdateAll`). A single `.graphql` file may
   hold multiple named operations; codegen emits one typed Document each.
3. **First real confirm-gate.** `requireConfirmation(confirm, …)` must
   short-circuit **before** `client.execute` is ever called. The test asserts
   the executor was **not invoked** when `confirm` is absent — proving the gate,
   not merely that an error was returned.

## Placement

```
src/tools/docker/
  container-list.{ts,graphql,test.ts}
  container-logs.{ts,graphql,test.ts}
  container-action.{ts,graphql,test.ts}       # 4 named mutation ops in the .graphql
  container-remove.{ts,graphql,test.ts}
  container-update.{ts,graphql,test.ts}        # 2 named mutation ops in the .graphql
  network-list.{ts,graphql,test.ts}
  port-conflicts.{ts,graphql,test.ts}
  _shared.ts                                    # stripLeadingSlash + any docker helpers (+ .test.ts)
```

Registration happens in the **existing top-level `src/tools/registry.ts`** (one
`register*` import + call per tool, matching the established pattern) — there is
no `docker/registry.ts`, which keeps `docker/` at exactly 8 source `.ts` files.

Flat domain dir, matching the existing `array/`/`share/` convention. **Conscious
file-cap note:** this lands `docker/` at 8 source `.ts` files (tests excluded)
— under the 10-file cap, but close. The *next* docker PR (stats/exec/inspect)
will trigger a `docker/container/` subdivision; flat-and-defer is deliberate for
this PR, not an oversight.

## Error handling & nullability

Each handler wraps `client.execute` in `try/catch` and returns `toolError(...)`
on failure (same as every prior tool). Mutation error copy stays generic — it
must not promise the friendly socket message (read-path only). Many
`DockerContainer` fields are nullable (`isUpdateAvailable`, sizes, `templatePath`)
— concise summaries guard each with fallbacks. `remove`'s concise output cannot
include a name (the container is gone) — it reports the id.

## Testing

Hermetic, hand-written fake `GraphQLExecutor` per tool, with `satisfies
<Operation>Query`/`<Operation>Mutation` fixtures so codegen drift breaks the
build. Coverage per concern:

- **Reads**: concise summary content, detailed JSON, empty-set fallback, error
  path; `container_list` slash-strip in both display and the `name` filter;
  `port_conflicts` "no conflicts" path.
- **`container_action`**: the gate-not-called assertion (fake executor records
  invocations; assert **zero** when `confirm` is absent); enum dispatch — each
  `action` value drives the correct mutation Document; concise past-tense copy.
- **`container_remove`**: gate-not-called; `with_image` true/false; copy never
  claims image deletion.
- **`container_update`**: gate-not-called; the handler-side `ids` XOR `all`
  validation (both / neither → validation error); `all`-returns-empty is success,
  not error.
- **`_shared`**: `stripLeadingSlash` unit tests (with slash, without, empty).

## Deferred

- **PR #3.5 — `docker_autostart_set`** (`updateAutostartConfiguration`). Split
  out because it is the **only read-modify-write** tool here and
  `updateAutostartConfiguration` is **REPLACE-all, not merge** — a naive partial
  call silently drops every unlisted container's autostart, corrupting
  persistent boot config. It needs a merge-safe design (read all containers'
  current autostart → merge the change → submit the full ordered snapshot →
  validate unknown ids), the heaviest tests in the domain, and it is
  feature-flagged / **7.3+** and unverifiable against a live box. Isolating it
  keeps PR #3 low-blast-radius and gives autostart a reviewable PR of its own.
- Later: container stats (`dockerContainerStats`), exec/console, single-container
  detail tool (covered for now by `container_list` + `name`), Docker organizer,
  template sync, VM domain.

## Residual unknowns (flag, do not claim verified)

- **Nothing is verified against a live Unraid box.** The semantics above rest on
  source reads of `unraid/api` / `limetech/webgui` at pinned/main commits.
- **`docker_network_list` and `docker_port_conflicts` have no behavioral research
  backing** — the SDL guarantees the fields and their shapes exist, but not
  runtime behavior (e.g. whether port-conflict detection is computed server-side).
  They are designed strictly to the SDL.
- **remove/update availability** is anchored to the 7.3+ Docker rework (and may
  be feature-flagged); on older servers these mutations may error — handlers
  degrade gracefully via the standard `toolError` path.

## Quality gate

`npm run typecheck && npm run build && npm test && npm run lint`, plus codegen
idempotency (`npm run generate` leaves no diff), plus an independent stdio
`tools/list` smoke check confirming all seven tools register with correct
annotations.
