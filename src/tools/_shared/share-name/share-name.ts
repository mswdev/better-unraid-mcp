/**
 * Share-name rules shared by every tool that puts a user share's name into a
 * path or a shell command (share_create, share_edit, share_delete,
 * flash_backup). Names are always passed through `quoteForShell` (or
 * URL-encoded into an emcmd form body) as well; these rules are the second,
 * independent layer, and they stay deliberately narrower than Unraid's
 * historical rules.
 */

/** Longest share name Unraid's web UI accepts (the ShareEdit name field's maxlength). */
export const MAX_SHARE_NAME_LENGTH = 40;

/**
 * Characters allowed in the name of a share that already exists. Spaces are
 * in the set: Unraid's web UI accepted them in new names until August 2025
 * (unraid/webgui 074aa304dc), and it still edits and deletes such shares
 * because it only validates a name that is new or being changed. Everything
 * else that could escape a path or a command, such as `/`, `\`, quotes,
 * backticks, `$`, and control characters, is outside the set.
 */
const EXISTING_SHARE_NAME_CHARACTERS = /^[A-Za-z0-9 ._-]+$/;

/** Characters allowed in a NEW share name: the same set minus spaces, as the web UI requires today. */
const NEW_SHARE_NAME_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/**
 * Two dots in a row. With `/` refused this cannot climb a directory on its
 * own, but it never appears in a real share name, so it is refused outright.
 */
const PARENT_REFERENCE = "..";

/**
 * The rules every share name must pass, new or existing: present, within the
 * length cap, and not starting with a dot (a hidden share, and also `.` and
 * `..`), a hyphen (read as a command option), or a space; not ending with a
 * space; and never containing `..`.
 *
 * @param name - The share name to check.
 * @returns A human reason when the name breaks a rule, or null.
 */
function structuralProblem(name: string): string | null {
  if (name.length === 0) {
    return "Share name is empty.";
  }
  if (name.length > MAX_SHARE_NAME_LENGTH) {
    return `Share name must be ${MAX_SHARE_NAME_LENGTH} characters or less.`;
  }
  if (name.startsWith(".")) {
    return "Share names must not start with a dot (hidden shares are not allowed).";
  }
  if (name.startsWith("-")) {
    return "Share names must not start with a hyphen.";
  }
  if (name.startsWith(" ") || name.endsWith(" ")) {
    return "Share names must not start or end with a space.";
  }
  if (name.includes(PARENT_REFERENCE)) {
    return `Share names must not contain "${PARENT_REFERENCE}".`;
  }
  return null;
}

/**
 * Validates the name of a share that already exists, as share_list returns
 * it. Spaces are allowed (shares made before Unraid banned them); quotes,
 * backticks, `$`, `/`, `\`, control characters, a leading hyphen, and `..`
 * are not.
 *
 * @param name - The share name from the caller.
 * @returns A human reason when invalid, or null when acceptable.
 * @example
 * validateExistingShareName("TV Shows"); // null
 * validateExistingShareName("it's"); // "Share names may only contain …"
 * @see validateNewShareName for the stricter rule share_create applies.
 */
export function validateExistingShareName(name: string): string | null {
  const problem = structuralProblem(name);
  if (problem) {
    return problem;
  }
  if (!EXISTING_SHARE_NAME_CHARACTERS.test(name)) {
    return "Share names may only contain letters, digits, spaces, dot, underscore, and hyphen.";
  }
  return null;
}

/**
 * Validates a name for a share about to be created, the way Unraid's web UI
 * does for a new name: the existing-name rules, and no spaces.
 *
 * @param name - The requested share name.
 * @returns A human reason when invalid, or null when acceptable.
 * @example
 * validateNewShareName("media"); // null
 * validateNewShareName("my share"); // "New share names may only contain …"
 * @see validateExistingShareName for shares that already exist.
 */
export function validateNewShareName(name: string): string | null {
  const problem = structuralProblem(name);
  if (problem) {
    return problem;
  }
  if (!NEW_SHARE_NAME_CHARACTERS.test(name)) {
    return "New share names may only contain letters, digits, dot, underscore, and hyphen (no spaces).";
  }
  return null;
}
