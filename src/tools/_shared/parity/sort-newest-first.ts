import type { ParityHistoryQuery } from "../../../types/unraid/graphql.js";

/** The parity-check records the `ParityHistory` document returns. */
export type ParityChecks = ParityHistoryQuery["parityHistory"];

/**
 * Sorts parity checks newest-first by ISO date, with undated checks last. The
 * SDL guarantees no order for `parityHistory`, so every reader that wants
 * "the latest check" sorts instead of trusting the API's list order.
 *
 * @param checks - Parity checks as the `ParityHistory` document returns them.
 * @returns A new array, newest first; the input is not modified.
 * @example
 * const [latest] = sortNewestFirst(data.parityHistory);
 */
export function sortNewestFirst(checks: ParityChecks): ParityChecks {
  return [...checks].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
