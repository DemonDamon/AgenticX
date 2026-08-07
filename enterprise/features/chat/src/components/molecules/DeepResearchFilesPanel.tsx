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
  isHtmlArtifact,
  prepareHtmlPreviewSrcDoc,
  type ArtifactListItem,
  type ArtifactTreeNode,
} from "./deep-research-artifact-tree";
import {
  clampFilesPanelWidth,
  defaultFilesPanelWidth,
} from "./deep-research-files-panel-resize";
import {
  artifactRequestErrorMessage,
  normalizeArtifactRequestError,
  readArtifactErrorCode,
} from "./deep-research-artifact-errors";
import { buildStoreZip } from "./zip-store";
import { laneSourceHost, type LaneSource } from "./deep-research-lane-sources";
import { WebSearchFavicon } from "./WebSearchFavicon";
import "../../markdown/chat-prism-themes.css";

export type { ArtifactListItem };

/** A research lane plus every page it searched. */
export type DeepResearchPanelLane = { title: string; sources: LaneSource[] };

export type DeepResearchFilesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /**
   * When set, open directly on that file's preview (终稿「预览»).
   * When null/undefined, open the browse list (「全部文件」).
   */
  focusArtifactId?: string | null;
  /**
   * When set (and no focusArtifactId), open on that lane's searched pages.
   * Clicking a page previews its archived full text, or opens the original URL.
   */
  focusLane?: DeepResearchPanelLane | null;
  /** Session web-search sources so [N] citations render as clickable site chips. */
  sources?: WebSearchSource[];
  /** Route external research sources through the host application's interstitial. */
  onOpenExternalUrl?: (url: string, title?: string) => void;
  className?: string;
};

function IconExternalLink({ className }: { className?: string }) {
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
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

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

function IconSun({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
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
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
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
  nested = false,
}: {
  node: Extract<ArtifactTreeNode, { type: "file" }>;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  /** Inside an expanded folder — slightly tighter chrome. */
  nested?: boolean;
}) {
  return (
    <li
      className={[
        "group/file flex items-center gap-0.5 rounded-xl",
        "transition-[background-color,transform,box-shadow] duration-200 ease-out",
        "hover:bg-background hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)]",
        "dark:hover:shadow-[0_4px_14px_rgba(0,0,0,0.28)]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => onOpenFile(node.artifact.id)}
        className={[
          "flex min-w-0 flex-1 items-center gap-2.5 text-left",
          nested ? "px-2 py-2" : "px-2.5 py-2.5",
        ].join(" ")}
        data-testid="deep-research-browse-file"
      >
        <span
          className={[
            "flex shrink-0 items-center justify-center rounded-full bg-background text-foreground/65 shadow-sm",
            "transition-transform duration-200 group-hover/file:scale-105",
            nested ? "h-8 w-8" : "h-9 w-9",
          ].join(" ")}
        >
          <IconDoc className={nested ? "h-4 w-4" : "h-[18px] w-[18px]"} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-5 text-foreground">
            {node.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
            {node.subtitle ?? formatArtifactByteSize(node.artifact.byteSize)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover/file:opacity-100"
        aria-label={`下载 ${node.name}`}
        data-testid="deep-research-file-download"
        onClick={(e) => {
          e.stopPropagation();
          onDownloadFile(node.artifact.id);
        }}
      >
        <IconDownload className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function LaneSourceCard({
  source,
  onOpen,
  onOpenExternalUrl,
}: {
  source: LaneSource;
  onOpen: (source: LaneSource) => void;
  onOpenExternalUrl?: (url: string, title?: string) => void;
}) {
  const host = laneSourceHost(source.url);
  return (
    <li className="group/source flex items-start gap-1 rounded-xl transition-colors hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onOpen(source)}
        className="flex min-w-0 flex-1 items-start gap-3 px-2.5 py-2.5 text-left"
        data-testid="deep-research-panel-source"
      >
        <span className="mt-0.5 shrink-0">
          <WebSearchFavicon host={host} label={source.title} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[12px] leading-4 text-muted-foreground">
              {host}
            </span>
            {source.fetched ? (
              <span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
                已读取
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[14px] font-medium leading-5 text-foreground">
            {source.title || source.url}
          </span>
          {source.snippet ? (
            <span className="mt-1 line-clamp-2 block text-[12px] leading-[18px] text-muted-foreground">
              {source.snippet}
            </span>
          ) : null}
        </span>
      </button>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          if (!onOpenExternalUrl) return;
          e.preventDefault();
          onOpenExternalUrl(source.url, source.title || source.url);
        }}
        className="mr-1.5 mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 group-hover/source:opacity-100"
        aria-label="打开原网页"
        data-testid="deep-research-panel-source-external"
      >
        <IconExternalLink className="h-4 w-4" />
      </a>
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
      <li className="mb-1.5">
        <button
          type="button"
          onClick={() => onToggle(node.key)}
          className={[
            "group/dir flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left",
            "bg-muted/40 transition-[background-color,transform,box-shadow] duration-200 ease-out",
            "hover:-translate-y-px hover:bg-muted/70",
            "hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]",
            "dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)]",
            isOpen ? "bg-muted/55" : "",
          ].join(" ")}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground/70 shadow-sm transition-transform duration-200 group-hover/dir:scale-105">
            <IconFolder className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium leading-5 text-foreground">
              {node.name}
            </span>
            <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">
              {node.fileCount} 个文件 · {formatArtifactByteSize(node.byteSize)}
            </span>
          </span>
          <IconChevronDown
            className={[
              "mr-1 h-4 w-4 shrink-0 text-muted-foreground/80 transition-transform duration-200",
              isOpen ? "" : "-rotate-90",
            ].join(" ")}
          />
        </button>
        {isOpen ? (
          <ul className="relative m-0 mt-1.5 list-none space-y-0.5 border-l border-border/50 py-0.5 pl-3 ml-[1.35rem] p-0">
            {node.children.map((child) =>
              child.type === "file" ? (
                <ArtifactFileRow
                  key={child.key}
                  node={child}
                  nested
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
  focusLane = null,
  sources,
  onOpenExternalUrl,
  className,
}: DeepResearchFilesPanelProps) {
  const [artifacts, setArtifacts] = React.useState<ArtifactListItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"browse" | "preview" | "sources">("browse");
  /** Where a preview was entered from, so the back button returns there. */
  const [previewOrigin, setPreviewOrigin] = React.useState<"browse" | "sources">("browse");
  const [previewRaw, setPreviewRaw] = React.useState<string>("");
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [zipping, setZipping] = React.useState(false);
  const [panelWidthPx, setPanelWidthPx] = React.useState(480);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const userResizedRef = React.useRef(false);

  const tree = React.useMemo(() => buildArtifactTree(artifacts), [artifacts]);

  const measureContainerWidth = React.useCallback(() => {
    return (
      panelRef.current?.parentElement?.clientWidth ||
      (typeof window !== "undefined" ? window.innerWidth : 1200)
    );
  }, []);

  React.useEffect(() => {
    if (!open) {
      setFullscreen(false);
      userResizedRef.current = false;
      return;
    }
    // Initial docked width (browse); HTML focus may widen below.
    setPanelWidthPx(defaultFilesPanelWidth(measureContainerWidth(), { htmlPreview: false }));
  }, [open, sessionId, measureContainerWidth]);

  const onResizePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (fullscreen || event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidthPx;
      const containerPx = measureContainerWidth();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        // Drag handle left → wider panel; right → narrower panel.
        const next = clampFilesPanelWidth(startWidth + (startX - moveEvent.clientX), containerPx);
        userResizedRef.current = true;
        setPanelWidthPx(next);
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [fullscreen, panelWidthPx, measureContainerWidth],
  );

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
        onOpenExternalUrl,
      }),
    [sources, onOpenExternalUrl],
  );

  React.useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/artifacts`);
        if (!res.ok) {
          throw new Error(
            artifactRequestErrorMessage(res.status, "list", await readArtifactErrorCode(res)),
          );
        }
        const json = (await res.json()) as { data?: { artifacts?: ArtifactListItem[] } };
        if (cancelled) return;
        const list = json.data?.artifacts ?? [];
        setArtifacts(list);
        const treeNodes = buildArtifactTree(list);
        setExpanded(new Set(topLevelDirKeys(treeNodes)));

        const focus = focusArtifactId ? list.find((a) => a.id === focusArtifactId) : null;
        if (focus) {
          setSelectedId(focus.id);
          setPreviewOrigin("browse");
          setView("preview");
        } else if (focusLane) {
          setSelectedId(null);
          setView("sources");
          setFullscreen(false);
        } else {
          setSelectedId(null);
          setView("browse");
          setFullscreen(false);
        }
      } catch (err) {
        if (!cancelled) setError(normalizeArtifactRequestError(err, "list"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, focusArtifactId, focusLane]);

  React.useEffect(() => {
    if (!open || view !== "preview" || !selectedId) {
      setPreviewRaw("");
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    // Clear immediately so HTML/markdown previews never flash the previous file.
    setPreviewRaw("");
    setPreviewError(null);
    setPreviewLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/chat/artifacts/${encodeURIComponent(selectedId)}`);
        if (!res.ok) {
          throw new Error(
            artifactRequestErrorMessage(res.status, "preview", await readArtifactErrorCode(res)),
          );
        }
        const json = (await res.json()) as {
          data?: { artifact?: { content?: string } };
        };
        if (!cancelled) setPreviewRaw(json.data?.artifact?.content ?? "");
      } catch (err) {
        if (!cancelled) {
          setPreviewRaw("");
          setPreviewError(normalizeArtifactRequestError(err, "preview"));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, view, selectedId]);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const selectedIsHtml = isHtmlArtifact(selected);
  const previewMarkdown = React.useMemo(
    () => (selectedIsHtml ? "" : displayContentFromRawAssistantText(previewRaw)),
    [previewRaw, selectedIsHtml],
  );
  const hasPreview = selectedIsHtml ? previewRaw.trim().length > 0 : previewMarkdown.length > 0;

  // Portal theme → report.html (iframe sandbox cannot read parent localStorage).
  // Toolbar icon toggles preview theme; portal theme changes re-sync.
  const [portalDark, setPortalDark] = React.useState(false);
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => {
      setPortalDark(
        root.classList.contains("dark") ||
          root.getAttribute("data-theme") === "dark" ||
          root.dataset.theme === "dark",
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  const htmlSrcDoc = React.useMemo(
    () => (selectedIsHtml ? prepareHtmlPreviewSrcDoc(previewRaw, portalDark) : ""),
    [selectedIsHtml, previewRaw, portalDark],
  );

  // Prefer a wider docked width for HTML so the report TOC can sit beside content
  // when the viewport allows — never force fullscreen; user may drag or toggle.
  React.useEffect(() => {
    if (!open || fullscreen || userResizedRef.current) return;
    if (view === "preview" && selectedIsHtml) {
      setPanelWidthPx(defaultFilesPanelWidth(measureContainerWidth(), { htmlPreview: true }));
    }
  }, [open, fullscreen, view, selectedIsHtml, selectedId, measureContainerWidth]);

  // Keep the panel inside constraints when the window shrinks.
  React.useEffect(() => {
    if (!open || fullscreen) return;
    const onWinResize = () => {
      setPanelWidthPx((width) => clampFilesPanelWidth(width, measureContainerWidth()));
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [open, fullscreen, measureContainerWidth]);

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTextFile = (item: ArtifactListItem, text: string) => {
    const pathLower = item.path.toLowerCase();
    const mime = (item.mimeType ?? "").toLowerCase();
    const isDoc =
      pathLower.endsWith(".doc") || mime.includes("msword") || mime.includes("ms-word");
    const html = isHtmlArtifact(item);
    const blobType = isDoc
      ? "application/vnd.ms-word;charset=utf-8"
      : html
        ? "text/html;charset=utf-8"
        : "text/markdown;charset=utf-8";
    const fallbackName = isDoc ? "report.doc" : html ? "report.html" : "artifact.md";
    triggerBlobDownload(new Blob([text], { type: blobType }), item.path.split("/").pop() || fallbackName);
  };

  const fetchArtifactText = React.useCallback(
    async (id: string, itemHint?: ArtifactListItem): Promise<string> => {
      const res = await fetch(`/api/chat/artifacts/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error(
          artifactRequestErrorMessage(res.status, "download", await readArtifactErrorCode(res)),
        );
      }
      const json = (await res.json()) as {
        data?: {
          artifact?: { content?: string; path?: string; mimeType?: string };
        };
      };
      const art = json.data?.artifact;
      const content = art?.content ?? "";
      const meta = {
        path: art?.path ?? itemHint?.path ?? "",
        mimeType: art?.mimeType ?? itemHint?.mimeType,
      };
      // Keep HTML bytes intact — assistant markdown stripping would corrupt the document.
      if (isHtmlArtifact(meta)) return content;
      return displayContentFromRawAssistantText(content);
    },
    [],
  );

  const downloadSelected = () => {
    const item = selected;
    if (!item || !hasPreview) return;
    downloadTextFile(item, selectedIsHtml ? previewRaw : previewMarkdown);
  };

  const downloadOneById = React.useCallback(
    (id: string) => {
      const item = artifacts.find((a) => a.id === id);
      if (!item) return;
      setError(null);
      void (async () => {
        try {
          const text = await fetchArtifactText(id, item);
          if (text) downloadTextFile(item, text);
        } catch (err) {
          setError(normalizeArtifactRequestError(err, "download"));
        }
      })();
    },
    [artifacts, fetchArtifactText],
  );

  const downloadAllAsZip = React.useCallback(() => {
    if (artifacts.length === 0 || zipping) return;
    setZipping(true);
    setError(null);
    void (async () => {
      try {
        const entries = [];
        let lastDownloadError: unknown = null;
        for (const item of artifacts) {
          try {
            const text = await fetchArtifactText(item.id, item);
            entries.push({
              path: artifactZipEntryPath(item, artifacts),
              data: new TextEncoder().encode(text),
            });
          } catch (err) {
            lastDownloadError = err;
            // skip failed item; surface if nothing ends up packable
          }
        }
        if (entries.length === 0) {
          setError(
            lastDownloadError
              ? normalizeArtifactRequestError(lastDownloadError, "download")
              : "文件下载失败，请稍后重试",
          );
          return;
        }
        const zipBlob = buildStoreZip(entries);
        const stamp = new Date().toISOString().slice(0, 10);
        triggerBlobDownload(zipBlob, `deep-research-files-${stamp}.zip`);
      } catch (err) {
        setError(normalizeArtifactRequestError(err, "download"));
      } finally {
        setZipping(false);
      }
    })();
  }, [artifacts, fetchArtifactText, zipping]);

  if (!open || !sessionId) return null;

  const browsing = view === "browse";
  const sourcesView = view === "sources";
  const previewing = view === "preview";
  const laneSources = focusLane?.sources ?? [];
  const title = browsing
    ? "全部文件"
    : sourcesView
      ? `网页搜索 ${laneSources.length}`
      : selected?.path.split("/").pop() || selected?.title || "文件预览";

  // Archived full text lives in the artifact list; fall back to the live page.
  const openLaneSource = (source: LaneSource) => {
    const archived = source.archivedPath
      ? artifacts.find((a) => a.path === source.archivedPath)
      : undefined;
    if (archived) {
      setSelectedId(archived.id);
      setPreviewOrigin("sources");
      setView("preview");
      return;
    }
    if (onOpenExternalUrl) {
      onOpenExternalUrl(source.url, source.title || source.url);
    } else {
      window.open(source.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <aside
      ref={panelRef}
      className={[
        fullscreen
          ? "fixed inset-0 z-50 flex min-h-0 w-full flex-col bg-background shadow-2xl"
          : "relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-background",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={fullscreen ? undefined : { width: panelWidthPx }}
      data-testid="deep-research-files-panel"
      data-view={view}
      data-fullscreen={fullscreen ? "true" : "false"}
      data-panel-width={fullscreen ? undefined : String(panelWidthPx)}
      aria-label={browsing ? "全部文件" : sourcesView ? "网页搜索来源" : "文件预览"}
    >
      {!fullscreen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整文件区宽度"
          aria-valuenow={panelWidthPx}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const containerPx = measureContainerWidth();
            const step = event.shiftKey ? 48 : 16;
            // ArrowLeft grows the files panel (chat shrinks); ArrowRight shrinks it.
            const delta = event.key === "ArrowLeft" ? step : -step;
            userResizedRef.current = true;
            setPanelWidthPx(clampFilesPanelWidth(panelWidthPx + delta, containerPx));
          }}
          className="group/resize absolute left-0 top-0 z-20 hidden h-full w-3 -translate-x-1/2 cursor-col-resize touch-none sm:block"
          data-testid="deep-research-files-resize-handle"
        >
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border transition-all duration-150 group-hover/resize:w-1 group-hover/resize:bg-primary group-active/resize:w-1 group-active/resize:bg-primary" />
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5 px-4 pb-1 pt-3.5 sm:gap-1">
        {!browsing ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setFullscreen(false);
              setSelectedId(null);
              setView(previewing && previewOrigin === "sources" ? "sources" : "browse");
            }}
            aria-label={
              previewing && previewOrigin === "sources" ? "返回来源列表" : "返回全部文件"
            }
          >
            <IconBack className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {title}
          {sourcesView && focusLane?.title ? (
            <span className="ml-2 truncate text-[12px] font-normal text-muted-foreground">
              {focusLane.title}
            </span>
          ) : null}
        </div>
        {previewing && selectedIsHtml ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => setPortalDark((v) => !v)}
                aria-label={portalDark ? "切换为浅色" : "切换为深色"}
                data-testid="deep-research-html-theme-toggle"
              >
                {portalDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{portalDark ? "浅色" : "深色"}</TooltipContent>
          </Tooltip>
        ) : null}
        {previewing ? (
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
        {previewing ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={downloadSelected}
                disabled={!hasPreview}
                aria-label="下载"
              >
                <IconDownload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载</TooltipContent>
          </Tooltip>
        ) : sourcesView ? null : (
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
          {error ? (
            <p
              className="mb-2 px-3 text-xs text-destructive"
              role="alert"
              data-testid="deep-research-files-error"
            >
              {error}
            </p>
          ) : null}
          {!loading && tree.length === 0 && !error ? (
            <p className="px-3 text-xs text-muted-foreground">暂无文件</p>
          ) : null}
          {!loading && tree.length > 0 ? (
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
                    setError(null);
                    setSelectedId(id);
                    setView("preview");
                  }}
                  onDownloadFile={downloadOneById}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : sourcesView ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2"
          data-testid="deep-research-sources-list"
        >
          {laneSources.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">暂无来源</p>
          ) : (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {laneSources.map((source, i) => (
                <LaneSourceCard
                  key={`${source.url}-${i}`}
                  source={source}
                  onOpen={openLaneSource}
                  onOpenExternalUrl={onOpenExternalUrl}
                />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div
          className={[
            "min-h-0 flex-1",
            selectedIsHtml
              ? "flex flex-col overflow-hidden bg-background"
              : "overflow-y-auto px-5 py-4",
            !selectedIsHtml && fullscreen ? "mx-auto w-full max-w-3xl px-6 py-8 sm:px-10" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {previewLoading ? (
            <p className="px-5 py-4 text-xs text-muted-foreground">加载中…</p>
          ) : null}
          {previewError ? (
            <p className="px-5 py-4 text-xs text-destructive">{previewError}</p>
          ) : null}
          {!previewLoading && !previewError && selectedIsHtml && htmlSrcDoc.trim() ? (
            <iframe
              key={selectedId ?? title}
              title={title}
              srcDoc={htmlSrcDoc}
              // Scripts needed for Mermaid CDN; content is tenant-owned report HTML.
              sandbox="allow-scripts allow-popups allow-downloads"
              className="h-full min-h-0 w-full flex-1 border-0 bg-transparent"
              data-testid="deep-research-html-preview"
            />
          ) : null}
          {!previewLoading && !previewError && !selectedIsHtml && previewMarkdown ? (
            <div className="agx-assistant-md agx-assistant-md--document max-w-none break-words text-base">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {previewMarkdown}
              </ReactMarkdown>
            </div>
          ) : null}
          {!previewLoading && !previewError && !hasPreview ? (
            <p className="px-5 py-4 text-xs text-muted-foreground">暂无可预览内容</p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
