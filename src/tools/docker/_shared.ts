/**
 * Strips the single leading slash Docker prepends to container names.
 *
 * @param name - A Docker container name (may be undefined).
 * @param fallback - Value returned when `name` is undefined. Defaults to "".
 * @returns The name without its leading slash, or the fallback.
 */
export function stripLeadingSlash(name: string | undefined, fallback = ""): string {
  if (name === undefined) {
    return fallback;
  }
  return name.startsWith("/") ? name.slice(1) : name;
}
