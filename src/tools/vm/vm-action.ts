/** The number of colon-separated parts a prefixed `PrefixedID` (`serverId:rawId`) has. */
const PREFIXED_ID_PARTS = 2;

/**
 * Strips the `serverId:` prefix from a `PrefixedID`, mirroring the upstream scalar:
 * it returns the part after the colon only when the value splits into exactly two
 * parts, otherwise the value unchanged. A bare uuid (no colon) round-trips as-is,
 * so a caller may pass either the prefixed `id` from `vm_list` or a bare uuid.
 *
 * @param id - A VM id: either `serverId:uuid` or a bare uuid.
 * @returns The uuid without its server prefix, or the input unchanged.
 */
export function stripServerPrefix(id: string): string {
  const parts = id.split(":");
  return parts.length === PREFIXED_ID_PARTS ? parts[1] : id;
}
