# Plugins Domain Tools — Design (PR #9)

**Date:** 2026-06-15
**Branch:** `feature/plugin-tools` (off `develop`)
**Status:** Approved + **source-validation reconciled (revision 1)**
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

## Validated findings (unraid/api @ 264ddf0 — 3 areas, adversarially verified + completeness critic)

All three findings held at high confidence. The critic's 5 gaps were **all** about
the deferred `installPlugin`/`installLanguage` path (async fire-and-forget op model,
in-memory/restart-volatile op store, nested-namespace mutation shape,
subscription-vs-poll) — which vindicates deferring it; none touch the three shipping
tools.

### Writes (`addPlugin`/`removePlugin`)
- **`addPlugin` is an arbitrary-package-install / RCE-class primitive.** `names`
  flows `resolver → addPlugin(...names) → addPluginToConfig (persists to config
  BEFORE install, no rollback) → installPlugins → dependencyService.npm('i',
  '--save-peer', '--save-exact', ...names) → execa('npm', [...], {cwd})`. Only
  validation is `@IsArray()` + `@IsString({each:true})`; the global ValidationPipe
  adds no format constraint. No `--ignore-scripts`, empty `.npmrc` → npm runs the
  resolved package's lifecycle scripts (root-ish code execution). `npm` resolves
  *any* spec form: registry name, `name@tag`, `git+https`, tarball URL, `user/repo`
  shorthand, `file:`/abs path. No `shell` option → each name is a literal argv token
  (no shell injection), but the arbitrary-source resolution is the RCE vector.
  → **client adds a registry-spec form-allowlist on `names`** (decision below).
- **`removePlugin`** runs `npm uninstall` only on names already in the plugins config
  (`removePluginFromConfig` returns only members it deletes), so it cannot uninstall
  arbitrary system packages — a normal destructive, restart-triggering write.
- **Boolean = restart-semantics, not success** (`false` = auto-restart triggered,
  `true` = manual restart required), driven by the `restart` input (default `true`);
  failures throw. A failed/partial add can throw or leave config drift (config
  written before install, no rollback) → **report-and-point; never assert installed.**
- `restartApi` uses fixed args `['restart']` — no injection via restart.

### Reads (`plugins`/`installedUnraidPlugins`)
- Both are safe, low-sensitivity inventory reads — no credential content.
- **`[]` is ambiguous and silent:** `plugins` `[]` can mean none / safe-mode /
  config-load failure; `installedUnraidPlugins` `[]` can mean none / directory
  missing (ENOENT) / unreadable. → **never assert "zero plugins"** (decision below).
- `Query.plugins` is the **active/loaded** set (config-declared AND installed AND
  schema-valid) captured as a **boot snapshot** — only changes after an API restart.
  `installedUnraidPlugins` is the **live raw** `.plg` listing, cheap to re-query.
- A `getPackageJson` throw path means `plugins` can surface a GraphQL error rather
  than `[]`; our client maps that to `toolError` ("inventory unavailable") — fine.

### RBAC / flags
- Reads = `READ_ANY/CONFIG` (any VIEWER+ key); `addPlugin` = `UPDATE_ANY/CONFIG`;
  `removePlugin` = `DELETE_ANY/CONFIG`. **No `@UseFeatureFlag`** on any plugin
  resolver → no availability probe needed.
- An under-privileged key throws a nest-authz Forbidden error → surface as
  "requires a key with CONFIG write permission (UPDATE_ANY/DELETE_ANY)".

### Reconciled decision — bare/scoped package-name allowlist on `names`
Because `addPlugin` is an arbitrary-source install primitive, `plugin_add` and
`plugin_remove` validate each `names` entry **client-side** against a *bare or
scoped npm package name* and reject anything else (URLs, `git+`, `file:`/`link:`/
`workspace:`, absolute/relative paths, `user/repo` shorthand, **and version
suffixes**). It is a **positive form-allowlist**, not a character denylist (a
denylist on `/`,`@`,`:` would wrongly reject legitimate `@scope/name`):

```
NAMES_SPEC = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
```

Two reasons, both validated:

1. **Security:** `addPlugin` runs `npm i ...names` with lifecycle scripts enabled and
   npm resolves *any* spec form. Restricting to package names narrows the
   prompt-injection blast radius from "install from anywhere" to "install a named
   registry package," mirroring backup's sourcePath-pin. (Residual: a malicious
   *published* package still installs — inherent to "install a plugin"; owned by the
   confirm gate + description.)
2. **`plugin_list ↔ plugin_remove` round-trip:** `removePlugin` **exact-matches the
   raw config string** (`removePluginFromConfig` deletes from the `api.plugins` set
   by string identity), while `plugin_list` reports the `parsePackageArg`-normalized
   package name. A bare name stored in config equals the name listed, so they
   compose; a `name@version` add would store `foo@1.2.3` in config but list as `foo`,
   making `plugin_remove("foo")` a **silent no-op**. Disallowing version suffixes
   guarantees composition. `npm --save-exact` still pins the resolved version, so no
   pinning capability is lost for the normal flow.

**Distribution model verified:** the upstream CLI installs api plugins as
`install <package>` ("a plugin as a peer dependency"); `parsePackageArg` only
contemplates `pkg` / `pkg@version` / `@scope/pkg`; `--save-peer --save-exact` and the
`unraid-api-plugin-connect` / `@unraid/shared` naming confirm bare/registry package
names are the normal form — so this allowlist does not break the real use case.

## Tool designs

### `plugin_list` (read-only)

- **Input:** `response_format: "concise" | "detailed"` (default `concise`).
- **Operation:** `query { plugins { name version hasApiModule hasCliModule }
  installedUnraidPlugins }`.
- **Output:** concise = "N api plugins, M OS plugins" + names; detailed = full
  `Plugin` metadata + `.plg` filename list. Description labels api plugins as the
  add/remove-able **active/loaded boot snapshot** (config-declared AND installed AND
  schema-valid; changes only after a restart) and OS `.plg` as the **live raw**
  read-only listing.
- **Empty-array honesty (validated):** an empty section is reported as "0 reported
  (may also indicate safe mode or an unreadable plugin directory)", never as a flat
  "0 installed" — both fields are silent about none-vs-unavailable.
- **Annotations:** `readOnlyHint: true, destructiveHint: false, openWorldHint: false`.
- RBAC: READ_ANY/CONFIG (any VIEWER+ key).

### `plugin_add` (state-changing, confirm-gated)

- **Input:** `names: string[] (min 1, each matches `NAMES_SPEC`)`, `confirm: boolean`.
- **Validation:** each name must match the registry-spec form-allowlist (above);
  reject URLs / `git+` / `file:` / paths / `user/repo` with a clear message naming
  the rejected entry. This is load-bearing security, not cosmetic.
- **Gate:** `requireConfirmation(confirm, 'add plugin(s) <names>')`.
- **Operation:** `mutation { addPlugin(input: { names, bundled: false, restart: true }) }`.
- **Output:** report-and-point — "Add of <names> submitted; the Unraid API is
  restarting to apply. Verify with plugin_list after it reconnects." Does **not**
  assert the plugins are installed (config is written before install with no
  rollback; partial failures throw or leave drift).
- **Annotations:** `readOnlyHint: false, destructiveHint: true, openWorldHint: true`
  (fetches packages; runs install lifecycle scripts and restarts the API — honestly
  destructive). Confirm copy states it installs npm code into the API that runs
  lifecycle scripts on install (supply-chain / RCE-class) and restarts the API.
  RBAC: UPDATE_ANY/CONFIG.

### `plugin_remove` (destructive, confirm-gated)

- **Input:** `names: string[] (min 1, each matches `NAMES_SPEC`)`, `confirm: boolean`.
- **Validation:** same registry-spec form-allowlist as `plugin_add` (symmetry; the
  names of installed plugins are registry specs, and `removePlugin` only acts on
  names already in config — but validating keeps the two tools consistent).
- **Gate:** `requireConfirmation(confirm, 'remove plugin(s) <names>')`.
- **Operation:** `mutation { removePlugin(input: { names, bundled: false, restart: true }) }`.
- **Output:** report-and-point — "Remove of <names> submitted; the Unraid API is
  restarting. Verify with plugin_list after it reconnects."
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
  credential content in plugin names) and do not claim success. Validated: a
  failed/partial add does **not** crash startup (`listPlugins` only loads names in
  *both* config and package.json deps), but it can leave **config drift** (config is
  written before install with no rollback) — another reason `plugin_add` reports
  "submitted" and points to `plugin_list`, never "installed".
- An under-privileged key (lacking UPDATE/DELETE_ANY·CONFIG) throws an authorization
  error — surfaced as a generic failure.

## Testing

Hermetic, `satisfies Query/Mutation` fixtures, fakes from `_shared/test-support.ts`.

- **`plugin_list`:** success (concise + detailed), empty (no plugins), error path
  (`rejectingExecutor`); asserts both `plugins` and `installedUnraidPlugins` are
  selected.
- **`plugin_add`:** confirm gate refuses with **no execute call** (recording fake
  sees zero calls); **`names` validation rejects non-registry specs** (URL, `git+`,
  `file:`, `/abs`, `user/repo`, **and `name@version`** — version suffixes break the
  remove round-trip) with no execute call, and accepts `name` and `@scope/name`;
  success path asserts the sent variables carry
  `bundled:false, restart:true` and the requested `names`; report-and-point output
  asserts it surfaces the restart and makes no over-claim ("submitted", not
  "installed"); error path.
- **`plugin_remove`:** confirm gate (no execute when unconfirmed); `names` validation
  (same allowlist); success + variables assertion; error path.

## Source-validation — resolved

All TODO items are answered in **Validated findings** above (revision 1). Net:
the three shipping tools are sound; the only design changes from validation are the
registry-spec form-allowlist on `names` and the empty-array honesty in `plugin_list`.
The deferral of `installPlugin`/`installLanguage` is vindicated (the critic's 5 gaps
were all about that path's async/ephemeral complexity).

## Release gate

Source-validated against `unraid/api @ 264ddf0` (v4.35.0) + `main`. **NOT
live-verified against a real Unraid box** — flagged in the PR body, consistent with
PRs #1–#8.
