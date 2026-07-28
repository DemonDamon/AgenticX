"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WebSearchSource } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import { displayContentFromRawAssistantText } from "../../assistant-content";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import {
  buildArtifactTree,
  formatArtifactByteSize,
  type ArtifactListItem,
  type ArtifactTreeNode,
} from "./deep-research-artifact-tree";
import "../../markdown/chat-prism-themes.css";

export type { ArtifactListItem };

export type DeepResearchFilesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /**
   * When set, open directly on that file's preview (终稿「预览»).
   * When null/undefined, open the browse list (「全部文件」).
   */
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

function IconBack({ className }: { className?: string }) {
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
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

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
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

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
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" x2="16" y1="13" y2="13" />
      <line x1="8" x2="16" y1="17" y2="17" />
      <line x1="8" x2="12" y1="9" y2="9" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function collectDirKeys(nodes: ArtifactTreeNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.type !== "dir") continue;
    keys.push(node.key);
    keys.push(...collectDirKeys(node.children));
  }
  return keys;
}

function ArtifactBrowseRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
}: {
  node: ArtifactTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenFile: (id: string) => void;
}) {
  if (node.type === "dir") {
    const isOpen = expanded.has(node.key);
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(node.key)}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background text-muted-foreground">
            <IconFolder className="h-4.5 w-4.5 h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{node.name}</span>
            <span className="block text-xs text-muted-foreground">
              {formatArtifactByteSize(node.byteSize)}
            </span>
          </span>
          <IconChevronDown
            className={[
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              isOpen ? "" : "-rotate-90",
            ].join(" ")}
          />
        </button>
        {isOpen ? (
          <ul className="m-0 list-none p-0">
            {node.children.map((child) => (
              <ArtifactBrowseRow
                key={child.key}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenFile(node.artifact.id)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
        style={{ paddingLeft: 8 + depth * 14 }}
        data-testid="deep-research-browse-file"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background text-muted-foreground">
          <IconDoc className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{node.name}</span>
          <span className="block text-xs text-muted-foreground">
            {formatArtifactByteSize(node.artifact.byteSize)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Docked right pane: browse list for「全部文件」, or markdown preview for a focused file.
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
  const [view, setView] = React.useState<"browse" | "preview">("browse");
  const [previewRaw, setPreviewRaw] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());

  const tree = React.useMemo(() => buildArtifactTree(artifacts), [artifacts]);

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
        const treeNodes = buildArtifactTree(list);
        setExpanded(new Set(collectDirKeys(treeNodes)));

        const focus = focusArtifactId ? list.find((a) => a.id === focusArtifactId) : null;
        if (focus) {
          setSelectedId(focus.id);
          setView("preview");
        } else {
          setSelectedId(null);
          setView("browse");
        }
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
    if (!open || view !== "preview" || !selectedId) {
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
  }, [open, view, selectedId]);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const previewMarkdown = React.useMemo(
    () => displayContentFromRawAssistantText(previewRaw),
    [previewRaw],
  );

  const downloadTextFile = (item: ArtifactListItem, text: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.path.split("/").pop() || "artifact.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSelected = () => {
    const item = selected;
    if (!item || !previewMarkdown) return;
    downloadTextFile(item, previewMarkdown);
  };

  const downloadPrimaryFromBrowse = () => {
    const item = artifacts.find((a) => a.kind === "report") ?? artifacts[0] ?? null;
    if (!item) return;
    void (async () => {
      try {
        const res = await fetch(`/api/chat/artifacts/${encodeURIComponent(item.id)}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: { artifact?: { content?: string } };
        };
        const text = displayContentFromRawAssistantText(json.data?.artifact?.content ?? "");
        if (text) downloadTextFile(item, text);
      } catch {
        // ignore
      }
    })();
  };

  if (!open || !sessionId) return null;

  const browsing = view === "browse";
  const title = browsing
    ? "全部文件"
    : selected?.path.split("/").pop() || selected?.title || "文件预览";

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
      data-view={view}
      data-fullscreen={fullscreen ? "true" : "false"}
      aria-label={browsing ? "全部文件" : "文件预览"}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2.5 sm:gap-2">
        {!browsing ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setFullscreen(false);
              setView("browse");
              setSelectedId(null);
            }}
            aria-label="返回全部文件"
          >
            <IconBack className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</div>
        {!browsing ? (
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
        ) : null}
        {!browsing ? (
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
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                disabled={artifacts.length === 0}
                onClick={downloadPrimaryFromBrowse}
                aria-label="下载"
              >
                <IconDownload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载终稿</TooltipContent>
          </Tooltip>
        )}
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

      {browsing ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="deep-research-browse-list">
          {loading ? <p className="px-2 text-xs text-muted-foreground">加载中…</p> : null}
          {error ? <p className="px-2 text-xs text-destructive">{error}</p> : null}
          {!loading && !error && tree.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">暂无文件</p>
          ) : null}
          {!loading && !error && tree.length > 0 ? (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {tree.map((node) => (
                <ArtifactBrowseRow
                  key={node.key}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={(key) => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  onOpenFile={(id) => {
                    setSelectedId(id);
                    setView("preview");
                  }}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
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
      )}
    </aside>
  );
}
