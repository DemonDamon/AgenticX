"use client";

import * as React from "react";
import type { ChatMessageDeepResearch } from "@agenticx/core-api";
import { DeepResearchArtifactCard } from "./DeepResearchArtifactCard";
import { collectDeepResearchDeliveryArtifacts } from "./deep-research-segments";

export type DeepResearchDeliveryProps = {
  deepResearch: ChatMessageDeepResearch;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenFiles?: () => void;
  className?: string;
};

function IconFolder({ className }: { className?: string }) {
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
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function AllFilesCard({ onOpen }: { onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full max-w-xl items-center gap-3 rounded-2xl border border-border/55 bg-muted/35 px-3.5 py-3 text-left transition-colors hover:bg-muted/55"
      data-testid="deep-research-all-files-card"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-background text-muted-foreground shadow-sm">
        <IconFolder className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">全部文件</span>
        <span className="block truncate text-xs text-muted-foreground">预览或者下载文件</span>
      </span>
      <span className="shrink-0 rounded-lg border border-border/50 bg-background px-2.5 py-1 text-xs font-medium text-foreground/80">
        预览
      </span>
    </button>
  );
}

/**
 * Kimi-style delivery strip: final report card(s) + folder card for all files.
 * Render after the report body so deliverables sit at the end of the turn.
 */
export function DeepResearchDelivery({
  deepResearch,
  onOpenArtifact,
  onOpenFiles,
  className,
}: DeepResearchDeliveryProps) {
  const deliveryArtifacts = React.useMemo(
    () => collectDeepResearchDeliveryArtifacts(deepResearch.events),
    [deepResearch.events],
  );

  const totalCount = deepResearch.artifactIds?.length ?? 0;
  const showAllFiles = totalCount > 0 && Boolean(onOpenFiles);
  const terminal =
    deepResearch.status === "completed" ||
    deepResearch.status === "failed" ||
    deepResearch.status === "cancelled";

  // Show as soon as a report artifact exists; also after terminal if any files remain.
  if (deliveryArtifacts.length === 0 && !(terminal && showAllFiles)) {
    return null;
  }

  return (
    <div
      className={["mt-4 space-y-2", className].filter(Boolean).join(" ")}
      data-testid="deep-research-delivery"
    >
      {deliveryArtifacts.map((artifact) => (
        <DeepResearchArtifactCard
          key={artifact.id}
          artifact={artifact}
          onPreview={onOpenArtifact}
        />
      ))}
      {showAllFiles ? <AllFilesCard onOpen={onOpenFiles} /> : null}
    </div>
  );
}
