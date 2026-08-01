"use client";

import * as React from "react";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import { OriginalPdfViewer } from "./OriginalPdfViewer";
import "../../markdown/chat-prism-themes.css";

export type AttachmentContentPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachment: ChatMessageAttachment | null;
  className?: string;
};

function IconClose({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconDownload({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function IconExpand({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconCompress({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function IconZoomIn({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="11" x2="11" y1="8" y2="14" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </svg>
  );
}

function IconZoomOut({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
      <line x1="8" x2="14" y1="11" y2="11" />
    </svg>
  );
}

function triggerTextDownload(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function originalUrl(attachmentId: string): string {
  return `/api/chat/attachments/${encodeURIComponent(attachmentId)}`;
}

function downloadOriginal(attachmentId: string): void {
  const anchor = document.createElement("a");
  anchor.href = `${originalUrl(attachmentId)}?download=1`;
  anchor.rel = "noopener";
  anchor.click();
}

type PreviewMode = "pdf" | "image" | "text";

function resolvePreviewMode(attachment: ChatMessageAttachment): PreviewMode {
  if (attachment.attachment_id) {
    const mime = (attachment.mime_type || "").toLowerCase();
    if (mime === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf")) {
      return "pdf";
    }
    if (mime.startsWith("image/")) return "image";
  }
  return "text";
}

/**
 * Docked right pane for attachment preview.
 * Prefers original PDF/image when attachment_id is present; otherwise parsed_text Markdown.
 */
export function AttachmentContentPanel({
  open,
  onOpenChange,
  attachment,
  className,
}: AttachmentContentPanelProps) {
  const [fullscreen, setFullscreen] = React.useState(false);
  const [scalePercent, setScalePercent] = React.useState(100);
  const [originalError, setOriginalError] = React.useState<string | null>(null);
  const [clientReady, setClientReady] = React.useState(false);
  const components = React.useMemo(() => createAssistantMdComponents({ variant: "document" }), []);
  const body = attachment?.parsed_text?.trim() ?? "";
  const title = attachment?.name ?? "附件";
  const mode = attachment ? resolvePreviewMode(attachment) : "text";
  const useOriginal = Boolean(attachment?.attachment_id) && mode !== "text" && !originalError;
  const showZoom = useOriginal;

  React.useEffect(() => {
    setClientReady(true);
  }, []);

  React.useEffect(() => {
    if (!open) {
      setFullscreen(false);
      setScalePercent(100);
      setOriginalError(null);
    }
  }, [open]);

  React.useEffect(() => {
    setScalePercent(100);
    setOriginalError(null);
  }, [attachment?.attachment_id, attachment?.name]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (!open || !attachment) return null;

  const canDownloadOriginal = Boolean(attachment.attachment_id);
  const canDownloadText = Boolean(body);
  const downloadDisabled = !canDownloadOriginal && !canDownloadText;

  return (
    <aside
      className={[
        fullscreen
          ? "fixed inset-0 z-50 flex min-h-0 w-full flex-col bg-background shadow-2xl"
          : "flex h-full min-h-0 w-[min(48%,36rem)] shrink-0 flex-col border-l border-border bg-background",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="attachment-content-panel"
      aria-label="附件预览"
    >
      <div className="flex shrink-0 items-center gap-0.5 px-4 pb-1 pt-3.5 sm:gap-1">
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{title}</div>
        {showZoom ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  disabled={scalePercent <= 50}
                  onClick={() => setScalePercent((v) => Math.max(50, v - 10))}
                  aria-label="缩小"
                >
                  <IconZoomOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>缩小</TooltipContent>
            </Tooltip>
            <span className="w-10 shrink-0 text-center text-xs text-muted-foreground">{scalePercent}%</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  disabled={scalePercent >= 300}
                  onClick={() => setScalePercent((v) => Math.min(300, v + 10))}
                  aria-label="放大"
                >
                  <IconZoomIn className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>放大</TooltipContent>
            </Tooltip>
          </>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => setFullscreen((v) => !v)}
              aria-label={fullscreen ? "退出全屏" : "全屏预览"}
            >
              {fullscreen ? <IconCompress className="h-4 w-4" /> : <IconExpand className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fullscreen ? "退出全屏" : "全屏预览"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              disabled={downloadDisabled}
              onClick={() => {
                if (attachment.attachment_id) {
                  downloadOriginal(attachment.attachment_id);
                  return;
                }
                if (body) {
                  triggerTextDownload(body, title.endsWith(".md") ? title : `${title}.md`);
                }
              }}
              aria-label="下载"
            >
              <IconDownload className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{canDownloadOriginal ? "下载原文件" : "下载解析文本"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                setFullscreen(false);
                onOpenChange(false);
              }}
              aria-label="关闭"
            >
              <IconClose className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>关闭</TooltipContent>
        </Tooltip>
      </div>

      <div
        className={[
          "min-h-0 flex-1 overflow-y-auto px-5 py-4",
          fullscreen ? "mx-auto w-full max-w-4xl px-6 py-8 sm:px-10" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {clientReady && useOriginal && attachment.attachment_id && mode === "pdf" ? (
          <OriginalPdfViewer
            url={originalUrl(attachment.attachment_id)}
            scale={scalePercent / 100}
            onError={(message) => setOriginalError(message)}
          />
        ) : null}

        {clientReady && useOriginal && attachment.attachment_id && mode === "image" ? (
          <div className="flex justify-center">
            <img
              src={originalUrl(attachment.attachment_id)}
              alt={title}
              className="max-w-full rounded border border-border object-contain"
              style={{ width: `${scalePercent}%` }}
              onError={() => setOriginalError("原图加载失败")}
            />
          </div>
        ) : null}

        {!useOriginal ? (
          <>
            {originalError || (attachment.attachment_id && mode === "text") ? (
              <p className="mb-3 text-xs text-muted-foreground">
                {originalError
                  ? `原件预览不可用（${originalError}），已回退到解析文本。`
                  : attachment.attachment_id
                    ? "该格式暂不支持浏览器内原件渲染，已显示解析文本；可下载原文件。"
                    : "文件超过保留上限或未保留原件，仅可预览解析文本。"}
              </p>
            ) : null}
            {body ? (
              <div className="agx-assistant-md agx-assistant-md--document max-w-none break-words text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                  {body}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无可用正文（可能为视频占位或未解析）。</p>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}
