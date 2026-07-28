"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WebSearchSource } from "@agenticx/core-api";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@agenticx/ui";
import { displayContentFromRawAssistantText } from "../../assistant-content";
import { createAssistantMdComponents } from "../../markdown/assistant-markdown-components";
import {
  artifactZipEntryPath,
  buildArtifactTree,
  formatArtifactByteSize,
  type ArtifactListItem,
  type ArtifactTreeNode,
} from "./deep-research-artifact-tree";
import { buildStoreZip } from "./zip-store";
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

/** Expand only top-level folders by default (children live in an inset group). */
function topLevelDirKeys(nodes: ArtifactTreeNode[]): string[] {
  return nodes.filter((n) => n.type === "dir").map((n) => n.key);
}

function ArtifactFileRow({
  node,
  onOpenFile,
  onDownloadFile,
}: {
  node: Extract<ArtifactTreeNode, { type: "file" }>;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
}) {
  return (
    <li className="group/file flex items-center gap-1 rounded-xl transition-colors hover:bg-background/80">
      <button
        type="button"
        onClick={() => onOpenFile(node.artifact.id)}
        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5 text-left"
        data-testid="deep-research-browse-file"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted/60 text-foreground/65">
          <IconDoc className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-5 text-foreground">
            {node.name}
          </span>
          <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted-foreground">
            {node.subtitle ?? formatArtifactByteSize(node.artifact.byteSize)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 group-hover/file:opacity-100"
        aria-label={`下载 ${node.name}`}
        data-testid="deep-research-file-download"
        onClick={(e) => {
          e.stopPropagation();
          onDownloadFile(node.artifact.id);
        }}
      >
        <IconDownload className="h-4 w-4" />
      </button>
    </li>
  );
}

function ArtifactBrowseRow({
  node,
  expanded,
  onToggle,
  onOpenFile,
  onDownloadFile,
}: {
  node: ArtifactTreeNode;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
}) {
  if (node.type === "dir") {
    const isOpen = expanded.has(node.key);
    return (
      <li className="mb-1">
        <button
          type="button"
          onClick={() => onToggle(node.key)}
          className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-muted/70 text-foreground/70">
            <IconFolder className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium leading-5 text-foreground">
              {node.name}
            </span>
            <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">
              {node.fileCount} 个文件 · {formatArtifactByteSize(node.byteSize)}
            </span>
          </span>
          <IconChevronDown
            className={[
              "mr-1 h-4 w-4 shrink-0 text-muted-foreground/80 transition-transform",
              isOpen ? "" : "-rotate-90",
            ].join(" ")}
          />
        </button>
        {isOpen ? (
          <div className="ml-3 mt-1 rounded-2xl bg-muted/35 p-1.5 ring-1 ring-border/40">
            <ul className="m-0 list-none space-y-0.5 p-0">
              {node.children.map((child) =>
                child.type === "file" ? (
                  <ArtifactFileRow
                    key={child.key}
                    node={child}
                    onOpenFile={onOpenFile}
                    onDownloadFile={onDownloadFile}
                  />
                ) : (
                  <ArtifactBrowseRow
                    key={child.key}
                    node={child}
                    expanded={expanded}
                    onToggle={onToggle}
                    onOpenFile={onOpenFile}
                    onDownloadFile={onDownloadFile}
                  />
                ),
              )}
            </ul>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <ArtifactFileRow node={node} onOpenFile={onOpenFile} onDownloadFile={onDownloadFile} />
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
  const [zipping, setZipping] = React.useState(false);

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
        setExpanded(new Set(topLevelDirKeys(treeNodes)));

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

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTextFile = (item: ArtifactListItem, text: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, item.path.split("/").pop() || "artifact.md");
  };

  const fetchArtifactText = React.useCallback(async (id: string): Promise<string> => {
    const res = await fetch(`/api/chat/artifacts/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { artifact?: { content?: string } };
    };
    return displayContentFromRawAssistantText(json.data?.artifact?.content ?? "");
  }, []);

  const downloadSelected = () => {
    const item = selected;
    if (!item || !previewMarkdown) return;
    downloadTextFile(item, previewMarkdown);
  };

  const downloadOneById = React.useCallback(
    (id: string) => {
      const item = artifacts.find((a) => a.id === id);
      if (!item) return;
      void (async () => {
        try {
          const text = await fetchArtifactText(id);
          if (text) downloadTextFile(item, text);
        } catch {
          // ignore
        }
      })();
    },
    [artifacts, fetchArtifactText],
  );

  const downloadAllAsZip = React.useCallback(() => {
    if (artifacts.length === 0 || zipping) return;
    setZipping(true);
    void (async () => {
      try {
        const entries = [];
        for (const item of artifacts) {
          try {
            const text = await fetchArtifactText(item.id);
            entries.push({
              path: artifactZipEntryPath(item, artifacts),
              data: new TextEncoder().encode(text),
            });
          } catch {
            // skip failed item
          }
        }
        if (entries.length === 0) return;
        const zipBlob = buildStoreZip(entries);
        const stamp = new Date().toISOString().slice(0, 10);
        triggerBlobDownload(zipBlob, `deep-research-files-${stamp}.zip`);
      } finally {
        setZipping(false);
      }
    })();
  }, [artifacts, fetchArtifactText, zipping]);

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
      <div className="flex shrink-0 items-center gap-0.5 px-4 pb-1 pt-3.5 sm:gap-1">
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
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {title}
        </div>
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
                disabled={artifacts.length === 0 || zipping}
                onClick={downloadAllAsZip}
                aria-label="下载所有文件"
                data-testid="deep-research-download-all"
              >
                <IconDownload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{zipping ? "打包中…" : "下载所有文件"}</TooltipContent>
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
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2"
          data-testid="deep-research-browse-list"
        >
          {loading ? <p className="px-3 text-xs text-muted-foreground">加载中…</p> : null}
          {error ? <p className="px-3 text-xs text-destructive">{error}</p> : null}
          {!loading && !error && tree.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">暂无文件</p>
          ) : null}
          {!loading && !error && tree.length > 0 ? (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {tree.map((node) => (
                <ArtifactBrowseRow
                  key={node.key}
                  node={node}
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
                  onDownloadFile={downloadOneById}
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
