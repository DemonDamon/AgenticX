/**
 * Portal-style web sources: favicon stack +「引用」chip, and a list of
 * favicon + title + site-label rows (no raw URL dump).
 *
 * Author: Damon Li
 */

import { useMemo, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SearchReference } from "../../types/search-references";
import { siteLabelFromUrl } from "../../utils/favicon-url";
import { openSearchReference } from "../../utils/open-kb-reference";
import { dedupeReferencesByDoc, type DocGroup } from "../../utils/citation-doc-grouping";
import { SiteFavicon } from "../work-panel/SiteFavicon";

type CitationSourcesCardProps = {
  references: SearchReference[];
  /** Open the workspace refs section instead of expanding an in-bubble list. */
  onOpen?: () => void;
  /** meta: sit on the 20px action / model row. */
  variant?: "inline" | "meta";
};

function FaviconStack({ groups, variant = "inline" }: { groups: DocGroup[]; variant?: "inline" | "meta" }) {
  const isMeta = variant === "meta";
  return (
    <span className="flex items-center -space-x-1.5">
      {groups.slice(0, 3).map((group, idx) => {
        const ref = group.primary;
        return (
          <span
            key={`fav-${group.docKey}-${idx}`}
            className={
              isMeta
                ? "flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-black/25 bg-neutral-200 text-neutral-800 shadow-sm [html[data-theme=light]_&]:border-black/15"
                : "flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-[var(--surface-base)] bg-[var(--surface-base)] shadow-sm"
            }
          >
            <SiteFavicon
              url={ref.url}
              domain={ref.domain}
              className="h-3.5 w-3.5"
              size={16}
            />
          </span>
        );
      })}
    </span>
  );
}

export function WebSearchSourceRow({
  reference,
  index1Based,
}: {
  reference: SearchReference;
  index1Based: number;
}) {
  const siteLabel = siteLabelFromUrl(reference.url, reference.domain, index1Based);
  const clickable = /^https?:\/\//i.test(reference.url);
  const title = reference.title || reference.url;
  return (
    <li>
      {clickable ? (
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover/70"
          title={reference.url}
          onClick={() => openSearchReference(reference)}
        >
          <SiteFavicon
            url={reference.url}
            domain={reference.domain}
            className="h-[18px] w-[18px] rounded-md"
            size={18}
          />
          <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-text-strong">
            {title}
          </span>
          <span className="max-w-[7.5rem] shrink-0 truncate text-[12px] text-text-faint">
            {siteLabel}
          </span>
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2">
          <SiteFavicon
            url={reference.url}
            domain={reference.domain}
            className="h-[18px] w-[18px] rounded-md"
            size={18}
          />
          <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-text-muted">
            {title}
          </span>
          <span className="max-w-[7.5rem] shrink-0 truncate text-[12px] text-text-faint">
            {siteLabel}
          </span>
        </div>
      )}
    </li>
  );
}

/** Favicon + site label — portal inline citation chip. */
export function WebSearchCitationChip({
  reference,
  docNumber,
  buttonRef,
  open,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  reference: SearchReference;
  docNumber: number;
  buttonRef?: Ref<HTMLButtonElement>;
  open?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const label = siteLabelFromUrl(reference.url, reference.domain, docNumber);
  return (
    <button
      ref={buttonRef}
      type="button"
      className="mx-0.5 inline-flex max-w-[10rem] items-center gap-1 truncate rounded-md bg-surface-hover/80 px-1.5 py-0.5 align-middle text-[11px] font-medium leading-4 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
      title={reference.title || reference.url}
      aria-label={`引用 ${docNumber}: ${reference.title || reference.url}`}
      aria-expanded={open}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SiteFavicon
        url={reference.url}
        domain={reference.domain}
        className="h-3 w-3 rounded-sm"
        size={16}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function CitationSourcesCard({
  references,
  onOpen,
  variant = "inline",
}: CitationSourcesCardProps) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => dedupeReferencesByDoc(references), [references]);
  if (groups.length === 0) return null;

  const opensWorkspace = typeof onOpen === "function";
  const isMeta = variant === "meta";
  const showList = !opensWorkspace && !isMeta && expanded;

  return (
    <div
      className={
        isMeta
          ? "inline-flex min-w-0 shrink-0 items-center"
          : "bg-transparent text-text-primary"
      }
      data-citation-chip={isMeta ? "meta" : "inline"}
    >
      <button
        type="button"
        className={[
          "group/cite inline-flex max-w-full items-center gap-1.5 rounded-full",
          "transition-[transform,background-color,color] duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb),0.30)]",
          isMeta
            ? "h-5 bg-surface-card-strong py-0 pl-1 pr-1.5 text-[12px] text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            : "h-7 bg-surface-hover/55 py-0 pl-1 pr-2 text-[12px] text-text-muted hover:-translate-y-px hover:bg-surface-hover hover:text-text-strong",
        ].join(" ")}
        onClick={() => {
          if (opensWorkspace) {
            onOpen();
            return;
          }
          if (!isMeta) setExpanded((v) => !v);
        }}
        aria-expanded={opensWorkspace || isMeta ? undefined : expanded}
        aria-label={t("citation.sourcesCount", { count: groups.length })}
      >
        <span className="transition-transform duration-200 ease-out group-hover/cite:scale-[1.04]">
          <FaviconStack groups={groups} variant={variant} />
        </span>
        <span className="truncate font-medium">{t("citation.sources")}</span>
        <span className="shrink-0" aria-hidden>
          {showList ? (
            <ChevronDown className="h-3 w-3 text-text-faint" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-faint" strokeWidth={2} />
          )}
        </span>
      </button>

      {showList ? (
        <ul className="mt-1.5 space-y-0.5">
          {groups.map((group) => (
            <WebSearchSourceRow
              key={`web-${group.docKey}`}
              reference={group.primary}
              index1Based={group.docNumber}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
