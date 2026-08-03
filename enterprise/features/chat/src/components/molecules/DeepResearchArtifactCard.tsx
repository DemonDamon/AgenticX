"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { displayDeliveryFileName } from "./deep-research-delivery-prefs";

type ArtifactEvent = Extract<DeepResearchEvent, { type: "artifact" }>;

export type DeepResearchArtifactCardProps = {
  artifact: ArtifactEvent;
  onPreview?: (artifactId: string) => void;
};

/** Soft filled delivery card — shared with the all-files row. */
export const DELIVERY_CARD_CLASS = [
  "group/delivery flex w-full max-w-[24rem] items-center gap-3 rounded-2xl",
  "bg-muted/55 px-3.5 py-3 text-left",
  "transition-[transform,box-shadow,background-color] duration-200 ease-out",
  "hover:-translate-y-0.5 hover:bg-muted/85 hover:shadow-[0_10px_28px_rgba(15,23,42,0.08)]",
  "active:translate-y-0 active:shadow-none",
  "dark:hover:shadow-[0_10px_28px_rgba(0,0,0,0.35)]",
].join(" ");

export const DELIVERY_ICON_WELL_CLASS = [
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
  "bg-background text-foreground/70 shadow-sm",
  "transition-transform duration-200 ease-out group-hover/delivery:scale-105",
].join(" ");

function IconDoc({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" x2="16" y1="13" y2="13" />
      <line x1="8" x2="16" y1="17" y2="17" />
      <line x1="8" x2="12" y1="9" y2="9" />
    </svg>
  );
}

function fileNameFromArtifact(artifact: ArtifactEvent): string {
  return displayDeliveryFileName({ path: artifact.path, title: artifact.title });
}

export function DeepResearchArtifactCard({ artifact, onPreview }: DeepResearchArtifactCardProps) {
  return (
    <button
      type="button"
      onClick={() => onPreview?.(artifact.id)}
      className={DELIVERY_CARD_CLASS}
      data-testid="deep-research-artifact-card"
    >
      <span className={DELIVERY_ICON_WELL_CLASS}>
        <IconDoc className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-5 text-foreground">
          {fileNameFromArtifact(artifact)}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted-foreground">
          预览文件
        </span>
      </span>
    </button>
  );
}
