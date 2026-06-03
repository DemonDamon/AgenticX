import { FileText } from "lucide-react";
import type { SearchReference } from "../../types/search-references";
import { formatReferenceSnippet } from "../../utils/reference-snippet";
import { openSearchReference } from "../../utils/open-kb-reference";

type Props = {
  reference: SearchReference;
  onClose?: () => void;
};

function fileIconLabel(title: string): string {
  const lower = title.toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "DOC";
  if (lower.endsWith(".md")) return "MD";
  return "DOC";
}

export function CitationPopover({ reference }: Props) {
  const snippet = formatReferenceSnippet(reference);
  const isKb = reference.source === "kb" || reference.url.startsWith("agx://kb/");

  return (
    <div
      className="w-[min(320px,calc(100vw-2rem))] rounded-xl border p-3 text-left shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
      style={{
        backgroundColor: "var(--surface-base-fallback, var(--surface-base))",
        borderColor: "color-mix(in srgb, var(--border-subtle) 72%, rgba(var(--theme-color-rgb), 0.28) 28%)",
      }}
      role="tooltip"
    >
      <div className="mb-2 text-[22px] leading-none text-text-faint" aria-hidden>
        “
      </div>
      {snippet ? (
        <p className="line-clamp-5 text-[13px] leading-relaxed text-text-muted">{snippet}</p>
      ) : (
        <p className="text-[12px] text-text-faint">暂无摘录</p>
      )}
      <div className="my-2.5 h-px bg-border-subtle" />
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 text-left transition-opacity hover:opacity-90"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openSearchReference(reference);
        }}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold"
          style={{
            backgroundColor: "var(--kb-citation-bg)",
            color: "var(--kb-citation-fg)",
          }}
        >
          {isKb ? fileIconLabel(reference.title) : <FileText className="h-3.5 w-3.5" aria-hidden />}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: "var(--kb-citation-fg)" }}
          title={reference.title}
        >
          {reference.title}
        </span>
      </button>
    </div>
  );
}
