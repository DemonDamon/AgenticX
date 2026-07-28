"use client";

import * as React from "react";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import "../../markdown/chat-prism-themes.css";

export type AttachmentContentPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachment: ChatMessageAttachment | null;
  className?: string;
};

function IconClose({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconDownload({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function IconExpand({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconCompress({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
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

/**
 * Docked right pane for parsed attachment preview (Kimi-style split view).
 * Sits beside chat — not a modal Sheet overlay.
 */
export function AttachmentContentPanel({
  open,
  onOpenChange,
  attachment,
  className,
}: AttachmentContentPanelProps) {
  const [fullscreen, setFullscreen] = React.useState(false);
  const components = React.useMemo(() => createAssistantMdComponents({ variant: "document" }), []);
  const body = attachment?.parsed_text?.trim() ?? "";
  const title = attachment?.name ?? "附件";

  React.useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (!open || !attachment) return null;

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
              disabled={!body}
              onClick={() => triggerTextDownload(body, title.endsWith(".md") ? title : `${title}.md`)}
              aria-label="下载"
            >
              <IconDownload className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>下载</TooltipContent>
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
          fullscreen ? "mx-auto w-full max-w-3xl px-6 py-8 sm:px-10" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {body ? (
          <div className="agx-assistant-md agx-assistant-md--document max-w-none break-words text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {body}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">暂无可用正文（可能为视频占位或未解析）。</p>
        )}
      </div>
    </aside>
  );
}
