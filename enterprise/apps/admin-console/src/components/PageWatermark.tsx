"use client";

import { createElement, type ReactElement } from "react";

type PageWatermarkProps = {
  text: string;
  testId?: string;
};

export function resolvePageWatermarkText(
  envValue: string | undefined,
  fallback = "demo@agenticx.local",
): string {
  const v = (envValue || "").trim();
  return v || fallback;
}

/** Non-interactive diagonal watermark overlay for compliance screenshots. */
export function PageWatermark({ text, testId = "page-watermark" }: PageWatermarkProps): ReactElement | null {
  const label = text.trim();
  if (!label) return null;
  return createElement(
    "div",
    {
      "data-testid": testId,
      "aria-hidden": "true",
      className: "pointer-events-none fixed inset-0 z-[60] overflow-hidden select-none",
    },
    createElement(
      "div",
      {
        className:
          "absolute inset-[-20%] flex rotate-[-24deg] flex-wrap content-start gap-x-24 gap-y-28 opacity-[0.08]",
      },
      Array.from({ length: 48 }).map((_, i) =>
        createElement(
          "span",
          {
            key: i,
            className: "whitespace-nowrap text-sm font-medium tracking-wide text-foreground",
          },
          label,
        ),
      ),
    ),
  );
}
