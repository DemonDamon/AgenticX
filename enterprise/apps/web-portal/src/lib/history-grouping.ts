export type HistoryListItem = {
  id: string;
  title: string;
  createdAt: number;
  pinnedAt?: number | null;
  preview?: string;
};

export function getSessionCreatedTimestampMs(session: Pick<HistoryListItem, "createdAt">): number {
  const created = Number(session.createdAt);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

/** Pin first, then created_at desc (stable by id). */
export function sortHistorySessions(rows: HistoryListItem[]): HistoryListItem[] {
  return [...rows].sort((a, b) => {
    const aPinned = a.pinnedAt && a.pinnedAt > 0 ? a.pinnedAt : 0;
    const bPinned = b.pinnedAt && b.pinnedAt > 0 ? b.pinnedAt : 0;
    if (aPinned !== bPinned) {
      if (aPinned === 0) return 1;
      if (bPinned === 0) return -1;
      return bPinned - aPinned;
    }
    const tsDiff = getSessionCreatedTimestampMs(b) - getSessionCreatedTimestampMs(a);
    if (tsDiff !== 0) return tsDiff;
    return b.id.localeCompare(a.id);
  });
}

export function groupHistory(
  history: HistoryListItem[],
  labels: {
    pinned: string;
    today: string;
    yesterday: string;
    week: string;
    month: string;
    older: string;
  },
): Array<{ key: string; label: string; items: HistoryListItem[] }> {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 3600 * 1000;
  const startWeek = startToday - 7 * 24 * 3600 * 1000;
  const startMonth = startToday - 30 * 24 * 3600 * 1000;
  const buckets = {
    pinned: [] as HistoryListItem[],
    today: [] as HistoryListItem[],
    yesterday: [] as HistoryListItem[],
    week: [] as HistoryListItem[],
    month: [] as HistoryListItem[],
    older: [] as HistoryListItem[],
  };
  for (const item of history) {
    if (item.pinnedAt && item.pinnedAt > 0) {
      buckets.pinned.push(item);
      continue;
    }
    const createdAt = getSessionCreatedTimestampMs(item);
    if (createdAt >= startToday) buckets.today.push(item);
    else if (createdAt >= startYesterday) buckets.yesterday.push(item);
    else if (createdAt >= startWeek) buckets.week.push(item);
    else if (createdAt >= startMonth) buckets.month.push(item);
    else buckets.older.push(item);
  }
  return [
    { key: "pinned", label: labels.pinned, items: buckets.pinned },
    { key: "today", label: labels.today, items: buckets.today },
    { key: "yesterday", label: labels.yesterday, items: buckets.yesterday },
    { key: "week", label: labels.week, items: buckets.week },
    { key: "month", label: labels.month, items: buckets.month },
    { key: "older", label: labels.older, items: buckets.older },
  ].filter((group) => group.items.length > 0);
}

export function formatHistoryRelativeTime(
  createdAtMs: number,
  locale: string,
): string {
  if (!createdAtMs) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 3600 * 1000;
  if (createdAtMs >= startToday) {
    return new Date(createdAtMs).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (createdAtMs >= startYesterday) {
    return locale === "zh" ? "昨天" : "Yesterday";
  }
  const date = new Date(createdAtMs);
  if (locale === "zh") {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
