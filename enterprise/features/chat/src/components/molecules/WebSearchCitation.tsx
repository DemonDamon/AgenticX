"use client";

import * as React from "react";
import type { WebSearchSource } from "@agenticx/core-api";
import {
  hostnameFromUrl,
  siteLabelFromSource,
} from "../../utils/web-search-citation";

type WebSearchCitationProps = {
  index1Based: number;
  source: WebSearchSource;
  onOpenInSheet?: (index1Based: number) => void;
};

export function WebSearchCitation({ index1Based, source, onOpenInSheet }: WebSearchCitationProps) {
  const label = siteLabelFromSource(source, index1Based);
  const host = hostnameFromUrl(source.url) ?? label;
  const favicon = host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
    : null;
  const [faviconFailed, setFaviconFailed] = React.useState(false);

  const openUrl = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) {
      onOpenInSheet?.(index1Based);
      return;
    }
    window.open(source.url, "_blank", "noopener,noreferrer");
  };

  return (
    <span className="group/cite relative inline-block align-baseline">
      <button
        type="button"
        onClick={openUrl}
        className="mx-0.5 inline-flex max-w-[10rem] items-center truncate rounded-full border border-border/60 bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
        title={source.title || source.url}
      >
        {label}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 hidden w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg group-hover/cite:block"
      >
        <span className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
            {favicon && !faviconFailed ? (
              <img
                src={favicon}
                alt=""
                width={16}
                height={16}
                className="h-4 w-4"
                onError={() => setFaviconFailed(true)}
              />
            ) : (
              (host.charAt(0) || "?").toUpperCase()
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">{host}</span>
        </span>
        <span className="mb-1 block text-sm font-semibold leading-snug text-foreground">
          {source.title || source.url}
        </span>
        {source.snippet ? (
          <span className="line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
            {source.snippet}
          </span>
        ) : null}
      </span>
    </span>
  );
}
