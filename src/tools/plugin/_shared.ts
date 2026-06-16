import { z } from "zod";
import type { ResponseFormat } from "../_shared/respond.js";

/**
 * Allowed form for a `names` entry: a bare or scoped npm package name with **no**
 * version suffix. `addPlugin` runs `npm i <name>` with lifecycle scripts enabled and
 * npm resolves any spec form (URL/git/tarball/path), so this allowlist confines
 * installs to named registry packages. The no-version rule also keeps
 * `plugin_list` ↔ `plugin_remove` composable: `removePlugin` exact-matches the
 * stored config string while `plugin_list` reports the parsed package name.
 * @see docs/plans/2026-06-15-plugin-tools-design.md
 */
export const NAMES_SPEC = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** Validated input shared by `plugin_add` and `plugin_remove`. */
export interface PluginNamesInput {
  response_format: ResponseFormat;
  names: string[];
  confirm?: boolean;
}

/** The zod input fields shared by `plugin_add` and `plugin_remove`. */
export const pluginNamesSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  names: z.array(z.string()).min(1),
  confirm: z.boolean().optional(),
};

/**
 * Returns the first `names` entry that is not a bare/scoped package name, or `null`
 * when all are valid. A non-null result MUST be refused — it could otherwise install
 * from an arbitrary URL/path/git source.
 *
 * @param names - The requested package names.
 * @returns The first invalid entry, or `null` if every entry is allowed.
 * @example firstInvalidName(["lodash", "git+https://e/x"]); // "git+https://e/x"
 */
export function firstInvalidName(names: string[]): string | null {
  return names.find((name) => !NAMES_SPEC.test(name)) ?? null;
}

/**
 * Builds the refusal message for an invalid `names` entry.
 *
 * @param action - The lifecycle verb, e.g. "add" or "remove".
 * @param name - The rejected entry.
 * @returns A refusal string naming the entry and stating no changes were made.
 */
export function invalidNameError(action: string, name: string): string {
  return `Refusing to ${action} "${name}": only bare or scoped npm package names are allowed (no URLs, git refs, paths, or version suffixes). No changes were made.`;
}

/** Capitalizes the first letter (verb → sentence-leading noun). */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Builds the report-and-point summary for a restart-triggering write. The mutation's
 * Boolean is restart-semantics, not success (`false` = the API auto-restarted to
 * apply; `true` = a manual restart is required); failures throw, so this is only
 * reached on success. It never asserts the plugins are installed.
 *
 * @param verb - The lifecycle verb, e.g. "add" or "remove".
 * @param names - The affected package names.
 * @param manualRestartRequired - The mutation's Boolean result.
 * @returns The concise report-and-point line.
 * @example restartReport("add", ["a"], false); // "Add of a submitted; the Unraid API is restarting..."
 */
export function restartReport(
  verb: string,
  names: string[],
  manualRestartRequired: boolean,
): string {
  const tail = manualRestartRequired
    ? "a manual API restart is required to apply it. Verify with plugin_list after restarting."
    : "the Unraid API is restarting to apply it. Verify with plugin_list once it reconnects.";
  return `${capitalize(verb)} of ${names.join(", ")} submitted; ${tail}`;
}
