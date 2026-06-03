import type { NotificationImportance, NotificationType } from "../../types/unraid/graphql.js";

/** A notification importance count breakdown (shape of `NotificationCounts`). */
export interface Counts {
  info: number;
  warning: number;
  alert: number;
  total: number;
}

/** The `NotificationOverview` shape: unread vs archived counts. */
export interface Overview {
  unread: Counts;
  archive: Counts;
}

/** The lowercase `type` accepted by notification tools. */
export type TypeInput = "unread" | "archive";

/** The lowercase `importance` accepted by notification tools. */
export type ImportanceInput = "alert" | "warning" | "info";

/** Maps the lowercase tool `type` to the SDL `NotificationType` enum. */
export const TYPE_TO_API: Record<TypeInput, NotificationType> = {
  unread: "UNREAD",
  archive: "ARCHIVE",
};

/** Maps the lowercase tool `importance` to the SDL `NotificationImportance` enum. */
export const IMPORTANCE_TO_API: Record<ImportanceInput, NotificationImportance> = {
  alert: "ALERT",
  warning: "WARNING",
  info: "INFO",
};

/**
 * Formats one counts bucket as `total (a alert / w warning / i info)`.
 *
 * @param counts - The bucket counts to format.
 * @returns The single-bucket summary string.
 */
export function formatCounts(counts: Counts): string {
  return `${counts.total} (${counts.alert} alert / ${counts.warning} warning / ${counts.info} info)`;
}

/**
 * Summarizes an overview as `Unread: …. Archived: ….`.
 *
 * @param overview - The unread/archive counts to summarize.
 * @returns The two-bucket overview summary string.
 */
export function summarizeOverview(overview: Overview): string {
  return `Unread: ${formatCounts(overview.unread)}. Archived: ${formatCounts(overview.archive)}.`;
}

/** A notification line item — the fields both list-style reads render. */
export interface NotificationLineItem {
  importance: string;
  title: string;
  subject: string;
  timestamp?: string | null;
  formattedTimestamp?: string | null;
}

/**
 * Renders one notification as `[IMPORTANCE] title — subject (when)`, where `when`
 * prefers the human `formattedTimestamp`, falls back to the raw `timestamp`, then a
 * placeholder (both are nullable in the SDL). Shared by notification_list and
 * notification_alerts so the line format has a single definition and test owner.
 *
 * @param notification - The notification fields to render.
 * @returns The single-line summary.
 */
export function summarizeLine(notification: NotificationLineItem): string {
  const when = notification.formattedTimestamp ?? notification.timestamp ?? "no timestamp";
  return `[${notification.importance}] ${notification.title} — ${notification.subject} (${when})`;
}
