"use client";

import * as React from "react";
import type { WebSearchSource } from "@agenticx/core-api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@agenticx/ui";
import { hostnameFromUrl, partitionSourcesByUsage, siteLabelFromSource } from "../../utils/web-search-citation";
import { WebSearchFavicon } from "./WebSearchFavicon";

type WebSearchSourcesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: WebSearchSource[];
  /** 1-based index to scroll into view when opened */
  highlightIndex?: number | null;
  onOpenExternalUrl?: (url: string, title?: string) => void;
};

function SourceListItem({
  source,
  index1Based,
  highlighted,
  muted,
  itemRefs,
  onOpenExternalUrl,
}: {
  source: WebSearchSource;
  index1Based: number;
  highlighted: boolean;
  muted?: boolean;
  itemRefs: React.MutableRefObject<Map<number, HTMLAnchorElement>>;
  onOpenExternalUrl?: (url: string, title?: string) => void;
}) {
  const host = hostnameFromUrl(source.url) ?? "";
  const siteLabel = siteLabelFromSource(source, index1Based);
  return (
    <li>
      <a
        ref={(node) => {
          if (node) itemRefs.current.set(index1Based, node);
          else itemRefs.current.delete(index1Based);
        }}
        href={source.url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          if (!onOpenExternalUrl) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenExternalUrl(source.url, source.title || source.url);
        }}
        className={[
          "flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-muted/70",
          highlighted ? "bg-primary/10" : "",
          muted ? "opacity-70" : "",
        ].join(" ")}
      >
        <WebSearchFavicon host={host} label={siteLabel} size={18} rounded="md" />
        <span className="min-w-0 flex-1 truncate text-sm leading-5 text-foreground">
          {source.title || source.url}
        </span>
        <span className="max-w-[7.5rem] shrink-0 truncate text-xs text-muted-foreground">
          {siteLabel}
        </span>
      </a>
    </li>
  );
}

export function WebSearchSourcesPanel({
  open,
  onOpenChange,
  sources,
  highlightIndex = null,
  onOpenExternalUrl,
}: WebSearchSourcesPanelProps) {
  const itemRefs = React.useRef<Map<number, HTMLAnchorElement>>(new Map());
  const { used, unused } = partitionSourcesByUsage(sources);

  React.useEffect(() => {
    if (!open || !highlightIndex) return;
    const el = itemRefs.current.get(highlightIndex);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, highlightIndex]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle>引用来源 {sources.length}</SheetTitle>
          <SheetDescription className="sr-only">共 {sources.length} 个引用来源</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-1">
            {used.map(({ source, index1Based }) => (
              <SourceListItem
                key={`used-${index1Based}-${source.url}`}
                source={source}
                index1Based={index1Based}
                highlighted={highlightIndex === index1Based}
                itemRefs={itemRefs}
                onOpenExternalUrl={onOpenExternalUrl}
              />
            ))}
          </ul>
          {unused.length > 0 ? (
            <div className="mt-4">
              <div className="mb-2 px-3 text-xs font-medium text-muted-foreground">
                未纳入本次回答（{unused.length}）
              </div>
              <ul className="space-y-1">
                {unused.map(({ source, index1Based }) => (
                  <SourceListItem
                    key={`unused-${index1Based}-${source.url}`}
                    source={source}
                    index1Based={index1Based}
                    highlighted={highlightIndex === index1Based}
                    muted
                    itemRefs={itemRefs}
                    onOpenExternalUrl={onOpenExternalUrl}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
