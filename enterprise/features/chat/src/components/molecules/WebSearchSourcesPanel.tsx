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
import { hostnameFromUrl, siteLabelFromSource } from "../../utils/web-search-citation";
import { WebSearchFavicon } from "./WebSearchFavicon";

type WebSearchSourcesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: WebSearchSource[];
  /** 1-based index to scroll into view when opened */
  highlightIndex?: number | null;
};

export function WebSearchSourcesPanel({
  open,
  onOpenChange,
  sources,
  highlightIndex = null,
}: WebSearchSourcesPanelProps) {
  const itemRefs = React.useRef<Map<number, HTMLAnchorElement>>(new Map());

  React.useEffect(() => {
    if (!open || !highlightIndex) return;
    const el = itemRefs.current.get(highlightIndex);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, highlightIndex]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle>搜索网页 {sources.length}</SheetTitle>
          <SheetDescription className="sr-only">共 {sources.length} 个结果</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-1">
            {sources.map((source, index) => {
              const index1Based = index + 1;
              // Real hostname only — never pass display label / raw URL into favicon fetch.
              const host = hostnameFromUrl(source.url) ?? "";
              const siteLabel = siteLabelFromSource(source, index1Based);
              const highlighted = highlightIndex === index1Based;
              return (
                <li key={`${index1Based}-${source.url}`}>
                  <a
                    ref={(node) => {
                      if (node) itemRefs.current.set(index1Based, node);
                      else itemRefs.current.delete(index1Based);
                    }}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className={[
                      "block rounded-xl px-3 py-3 transition-colors hover:bg-muted/70",
                      highlighted ? "bg-muted ring-1 ring-border" : "",
                    ].join(" ")}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <WebSearchFavicon host={host} label={siteLabel} size={20} rounded="md" />
                      <span className="truncate text-xs text-muted-foreground">{siteLabel}</span>
                    </div>
                    <div className="mb-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                      {source.title || source.url}
                    </div>
                    {source.snippet ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {source.snippet}
                      </p>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
