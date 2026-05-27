import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { SearchReference } from "../../types/search-references";
import { openExternalUrl } from "../../utils/open-external";

type Props = {
  id: number;
  reference?: SearchReference;
};

export function CitationBadge({ id, reference }: Props) {
  const [open, setOpen] = useState(false);
  const resolved = Boolean(reference);
  const clickable = resolved && /^https?:\/\//i.test(reference!.url);

  const label = useMemo(() => {
    if (!reference) return String(id);
    if (reference.source === "kb") return reference.title.slice(0, 12) || "KB";
    return reference.domain || reference.title.slice(0, 12) || String(id);
  }, [id, reference]);

  return (
    <span className="relative inline-flex align-baseline">
      <button
        type="button"
        className={`mx-0.5 inline-flex h-4 max-w-[9rem] items-center rounded px-1 text-[11px] leading-none tabular-nums transition-colors ${
          resolved
            ? open
              ? "cursor-pointer bg-[rgba(var(--theme-color-rgb,6,182,212),0.18)] text-text-subtle ring-1 ring-[rgba(var(--theme-color-rgb,6,182,212),0.28)]"
              : "cursor-pointer bg-zinc-200/80 text-text-subtle hover:bg-zinc-300/80 dark:bg-white/10 dark:hover:bg-white/15"
            : "cursor-default bg-zinc-100/70 text-text-faint dark:bg-white/5"
        }`}
        aria-label={resolved ? `引用 ${id}: ${reference!.title}` : `引用 ${id}`}
        onClick={() => {
          if (!resolved) return;
          setOpen((v) => !v);
        }}
      >
        <span className="truncate">{label}</span>
      </button>
      {open && reference ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[80] cursor-default bg-black/25 backdrop-blur-[1px]"
            aria-label="关闭引用详情"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute bottom-full left-0 z-[81] mb-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-lg bg-surface-base p-3 text-left shadow-[0_10px_36px_rgba(0,0,0,0.55)]"
            style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-base))" }}
          >
            <div className="mb-1 flex items-start gap-1.5 text-[11px] text-text-faint">
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="line-clamp-2">{reference.domain || reference.title}</span>
            </div>
            <div className="text-[13px] font-semibold leading-snug text-text-strong">{reference.title}</div>
            {reference.domain ? (
              <div className="mt-1 text-[11px] text-text-faint">{reference.domain}</div>
            ) : reference.source === "kb" ? (
              <div className="mt-1 text-[11px] text-text-faint">知识库</div>
            ) : null}
            {reference.snippet ? (
              <p className="mt-2 line-clamp-4 text-[12px] leading-relaxed text-text-muted">{reference.snippet}</p>
            ) : null}
            {clickable ? (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-[12px] text-[rgba(var(--theme-color-rgb,6,182,212),0.92)] hover:underline"
                onClick={() => openExternalUrl(reference.url)}
              >
                打开原文 ↗
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </span>
  );
}
