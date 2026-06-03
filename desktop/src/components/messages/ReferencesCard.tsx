import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Search } from "lucide-react";
import type { SearchReference } from "../../types/search-references";
import { openSearchReference } from "../../utils/open-kb-reference";
import { dedupeReferencesByDoc, type DocGroup } from "../../utils/citation-doc-grouping";

type Props = {
  references: SearchReference[];
  searchedQueries?: string[];
};

const PREVIEW_LIMIT = 5;
const QUERY_PREVIEW_LIMIT = 3;

function buildSummary(
  refCount: number,
  kbCount: number,
  webCount: number,
  queryCount: number,
): string {
  if (kbCount > 0 && webCount === 0) {
    return `找到了 ${kbCount} 篇知识库资料`;
  }
  if (kbCount > 0 && webCount > 0) {
    return `参考 ${refCount} 篇资料（含知识库 ${kbCount} 篇）`;
  }
  if (queryCount > 0) {
    return `已检索 ${queryCount} 个关键词，参考 ${refCount} 篇资料`;
  }
  return `参考 ${refCount} 篇资料`;
}

export function ReferencesCard({ references, searchedQueries }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const queryCount = searchedQueries?.length ?? 0;
  // Collapse chunk-level references into one entry per document so a single
  // multi-chunk document (e.g. 南网技术实现需求.md) shows once, not 3x.
  const docGroups = useMemo(() => dedupeReferencesByDoc(references), [references]);
  const kbGroups = useMemo(() => docGroups.filter((g) => g.primary.source === "kb"), [docGroups]);
  const webGroups = useMemo(() => docGroups.filter((g) => g.primary.source === "web"), [docGroups]);
  const docCount = docGroups.length;
  const visible = showAll ? docGroups : docGroups.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, docGroups.length - PREVIEW_LIMIT);
  const queryPreview = (searchedQueries ?? []).slice(0, QUERY_PREVIEW_LIMIT);
  const hiddenQueryCount = Math.max(0, queryCount - QUERY_PREVIEW_LIMIT);

  const visibleKb = visible.filter((g) => g.primary.source === "kb");
  const visibleWeb = visible.filter((g) => g.primary.source === "web");
  const kbOnly = kbGroups.length > 0 && webGroups.length === 0;

  if (docCount === 0) return null;

  const summary = buildSummary(docCount, kbGroups.length, webGroups.length, queryCount);

  const renderKbList = (items: DocGroup[]) => (
    <ol
      className="space-y-0.5 rounded-lg px-2 py-1.5"
      style={{ backgroundColor: "var(--kb-citation-list-bg)" }}
    >
      {items.map((group) => {
        const ref = group.primary;
        const fragmentCount = group.chunks.length;
        return (
          <li key={`kb-${group.docKey}`} className="flex min-w-0 items-start gap-2 py-0.5">
            <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] tabular-nums text-text-faint">
              {group.docNumber}.
            </span>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left transition-opacity hover:opacity-90"
              title={ref.title}
              onClick={() => openSearchReference(ref)}
            >
              <span
                className="min-w-0 truncate text-[13px] font-medium"
                style={{ color: "var(--kb-citation-fg)" }}
              >
                {ref.title}
              </span>
              {fragmentCount > 1 ? (
                <span className="shrink-0 whitespace-nowrap text-[11px] text-text-faint">
                  · {fragmentCount} 个片段
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );

  const renderWebList = (items: DocGroup[]) => (
    <ol className="space-y-0.5">
      {items.map((group) => {
        const ref = group.primary;
        const domain = ref.domain || "";
        const clickable = /^https?:\/\//i.test(ref.url);
        return (
          <li
            key={`web-${group.docKey}`}
            className="flex min-w-0 items-start gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-surface-hover/20"
          >
            <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] tabular-nums text-text-faint">
              {group.docNumber}.
            </span>
            <div className="min-w-0 flex-1 leading-relaxed">
              {clickable ? (
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1 text-left text-[rgba(var(--theme-color-rgb,6,182,212),0.92)] transition-colors hover:text-[rgba(var(--theme-color-rgb,6,182,212),1)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,6,182,212),0.30)]"
                  title={ref.url}
                  onClick={() => openSearchReference(ref)}
                >
                  <span className="truncate">{ref.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-65" aria-hidden />
                </button>
              ) : (
                <span className="block truncate text-text-subtle" title={ref.url}>
                  {ref.title}
                </span>
              )}
              {domain ? (
                <span className="ml-1 whitespace-nowrap text-[11px] text-text-faint">· {domain}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="bg-transparent text-text-primary">
      <button
        type="button"
        className="flex w-full max-w-full items-center justify-start gap-2 px-0 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,6,182,212),0.30)]"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="flex w-[20px] shrink-0 items-center justify-center" aria-hidden>
          <Search
            className="h-[18px] w-[18px] text-[rgb(var(--theme-color-rgb,6,182,212))]"
            strokeWidth={2.2}
          />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate text-[13px] font-medium text-text-subtle">{summary}</span>
          <span className="shrink-0" aria-hidden>
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
            )}
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="relative mt-1.5 pb-1">
          {queryCount > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5 pl-[28px] text-[12px] leading-relaxed text-text-faint">
              {queryPreview.map((q) => (
                <span
                  key={q}
                  className="inline-flex max-w-full items-center rounded-md bg-[rgba(var(--theme-color-rgb,6,182,212),0.10)] px-2 py-0.5 text-text-subtle"
                >
                  <span className="truncate">“{q}”</span>
                </span>
              ))}
              {hiddenQueryCount > 0 ? (
                <span className="inline-flex items-center rounded-md bg-[rgba(var(--theme-color-rgb,6,182,212),0.08)] px-2 py-0.5 text-text-faint">
                  +{hiddenQueryCount}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2 pl-[28px] text-[13px] text-text-muted">
            {kbOnly && visibleKb.length > 0 ? (
              renderKbList(visibleKb)
            ) : (
              <>
                {visibleKb.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium tracking-wide text-text-faint">知识库</div>
                    {renderKbList(visibleKb)}
                  </div>
                ) : null}
                {visibleWeb.length > 0 ? (
                  <div className="space-y-1">
                    {visibleKb.length > 0 ? (
                      <div className="text-[11px] font-medium tracking-wide text-text-faint">网络</div>
                    ) : null}
                    {renderWebList(visibleWeb)}
                  </div>
                ) : null}
              </>
            )}
            {!showAll && hiddenCount > 0 ? (
              <button
                type="button"
                className="rounded-md px-1 py-0.5 text-[12px] text-[rgba(var(--theme-color-rgb,6,182,212),0.92)] transition-colors hover:bg-surface-hover/20 hover:text-[rgba(var(--theme-color-rgb,6,182,212),1)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,6,182,212),0.30)]"
                onClick={() => setShowAll(true)}
              >
                显示更多（+{hiddenCount}）
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
