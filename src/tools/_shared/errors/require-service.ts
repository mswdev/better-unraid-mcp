/**
 * Unraid API 4.37.11+ returns a null `docker` root, rather than failing the
 * whole query, when the Docker service errors.
 */
export const DOCKER_UNAVAILABLE =
  "the Unraid API returned no Docker data; the Docker service may be stopped or failing";

/**
 * Unraid API 4.37.11+ returns a null `vms` root, rather than failing the whole
 * query, when the VM service (libvirt) errors.
 */
export const VMS_UNAVAILABLE =
  "the Unraid API returned no VM data; the VM service may be stopped or failing";

/**
 * Returns a service root from a query result (such as `docker` or `vms`),
 * failing loudly when the API returned none.
 *
 * @param root - The nullable root field from a GraphQL result.
 * @param unavailable - The error message to throw when `root` is null.
 * @returns The same value, narrowed to non-null.
 * @throws Error with `unavailable` as its message when `root` is null.
 * @example
 * const { containers } = requireService(data.docker, DOCKER_UNAVAILABLE);
 */
export function requireService<T>(root: T | null, unavailable: string): T {
  if (root === null) {
    throw new Error(unavailable);
  }
  return root;
}
