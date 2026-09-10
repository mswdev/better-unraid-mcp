const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const UNIT_STEP = 1024;
const DECIMALS = 1;

/**
 * Formats a byte count as a human-readable string (e.g. `1.5 GB`).
 *
 * @param bytes - The number of bytes; non-finite or negative becomes `0 B`.
 * @returns A human-readable size string.
 */
export function humanizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= UNIT_STEP && unitIndex < BYTE_UNITS.length - 1) {
    value /= UNIT_STEP;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(DECIMALS);
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Formats a kilobyte count as a human-readable string.
 *
 * @param kilobytes - The number of kilobytes.
 * @returns A human-readable size string.
 */
export function humanizeKilobytes(kilobytes: number): string {
  return humanizeBytes(kilobytes * UNIT_STEP);
}

/**
 * Parses a possibly-null numeric string into a number, defaulting to 0.
 *
 * @param value - The value to parse (e.g. a `BigInt`-as-string field).
 * @returns The parsed number, or 0 when null/invalid.
 */
export function toNumber(value: string | null | undefined): number {
  if (value == null) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
