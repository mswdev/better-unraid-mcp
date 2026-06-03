import { describe, expect, it } from "vitest";
import type { NotificationType } from "../../types/unraid/graphql.js";
import {
  IMPORTANCE_TO_API,
  TYPE_TO_API,
  formatCounts,
  summarizeLine,
  summarizeOverview,
} from "./_shared.js";

describe("formatCounts", () => {
  it("renders total with the importance breakdown", () => {
    expect(formatCounts({ total: 6, alert: 1, warning: 2, info: 3 })).toBe(
      "6 (1 alert / 2 warning / 3 info)",
    );
  });
});

describe("summarizeOverview", () => {
  it("renders unread then archived", () => {
    const overview = {
      unread: { total: 2, alert: 1, warning: 1, info: 0 },
      archive: { total: 5, alert: 0, warning: 2, info: 3 },
    };
    expect(summarizeOverview(overview)).toBe(
      "Unread: 2 (1 alert / 1 warning / 0 info). Archived: 5 (0 alert / 2 warning / 3 info).",
    );
  });
});

describe("summarizeLine", () => {
  it("renders [IMPORTANCE] title — subject (formattedTimestamp)", () => {
    expect(
      summarizeLine({
        importance: "WARNING",
        title: "Disk warning",
        subject: "Disk 1",
        timestamp: "1700000001",
        formattedTimestamp: "2023-11-14 12:00",
      }),
    ).toBe("[WARNING] Disk warning — Disk 1 (2023-11-14 12:00)");
  });

  it("falls back to timestamp then a placeholder when formattedTimestamp is null", () => {
    expect(
      summarizeLine({
        importance: "INFO",
        title: "t",
        subject: "s",
        timestamp: null,
        formattedTimestamp: null,
      }),
    ).toBe("[INFO] t — s (no timestamp)");
  });
});

describe("enum maps", () => {
  it("maps lowercase tool types to the SDL NotificationType", () => {
    const archive: NotificationType = TYPE_TO_API.archive;
    expect(TYPE_TO_API).toEqual({ unread: "UNREAD", archive: "ARCHIVE" });
    expect(archive).toBe("ARCHIVE");
  });

  it("maps lowercase tool importance to the SDL NotificationImportance", () => {
    expect(IMPORTANCE_TO_API).toEqual({ alert: "ALERT", warning: "WARNING", info: "INFO" });
  });
});
