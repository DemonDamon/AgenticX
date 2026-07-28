"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WebSearchSource } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import { displayContentFromRawAssistantText } from "../../assistant-content";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import "../../markdown/chat-prism-themes.css";

export type ArtifactListItem = {
  id: string;
  path: string;
  title: string;
  kind: string;
  byteSize: number;
  mimeType?: string;
};

export type DeepResearchFilesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /** Prefetch / highlight this artifact when opening */
  focusArtifactId?: string | null;
  /** Session web-search sources so [N] citations render as clickable site chips. */
  sources?: WebSearchSource[];
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

/** Four-corner expand — matches common “全屏预览” affordance. */
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

/**
 * Docked right preview pane (not a modal Sheet).
 * Parent places this in a horizontal flex next to the chat column so chat narrows.
 * Closes only via the header ✕ — does not dismiss on outside click.
 */
export function DeepResearchFilesPanel({
  open,
  onOpenChange,
  sessionId,
  focusArtifactId = null,
  sources,
  className,
}: DeepResearchFilesPanelProps) {
  const [artifacts, setArtifacts] = React.useState<ArtifactListItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [previewRaw, setPreviewRaw] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);

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

  const mdComponents = React.useMemo(
    () =>
      createAssistantMdComponents({
        sources,
        variant: "document",
      }),
    [sources],
  );

  React.useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/artifacts`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: { artifacts?: ArtifactListItem[] } };
        if (cancelled) return;
        const list = json.data?.artifacts ?? [];
        setArtifacts(list);
        const focus = focusArtifactId && list.find((a) => a.id === focusArtifactId);
        const first = focus ?? list.find((a) => a.kind === "report") ?? list[0] ?? null;
        if (first) setSelectedId(first.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, focusArtifactId]);

  React.useEffect(() => {
    if (!open || !selectedId) {
      setPreviewRaw("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/chat/artifacts/${encodeURIComponent(selectedId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          data?: { artifact?: { content?: string } };
        };
        if (!cancelled) setPreviewRaw(json.data?.artifact?.content ?? "");
      } catch {
        if (!cancelled) setPreviewRaw("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedId]);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const previewMarkdown = React.useMemo(
    () => displayContentFromRawAssistantText(previewRaw),
    [previewRaw],
  );

  const downloadSelected = () => {
    const item = selected;
    if (!item || !previewMarkdown) return;
    const blob = new Blob([previewMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.path.split("/").pop() || "artifact.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open || !sessionId) return null;

  const title = selected?.title || selected?.path.split("/").pop() || "全部文件";

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
      data-testid="deep-research-files-panel"
      data-fullscreen={fullscreen ? "true" : "false"}
      aria-label="文件预览"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2.5 sm:gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</div>
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
              {fullscreen ? (
                <IconCompress className="h-4 w-4" />
              ) : (
                <IconExpand className="h-4 w-4" />
              )}
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
              onClick={downloadSelected}
              disabled={!previewMarkdown}
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
              aria-label="关闭预览"
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
        {loading ? <p className="text-xs text-muted-foreground">加载中…</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {!loading && !error && previewMarkdown ? (
          <div className="agx-assistant-md agx-assistant-md--document max-w-none break-words text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {previewMarkdown}
            </ReactMarkdown>
          </div>
        ) : null}
        {!loading && !error && !previewMarkdown ? (
          <p className="text-xs text-muted-foreground">暂无可预览内容</p>
        ) : null}
      </div>
    </aside>
  );
}
