import type { SVGProps } from "react";

/** Inline SVG for message-quote chips in contenteditable composer (non-React DOM).
 *  Cursor-style: compact colored vertical bars (book stack).
 */
export function composerQuoteIconInnerHtml(sizePx = 12): string {
  return (
    `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" ` +
    `class="agx-composer-inline-chip-icon agx-composer-quote-chip-icon" ` +
    `style="width:${sizePx}px;height:${sizePx}px;display:inline;vertical-align:-0.1em;margin-right:0.28em">` +
    `<rect x="2.2" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#f59e0b"/>` +
    `<rect x="5.3" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#22c55e"/>` +
    `<rect x="8.4" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#38bdf8"/>` +
    `<rect x="11.5" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#f43f5e"/>` +
    `</svg>`
  );
}

/** React icon for quote chips inside message bubbles. */
export function ComposerQuoteIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className ?? "agx-composer-inline-chip-icon h-[0.95em] w-[0.95em] shrink-0"}
      {...props}
    >
      <rect x="2.2" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#f59e0b" />
      <rect x="5.3" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#22c55e" />
      <rect x="8.4" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#38bdf8" />
      <rect x="11.5" y="3.2" width="2.1" height="9.6" rx="0.55" fill="#f43f5e" />
    </svg>
  );
}

/** Short chip label — Cursor-like compact preview, not a full sentence. */
export function formatQuoteChipLabel(body: string, maxLen = 16): string {
  const compact = String(body || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "引用";
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}…`;
}
