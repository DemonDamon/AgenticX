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
import { hostnameFromUrl } from "../../utils/web-search-citation";

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
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle>搜索网页</SheetTitle>
          <SheetDescription>{sources.length} 个结果</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-1">
            {sources.map((source, index) => {
              const index1Based = index + 1;
              const host = hostnameFromUrl(source.url) ?? source.url;
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
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {index1Based}.
                      </span>
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                        {source.title || source.url}
                      </span>
                    </div>
                    {source.snippet ? (
                      <p className="mb-1.5 line-clamp-3 pl-5 text-xs leading-relaxed text-muted-foreground">
                        {source.snippet}
                      </p>
                    ) : null}
                    <p className="truncate pl-5 text-[11px] text-muted-foreground/80">{host}</p>
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
