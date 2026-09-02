/** Codex-style message time: `YYYY-MM-DD HH:mm` (no seconds) from ms-epoch. */
export function formatMessageTimestamp(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Hover-revealed timestamp shown next to a message's action row. */
export function MessageTimestamp({ ts, align }: { ts?: number; align: "left" | "right" }) {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const label = formatMessageTimestamp(ts);
  if (!label) return null;
  // User rows: inside `.agx-im-user-actions-icons`, immediately left of 复制 (see index.css).
  if (align === "right") {
    return (
      <span className="agx-im-user-timestamp pointer-events-none select-none whitespace-nowrap text-[11px] leading-none text-text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    );
  }
  return (
    <span className="pointer-events-none ml-3 select-none whitespace-nowrap text-[13px] leading-none text-text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {label}
    </span>
  );
}
