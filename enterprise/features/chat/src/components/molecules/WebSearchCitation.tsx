"use client";

import * as React from "react";
import type { WebSearchSource } from "@agenticx/core-api";
import {
  hostnameFromUrl,
  siteLabelFromSource,
} from "../../utils/web-search-citation";
import { WebSearchFavicon } from "./WebSearchFavicon";

type WebSearchCitationProps = {
  index1Based: number;
  source: WebSearchSource;
  onOpenInSheet?: (index1Based: number) => void;
};

function WebSearchCitationImpl({ index1Based, source, onOpenInSheet }: WebSearchCitationProps) {
  const label = siteLabelFromSource(source, index1Based);
  // Must be a real hostname for favicon CDNs — never fall back to display label ("Zhihu").
  const host = hostnameFromUrl(source.url) ?? "";

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
        className="mx-0.5 inline-flex max-w-[10rem] items-center gap-1 truncate rounded-md bg-muted/80 px-1.5 py-0.5 align-middle text-[11px] font-medium leading-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title={source.title || source.url}
      >
        {host ? <WebSearchFavicon host={host} label={label} size={12} rounded="md" /> : null}
        <span className="truncate">{label}</span>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 z-50 hidden w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border/80 bg-popover p-3.5 text-left text-popover-foreground shadow-xl group-hover/cite:block"
      >
        <span className="mb-2.5 flex items-center gap-2">
          {host ? <WebSearchFavicon host={host} label={label} size={22} rounded="lg" /> : null}
          <span className="truncate text-xs text-muted-foreground">{host || label}</span>
        </span>
        <span className="mb-1.5 block text-[13px] font-semibold leading-snug text-foreground">
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

/** Memoized so composer keystrokes / streaming chunks do not re-render every chip. */
export const WebSearchCitation = React.memo(WebSearchCitationImpl);
