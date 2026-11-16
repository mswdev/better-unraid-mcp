import { describe, expect, it } from "vitest";
import { type ParityChecks, sortNewestFirst } from "./sort-newest-first.js";

/** One history entry with the given date; the other fields do not affect ordering. */
function checkOn(date: string | null): ParityChecks[number] {
  return { date, duration: null, speed: null, status: "COMPLETED", errors: 0, correcting: null };
}

describe("sortNewestFirst", () => {
  it("orders checks newest first", () => {
    const checks = [checkOn("2026-04-30T00:00:00Z"), checkOn("2026-05-30T00:00:00Z")];

    const sorted = sortNewestFirst(checks);

    expect(sorted.map((check) => check.date)).toEqual([
      "2026-05-30T00:00:00Z",
      "2026-04-30T00:00:00Z",
    ]);
  });

  it("puts undated checks last", () => {
    const checks = [checkOn(null), checkOn("2026-04-30T00:00:00Z")];

    const sorted = sortNewestFirst(checks);

    expect(sorted.map((check) => check.date)).toEqual(["2026-04-30T00:00:00Z", null]);
  });

  it("leaves the input order untouched", () => {
    const checks = [checkOn("2026-04-30T00:00:00Z"), checkOn("2026-05-30T00:00:00Z")];

    sortNewestFirst(checks);

    expect(checks[0].date).toBe("2026-04-30T00:00:00Z");
  });
});
