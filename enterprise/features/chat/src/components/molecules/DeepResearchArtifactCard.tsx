"use client";

import * as React from "react";
import type { DeepResearchEvent } from "@agenticx/core-api";

type ArtifactEvent = Extract<DeepResearchEvent, { type: "artifact" }>;

export type DeepResearchArtifactCardProps = {
  artifact: ArtifactEvent;
  onPreview?: (artifactId: string) => void;
};

export function DeepResearchArtifactCard({ artifact, onPreview }: DeepResearchArtifactCardProps) {
  return (
    <button
      type="button"
      onClick={() => onPreview?.(artifact.id)}
      className="mb-2 flex w-full max-w-md items-center gap-3 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
      data-testid="deep-research-artifact-card"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background text-xs font-semibold text-muted-foreground">
        MD
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{artifact.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{artifact.path}</span>
      </span>
      <span className="shrink-0 text-xs text-primary">预览</span>
    </button>
  );
}
