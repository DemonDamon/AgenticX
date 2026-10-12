/** 中文相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 日期（同年省年份）。 */
export function formatRelative(input: string | number): string {
  const date = typeof input === "number" ? new Date(input) : new Date(input);
  const ts = date.getTime();
  if (Number.isNaN(ts)) {
    return typeof input === "string" ? input : String(input);
  }
  const now = Date.now();
  const diffMs = now - ts;
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "昨天";
  const now2 = new Date(now);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (date.getFullYear() === now2.getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${date.getFullYear()}年${month}月${day}日`;
}
