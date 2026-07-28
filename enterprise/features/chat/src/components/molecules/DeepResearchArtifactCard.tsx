"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";

type ArtifactEvent = Extract<DeepResearchEvent, { type: "artifact" }>;

export type DeepResearchArtifactCardProps = {
  artifact: ArtifactEvent;
  onPreview?: (artifactId: string) => void;
};

function IconDoc({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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
  const fromPath = artifact.path.split("/").pop()?.trim();
  if (fromPath) return fromPath;
  const title = artifact.title.trim();
  if (title.toLowerCase().endsWith(".md")) return title;
  return `${title || "report"}.md`;
}

export function DeepResearchArtifactCard({ artifact, onPreview }: DeepResearchArtifactCardProps) {
  return (
    <button
      type="button"
      onClick={() => onPreview?.(artifact.id)}
      className="flex w-full max-w-xl items-center gap-3 rounded-2xl border border-border/55 bg-muted/35 px-3.5 py-3 text-left transition-colors hover:bg-muted/55"
      data-testid="deep-research-artifact-card"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-background text-muted-foreground shadow-sm">
        <IconDoc className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {fileNameFromArtifact(artifact)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">预览文件</span>
      </span>
      <span className="shrink-0 rounded-lg border border-border/50 bg-background px-2.5 py-1 text-xs font-medium text-foreground/80">
        预览
      </span>
    </button>
  );
}
