"use client";

import * as React from "react";
import type { ChatMessageDeepResearch } from "@agenticx/core-api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import { Download, Eye, FileText, Printer } from "lucide-react";
import { DeepResearchArtifactCard } from "./DeepResearchArtifactCard";
import {
  exportActionKeyForFormat,
  inferDeliveryFormat,
  isPrimaryDeliveryArtifactPath,
  type ClientDeliveryFormat,
} from "./deep-research-delivery-prefs";
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
      className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border/45 bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-muted/40"
      data-testid="deep-research-all-files-card"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-muted/70 text-foreground/70">
        <IconFolder className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5 text-foreground">
          全部文件
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted-foreground">
          预览或者下载文件
        </span>
      </span>
    </button>
  );
}

function hasCompletedReportArtifact(
  deepResearch: ChatMessageDeepResearch,
): boolean {
  if (deepResearch.status !== "completed") return false;
  return deepResearch.events.some(
    (event) =>
      event.type === "artifact" &&
      event.kind === "report" &&
      (event.path.toLowerCase().includes("final-report") ||
        event.path.toLowerCase().endsWith("report.html") ||
        event.path.toLowerCase().endsWith("report.md")),
  );
}

function exportUrl(runId: string, format: "html" | "md" | "docx", inline?: boolean): string {
  const qs = new URLSearchParams({ format });
  if (inline) qs.set("inline", "1");
  return `/api/chat/deep-research/runs/${encodeURIComponent(runId)}/export?${qs.toString()}`;
}

function ExportActions({
  runId,
  primaryFormat,
}: {
  runId: string;
  primaryFormat: ClientDeliveryFormat;
}) {
  const openHtml = React.useCallback(
    (printAfterLoad: boolean) => {
      const href = exportUrl(runId, "html", true);
      const win = window.open(href, "_blank", "noopener,noreferrer");
      if (!win || !printAfterLoad) return;
      // Best-effort print once the report document is ready.
      const timer = window.setInterval(() => {
        try {
          if (win.closed) {
            window.clearInterval(timer);
            return;
          }
          if (win.document?.readyState === "complete") {
            window.clearInterval(timer);
            win.focus();
            win.print();
          }
        } catch {
          window.clearInterval(timer);
        }
      }, 300);
      window.setTimeout(() => window.clearInterval(timer), 15_000);
    },
    [runId],
  );

  const emphasized = exportActionKeyForFormat(primaryFormat);

  const actions = [
    {
      key: "view-html" as const,
      label: "查看可视化报告",
      icon: Eye,
      onClick: () => openHtml(false),
    },
    {
      key: "download-md" as const,
      label: "下载 Markdown",
      icon: FileText,
      onClick: () => {
        window.location.assign(exportUrl(runId, "md"));
      },
    },
    {
      key: "download-docx" as const,
      label: "下载 Word",
      icon: Download,
      onClick: () => {
        window.location.assign(exportUrl(runId, "docx"));
      },
    },
    {
      key: "print-pdf" as const,
      label: "打印 / 存为 PDF",
      icon: Printer,
      onClick: () => openHtml(true),
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-1 pt-1"
      data-testid="deep-research-export-actions"
    >
      {actions.map((action) => {
        const Icon = action.icon;
        const isPrimary = action.key === emphasized;
        return (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={action.onClick}
                className={[
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors hover:bg-muted/60",
                  isPrimary
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                aria-label={action.label}
                data-primary-export={isPrimary ? "true" : undefined}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{action.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Delivery strip: one primary report card + folder card for all files.
 * Render after the completion summary so deliverables sit at the end of the turn.
 */
export function DeepResearchDelivery({
  deepResearch,
  onOpenArtifact,
  onOpenFiles,
  className,
}: DeepResearchDeliveryProps) {
  const primaryFormat = React.useMemo(
    () => inferDeliveryFormat(deepResearch.clarifyAnswers),
    [deepResearch.clarifyAnswers],
  );

  const deliveryArtifacts = React.useMemo(
    () =>
      collectDeepResearchDeliveryArtifacts(deepResearch.events).filter((artifact) =>
        isPrimaryDeliveryArtifactPath(artifact.path, primaryFormat),
      ),
    [deepResearch.events, primaryFormat],
  );

  const totalCount = deepResearch.artifactIds?.length ?? 0;
  const showAllFiles = totalCount > 0 && Boolean(onOpenFiles);
  const terminal =
    deepResearch.status === "completed" ||
    deepResearch.status === "failed" ||
    deepResearch.status === "cancelled";
  const showExport = hasCompletedReportArtifact(deepResearch);

  // Show as soon as a report artifact exists; also after terminal if any files remain.
  if (deliveryArtifacts.length === 0 && !(terminal && showAllFiles) && !showExport) {
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
      {showExport ? (
        <ExportActions runId={deepResearch.runId} primaryFormat={primaryFormat} />
      ) : null}
    </div>
  );
}
