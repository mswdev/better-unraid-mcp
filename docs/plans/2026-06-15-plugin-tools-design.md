# Plugins Domain Tools — Design (PR #9)

**Date:** 2026-06-15
**Branch:** `feature/plugin-tools` (off `develop`)
**Status:** Approved in brainstorming — **source-validation pending** (revision 0)
**Validation pin:** unraid/api @ `264ddf0` (v4.35.0), spot-checked on `main` @ `6f94aa1` — source-validated only, **NOT live-verified**

> PR #9 was originally scoped as the **backup** domain; source-validation found it
> non-functional at this API version (flash-backup stub + rclone production-disabled)
> and it was deferred — see `2026-06-15-backup-tools-design.md`. PR #9 pivoted here.

## Goal

Give the MCP visibility into installed Unraid plugins and a gated lifecycle for the
API's own (npm) plugins. The flash device / app ecosystem is admin-critical;
"what's installed, at what version" plus add/remove of api plugins is a real admin
task. Resolvers verified **real** (not stubs) by direct read.

| Tool | Root | Purpose |
|------|------|---------|
| `plugin_list` | `Query.plugins` + `Query.installedUnraidPlugins` | List installed plugins (api + OS `.plg`) |
| `plugin_add` | `Mutation.addPlugin` | Install one or more api (npm) plugins (confirm-gated) |
| `plugin_remove` | `Mutation.removePlugin` | Uninstall one or more api plugins (confirm-gated) |

## The two plugin systems (verified)

- **api plugins** (npm packages extending the unraid-api): `Query.plugins → [Plugin
  { name, version, hasApiModule, hasCliModule }]` (`plugin.resolver.ts:25-33`).
  Managed by `addPlugin`/`removePlugin` (`plugin.resolver.ts:48-88`).
- **OS `.plg` plugins** (classic community apps): `Query.installedUnraidPlugins →
  [String!]` filenames (`unraid-plugins.resolver.ts:48-50`). Installed by
  `installPlugin`/`installLanguage` from a **`.plg` URL** — **deferred** (see below).

Reads carry **no credential surface** — `Plugin` fields and `PluginInstallOperation`
`url`/`output` are the box owner's own install data, not secrets. None of the
backup domain's name+type secrecy machinery applies.

## Decisions (settled in brainstorming; revise after source validation)

1. **Write scope: reads + api add/remove, gated.** The plugins domain is mostly
   code-execution writes. `installPlugin` runs a `.plg` from an arbitrary URL (RCE);
   `addPlugin` installs an npm package into the API (supply-chain). Per the owner's
   stated intent (PR-#10 note named `addPlugin`/`removePlugin`), ship the api-plugin
   lifecycle behind confirm gates; **defer the arbitrary-URL `.plg` installer.**
   Residual risk acknowledged: a confirm gate confirms *intent*, not *payload* — the
   package name still flows through the model, so prompt-injection could substitute
   the target. The gate is necessary, not sufficient; the tool description states
   the supply-chain nature plainly.
2. **Restart is intrinsic.** `addPlugin`/`removePlugin` `await` the operation then
   call `lifecycleService.restartApi({ delayMs: 300 })` when `restart: true`
   (`plugin.resolver.ts:55-60, 83-86`). The mutation returns *before* the restart,
   so the tool gets its result, then the unraid-api restarts ~300ms later — dropping
   the MCP's own GraphQL connection. The tool reports this and points the caller to
   reconnect. The returned `Boolean` is **restart-semantics, not success**
   (`false` = auto-restarted, `true` = manual restart required); failures throw, so
   the tool never treats `false` as failure.
3. **`bundled` and `restart` are not exposed.** `bundled` selects an internal
   build-time/config-only path (`removePluginConfigOnly`) — hardcode `false`.
   `restart` hardcode `true` (apply-and-restart); the `names` array batches multiple
   plugins into one call → one restart, so no per-call restart control is needed.
   KISS + smaller attack surface.
4. **Defer:** `installPlugin`/`installLanguage` (`.plg`-URL installer — RCE);
   `pluginInstallOperation`/`pluginInstallOperations` reads (they only observe the
   deferred installer path — `addPlugin`/`removePlugin` create no operations); the
   `pluginInstallUpdates` subscription (project does not do subscriptions). These
   ship together in a future installer PR.

## Tool designs

### `plugin_list` (read-only)

- **Input:** `response_format: "concise" | "detailed"` (default `concise`).
- **Operation:** `query { plugins { name version hasApiModule hasCliModule }
  installedUnraidPlugins }`.
- **Output:** concise = "N api plugins, M OS plugins" + names; detailed = full
  `Plugin` metadata + `.plg` filename list. Description labels api plugins as the
  add/remove-able set and OS `.plg` as read-only here.
- **Annotations:** `readOnlyHint: true, destructiveHint: false, openWorldHint: false`.
- RBAC: READ_ANY/CONFIG (any VIEWER+ key).

### `plugin_add` (state-changing, confirm-gated)

- **Input:** `names: string[] (min 1)`, `confirm: boolean`.
- **Gate:** `requireConfirmation(confirm, 'add plugin(s) <names>')`.
- **Operation:** `mutation { addPlugin(input: { names, bundled: false, restart: true }) }`.
- **Output:** report-and-point — "Added <names>. The Unraid API is restarting to
  load them; reconnect in a few seconds." (Resolver `await`s the install before
  returning, so "added" is accurate; the restart is the report-and-point.)
- **Annotations:** `readOnlyHint: false, destructiveHint: false, openWorldHint: true`
  (fetches packages). Confirm copy states it installs npm code into the API
  (supply-chain) and restarts it. RBAC: UPDATE_ANY/CONFIG.

### `plugin_remove` (destructive, confirm-gated)

- **Input:** `names: string[] (min 1)`, `confirm: boolean`.
- **Gate:** `requireConfirmation(confirm, 'remove plugin(s) <names>')`.
- **Operation:** `mutation { removePlugin(input: { names, bundled: false, restart: true }) }`.
- **Output:** report-and-point — "Removed <names>. The Unraid API is restarting."
- **Annotations:** `readOnlyHint: false, destructiveHint: true, openWorldHint: false`.
  Confirm copy notes the API restart. RBAC: DELETE_ANY/CONFIG.

## Architecture

- **Directory:** `src/tools/plugin/` — `plugin-list.ts`, `plugin-add.ts`,
  `plugin-remove.ts` (3 `.ts`; colocated `.graphql` + `.test.ts` don't count).
- **Shared reuse:** `GraphQLExecutor`; `_shared/confirm.ts` (`requireConfirmation`);
  `_shared/respond.ts` (`formatResponse`, `toolError`, `ResponseFormat`).
- **Codegen:** per-tool `.graphql` operations; `npm run generate` → single committed
  `src/types/unraid/graphql.ts`. `PluginManagementInput` carries `bundled`/`restart`
  (both `Boolean! = default`) — we supply explicit values.
- **Registry:** `register*` per tool with `@returns` JSDoc; wired in `registry.ts`
  (+ `registry.test.ts` count/name assertions). README documents the three tools.

## Error handling

- Handlers wrap `execute` in try/catch → `toolError`. The client throws
  `UnraidApiError` (joined `errors[]`); partial data is discarded — schema
  nullability is not a degradation path.
- A failed `addPlugin` may throw mid-install; surface the error verbatim (no
  credential content in plugin names) and do not claim success. Whether a failed add
  leaves the API in a broken state is a **source-validation item**.
- An under-privileged key (lacking UPDATE/DELETE_ANY·CONFIG) throws an authorization
  error — surfaced as a generic failure.

## Testing

Hermetic, `satisfies Query/Mutation` fixtures, fakes from `_shared/test-support.ts`.

- **`plugin_list`:** success (concise + detailed), empty (no plugins), error path
  (`rejectingExecutor`); asserts both `plugins` and `installedUnraidPlugins` are
  selected.
- **`plugin_add`:** confirm gate refuses with **no execute call** (recording fake
  sees zero calls); success path asserts the sent variables carry
  `bundled:false, restart:true` and the requested `names`; report-and-point output
  asserts it surfaces the restart and makes no over-claim; error path.
- **`plugin_remove`:** confirm gate (no execute when unconfirmed); success +
  variables assertion; error path.

## Source-validation TODO (reconcile into a "Validated findings" section)

Scaled to scope (writes are the risk; reads already directly verified). Resolvers:
`api/src/unraid-api/plugin/*` and `.../graph/resolvers/unraid-plugins/*`.

1. **addPlugin/removePlugin internals (`plugin-management.service.ts`):** where does
   `addPlugin` install from (npm registry? arbitrary spec/path/URL?); is `names`
   validated; failure/error shape; does a failed/partial add leave the API broken;
   what `bundled` true vs false actually does; confirm the `Boolean` is
   restart-semantics; confirm the restart path + timing.
2. **Reads:** `plugins` (source — package scan? what if none) and
   `installedUnraidPlugins` (filesystem `.plg` dir? empty/error modes).
3. **RBAC + flags:** confirm READ_ANY/CONFIG (reads), UPDATE_ANY/CONFIG (add),
   DELETE_ANY/CONFIG (remove); confirm no `@UseFeatureFlag` gating; how an
   under-privileged key fails.

## Release gate

Source-validated against `unraid/api @ 264ddf0` (v4.35.0) + `main`. **NOT
live-verified against a real Unraid box** — flagged in the PR body, consistent with
PRs #1–#8.
