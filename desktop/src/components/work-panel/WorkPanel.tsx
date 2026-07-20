import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Bot,
  CheckSquare,
  ChevronDown,
  FileCode2,
  FileText,
  FolderOpen,
  Globe,
  ListTodo,
  Maximize2,
  Minimize2,
  PanelRight,
  Plus,
  RefreshCw,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { useAppStore, type SubAgent } from "../../store";
import { WorkspacePanel } from "../WorkspacePanel";
import {
  loadAbsoluteFilePreview,
  type WorkspacePreview,
  type WorkspacePreviewLineRange,
  type WorkspacePreviewOpenRequest,
  type WorkspacePreviewQuotePayload,
} from "../workspace/workspace-preview-types";
import { WorkspaceFilePreview } from "../workspace/WorkspaceFilePreview";
import { TerminalEmbed } from "../TerminalEmbed";
import { SubAgentCard } from "../SubAgentCard";
import { HoverTip } from "../ds/HoverTip";
import { loadPreparedHtmlSrcDoc } from "../../utils/html-preview-assets";
import {
  artifactBaseName,
  collectSessionArtifactPaths,
  isInAppArtifactPreviewPath,
  isInAppHtmlPreviewPath,
  looksLikeDirectoryPath,
  pathToFileUrl,
} from "../../utils/session-artifacts";
import { HtmlPreviewChrome } from "../workspace/HtmlPreviewChrome";
import { HtmlPreviewShell } from "../workspace/HtmlPreviewShell";
import {
  DEFAULT_HTML_PREVIEW_VIEWPORT,
  type HtmlPreviewViewport,
} from "../workspace/html-preview-device";
import { SessionArtifactList } from "./SessionArtifactList";
import { SessionReferenceList } from "./SessionReferenceList";
import { collectSessionReferences } from "../../utils/session-references";

/** Remote https tab: open-in-browser + device toolbar; inspect unavailable (cross-origin). */
function RemoteBrowserPane({
  title,
  url,
  reloadKey = 0,
}: {
  title: string;
  url: string;
  reloadKey?: number;
}) {
  const [deviceToolbarVisible, setDeviceToolbarVisible] = useState(false);
  const [viewport, setViewport] = useState<HtmlPreviewViewport>(DEFAULT_HTML_PREVIEW_VIEWPORT);
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const fixed =
    viewport.width != null && viewport.height != null && viewport.width > 0 && viewport.height > 0;
  const zoom = Math.max(25, Math.min(300, viewport.zoomPercent || 100)) / 100;
  const frameKey = reloadKey;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HtmlPreviewChrome
        documentUrl={url}
        inspectEnabled={inspectEnabled}
        onInspectEnabledChange={setInspectEnabled}
        inspectAvailable={false}
        deviceToolbarVisible={deviceToolbarVisible}
        onDeviceToolbarVisibleChange={setDeviceToolbarVisible}
        viewport={viewport}
        onViewportChange={setViewport}
        onOpenInBrowser={() => {
          void window.agenticxDesktop?.openExternal?.(url);
        }}
      />
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-[color-mix(in_oklab,var(--surface-hover)_80%,transparent)] p-3">
        <div
          className={
            fixed
              ? "relative shrink-0 overflow-hidden rounded-md border border-border bg-white shadow-sm"
              : "min-h-0 w-full flex-1 overflow-hidden rounded-md border border-border bg-white"
          }
          style={
            fixed
              ? {
                  width: Math.ceil((viewport.width ?? 0) * zoom),
                  height: Math.ceil((viewport.height ?? 0) * zoom),
                }
              : undefined
          }
        >
          <iframe
            key={`remote-browser-${frameKey}`}
            title={title}
            src={url}
            className="border-0 bg-white"
            style={
              fixed
                ? {
                    width: viewport.width!,
                    height: viewport.height!,
                    transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                    transformOrigin: "top left",
                  }
                : { width: "100%", height: "100%", minHeight: 220 }
            }
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </div>
    </div>
  );
}

export type WorkPanelTabKind = "summary" | "workspace" | "terminal" | "browser" | "preview";

export type SummarySectionId = "todo" | "artifacts" | "spawns" | "refs";

export type WorkPanelFocus =
  | { kind: "summary"; section?: SummarySectionId; highlightPath?: string }
  | { kind: "workspace" }
  | { kind: "terminal"; tabId?: string }
  | {
      kind: "browser";
      tabId?: string;
      /** Display URL in the address bar (https://… or file:///…). */
      url?: string;
      title?: string;
      /** Local HTML body rendered via srcDoc (Trae-style in-app preview). */
      srcDoc?: string;
    }
  /** Trae-style file preview tab (fills WorkPanel; never opens 工作区 file tree). */
  | {
      kind: "preview";
      absolutePath: string;
      title?: string;
      lineRange?: WorkspacePreviewLineRange;
    }
  | null;

type BrowserHistoryEntry = {
  url: string;
  title: string;
  srcDoc?: string | null;
};

type BrowserTab = {
  id: string;
  title: string;
  url: string;
  draftUrl: string;
  /** When set, iframe uses srcDoc instead of remote src (local HTML reports). */
  srcDoc?: string | null;
  /** Bump to force iframe remount after refresh. */
  reloadNonce?: number;
  /** Trae-style back/forward stack for this tab. */
  history: BrowserHistoryEntry[];
  historyIndex: number;
};

function browserEntry(
  url: string,
  title: string,
  srcDoc?: string | null,
): BrowserHistoryEntry {
  return { url, title, srcDoc: srcDoc ?? null };
}

function createBrowserTab(init: {
  id: string;
  title: string;
  url: string;
  draftUrl?: string;
  srcDoc?: string | null;
}): BrowserTab {
  const entry = browserEntry(init.url, init.title, init.srcDoc);
  return {
    id: init.id,
    title: init.title,
    url: init.url,
    draftUrl: init.draftUrl ?? (init.url === "about:blank" ? "" : init.url),
    srcDoc: init.srcDoc ?? null,
    history: [entry],
    historyIndex: 0,
  };
}

/** Push a navigation entry (truncates forward stack). Same URL updates in place. */
function pushBrowserHistory(tab: BrowserTab, entry: BrowserHistoryEntry): BrowserTab {
  const idx = Math.max(0, Math.min(tab.historyIndex, tab.history.length - 1));
  const cur = tab.history[idx];
  if (cur && cur.url === entry.url) {
    const history = tab.history.map((e, i) => (i === idx ? entry : e));
    return {
      ...tab,
      url: entry.url,
      draftUrl: entry.url === "about:blank" ? tab.draftUrl : entry.url,
      title: entry.title,
      srcDoc: entry.srcDoc,
      history,
      historyIndex: idx,
    };
  }
  const history = [...tab.history.slice(0, idx + 1), entry];
  return {
    ...tab,
    url: entry.url,
    draftUrl: entry.url === "about:blank" ? "" : entry.url,
    title: entry.title,
    srcDoc: entry.srcDoc,
    history,
    historyIndex: history.length - 1,
  };
}

function goBrowserHistory(tab: BrowserTab, delta: -1 | 1): BrowserTab | null {
  const next = tab.historyIndex + delta;
  if (next < 0 || next >= tab.history.length) return null;
  const entry = tab.history[next];
  if (!entry) return null;
  return {
    ...tab,
    historyIndex: next,
    url: entry.url,
    draftUrl: entry.url === "about:blank" ? "" : entry.url,
    title: entry.title,
    srcDoc: entry.srcDoc,
    reloadNonce: (tab.reloadNonce ?? 0) + 1,
  };
}

type PreviewTab = {
  id: string;
  title: string;
  absolutePath: string;
  preview: WorkspacePreview | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  lineRange?: WorkspacePreviewLineRange;
};

type Props = {
  paneId: string;
  sessionId: string;
  activeTaskspaceId: string | null;
  onActiveTaskspaceChange: (taskspaceId: string | null) => void;
  autoRefreshKey?: number;
  tintColor?: string;
  onClose: () => void;
  /** Trae-style: enlarge work panel to dominate the pane (main content). */
  expanded?: boolean;
  onToggleExpand?: () => void;
  focusRequest?: WorkPanelFocus;
  onFocusRequestHandled?: () => void;
  onPickFileForReference?: (taskspaceId: string, path: string) => void;
  onPickDirectoryForReference?: (payload: {
    taskspaceId: string;
    relPath: string;
    label: string;
  }) => void;
  onQuotePreviewSnippet?: (payload: WorkspacePreviewQuotePayload) => void;
  previewOpenRequest?: WorkspacePreviewOpenRequest | null;
  onPreviewOpenRequestHandled?: () => void;
  onEnsureSessionForWorkspace?: () => Promise<string | null>;
  subAgents: SubAgent[];
  selectedSubAgent: string | null;
  onCancelSubAgent: (agentId: string) => void;
  onRetrySubAgent: (agentId: string) => void;
  onChatSubAgent: (agentId: string) => void;
  onModelChangeSubAgent?: (agentId: string, provider: string, model: string) => void;
  onConfirmResolveSubAgent?: (agentId: string, approved: boolean) => void;
  onOpenDelivery: () => void;
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeBrowseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "about:blank";
  if (/^https?:\/\//i.test(trimmed) || /^about:/i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // Absolute local path typed into the address bar → file:// URL.
  if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("~/")) {
    return pathToFileUrl(trimmed);
  }
  return `https://${trimmed}`;
}

function fileUrlToLocalPath(fileUrl: string): string | null {
  const raw = String(fileUrl || "").trim();
  if (!/^file:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    let pathname = decodeURIComponent(parsed.pathname || "");
    // Windows file:///C:/… → pathname "/C:/…" — drop the leading slash before drive.
    if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname || null;
  } catch {
    return null;
  }
}

function Section({
  id,
  title,
  count,
  open,
  onToggle,
  children,
  footer,
  /** When open + has content, body fills remaining height and scrolls inside (Trae fixed zones). */
  scrollBody = false,
  hasContent = false,
}: {
  id: SummarySectionId;
  title: string;
  count?: number;
  open: boolean;
  onToggle: (id: SummarySectionId) => void;
  children: ReactNode;
  footer?: ReactNode;
  scrollBody?: boolean;
  hasContent?: boolean;
}) {
  const grow = Boolean(open && scrollBody && hasContent);
  return (
    <section
      className={`flex min-h-0 flex-col border-b border-border ${grow ? "flex-1" : "shrink-0"}`}
    >
      <button
        type="button"
        className="flex w-full shrink-0 items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-strong hover:bg-surface-hover/60"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform ${open ? "" : "-rotate-90"}`}
          strokeWidth={2}
        />
        <span>{title}</span>
        {typeof count === "number" ? (
          <span className="text-[11px] font-normal text-text-faint">{count}</span>
        ) : null}
      </button>
      {open ? (
        <div
          className={`min-h-0 px-3 pb-3 ${grow ? "flex-1 overflow-y-auto overscroll-contain" : ""}`}
        >
          {children}
        </div>
      ) : null}
      {open && footer ? <div className="shrink-0 px-3 pb-3">{footer}</div> : null}
    </section>
  );
}

function EmptyBlock({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-2 py-5 text-center">
      <div className="text-text-faint opacity-70">{icon}</div>
      <div className="text-[13px] text-text-subtle">{title}</div>
      <div className="max-w-[240px] text-[11px] leading-relaxed text-text-faint">{subtitle}</div>
    </div>
  );
}

export function WorkPanel({
  paneId,
  sessionId,
  activeTaskspaceId,
  onActiveTaskspaceChange,
  autoRefreshKey,
  tintColor,
  onClose,
  expanded = false,
  onToggleExpand,
  focusRequest,
  onFocusRequestHandled,
  onPickFileForReference,
  onPickDirectoryForReference,
  onQuotePreviewSnippet,
  previewOpenRequest,
  onPreviewOpenRequestHandled,
  onEnsureSessionForWorkspace,
  subAgents,
  selectedSubAgent,
  onCancelSubAgent,
  onRetrySubAgent,
  onChatSubAgent,
  onModelChangeSubAgent,
  onConfirmResolveSubAgent,
  onOpenDelivery,
}: Props) {
  const addPaneTerminalTab = useAppStore((s) => s.addPaneTerminalTab);
  const removePaneTerminalTab = useAppStore((s) => s.removePaneTerminalTab);
  const setActivePaneTerminalTab = useAppStore((s) => s.setActivePaneTerminalTab);
  const terminalTabs = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.terminalTabs ?? []);
  const activeTerminalTabId = useAppStore(
    (s) => s.panes.find((p) => p.id === paneId)?.activeTerminalTabId ?? null
  );
  const paneMessages = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.messages ?? []);

  const [summaryTabOpen, setSummaryTabOpen] = useState(true);
  const [activeKind, setActiveKind] = useState<WorkPanelTabKind | null>("summary");
  const [activeBrowserId, setActiveBrowserId] = useState<string | null>(null);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [workspaceTabOpen, setWorkspaceTabOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusPos, setPlusPos] = useState<{ left: number; top: number } | null>(null);
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  // Empty zones stay collapsed by default; content arrival auto-expands (Trae-style).
  const [openSections, setOpenSections] = useState<Record<SummarySectionId, boolean>>({
    todo: false,
    artifacts: false,
    spawns: false,
    refs: false,
  });
  const [extraArtifactPaths, setExtraArtifactPaths] = useState<string[]>([]);
  const [artifactHighlightPath, setArtifactHighlightPath] = useState<string | null>(null);

  const artifactPaths = useMemo(
    () => collectSessionArtifactPaths(paneMessages, subAgents, extraArtifactPaths, sessionId),
    [paneMessages, subAgents, extraArtifactPaths, sessionId],
  );

  const referenceBundle = useMemo(
    () => collectSessionReferences(paneMessages),
    [paneMessages],
  );

  const activeBrowser = useMemo(
    () => browserTabs.find((t) => t.id === activeBrowserId) ?? null,
    [browserTabs, activeBrowserId]
  );

  const activePreview = useMemo(
    () => previewTabs.find((t) => t.id === activePreviewId) ?? null,
    [previewTabs, activePreviewId],
  );

  const hasAnyTab =
    summaryTabOpen ||
    workspaceTabOpen ||
    terminalTabs.length > 0 ||
    browserTabs.length > 0 ||
    previewTabs.length > 0;

  const resolveFallbackKind = (opts?: {
    excludeSummary?: boolean;
    excludeWorkspace?: boolean;
    excludeTerminalId?: string;
    excludeBrowserId?: string;
    excludePreviewId?: string;
  }): WorkPanelTabKind | null => {
    if (!opts?.excludeSummary && summaryTabOpen) return "summary";
    const nextPreview = previewTabs.find((t) => t.id !== opts?.excludePreviewId);
    if (nextPreview) {
      setActivePreviewId(nextPreview.id);
      return "preview";
    }
    if (!opts?.excludeWorkspace && workspaceTabOpen) return "workspace";
    const nextTerminal = terminalTabs.find((t) => t.id !== opts?.excludeTerminalId);
    if (nextTerminal) return "terminal";
    const nextBrowser = browserTabs.find((t) => t.id !== opts?.excludeBrowserId);
    if (nextBrowser) {
      setActiveBrowserId(nextBrowser.id);
      return "browser";
    }
    return null;
  };

  const openLocalFilePreview = (
    absPathRaw: string,
    titleHint?: string,
    lineRange?: WorkspacePreviewLineRange,
  ) => {
    const path = String(absPathRaw || "").trim();
    if (!path) return;
    const title = String(titleHint || "").trim() || artifactBaseName(path) || "预览";
    const existing = previewTabs.find((t) => t.absolutePath === path);
    if (existing) {
      if (lineRange) {
        setPreviewTabs((prev) =>
          prev.map((t) => (t.id === existing.id ? { ...t, lineRange } : t)),
        );
      }
      setActivePreviewId(existing.id);
      setActiveKind("preview");
      return;
    }
    const nextId = uid();
    setPreviewTabs((prev) => [
      ...prev,
      {
        id: nextId,
        title,
        absolutePath: path,
        preview: null,
        loading: true,
        error: null,
        copied: false,
        ...(lineRange ? { lineRange } : {}),
      },
    ]);
    setActivePreviewId(nextId);
    setActiveKind("preview");
    void (async () => {
      const loaded = await loadAbsoluteFilePreview(path);
      setPreviewTabs((prev) =>
        prev.map((t) =>
          t.id !== nextId
            ? t
            : loaded.ok
              ? {
                  ...t,
                  loading: false,
                  preview: loaded.preview,
                  error: null,
                  title: artifactBaseName(path) || t.title,
                }
              : { ...t, loading: false, preview: null, error: loaded.error },
        ),
      );
    })();
  };

  const closePreviewTab = (tabId: string) => {
    const next = previewTabs.filter((t) => t.id !== tabId);
    setPreviewTabs(next);
    if (activePreviewId === tabId) {
      setActivePreviewId(next[next.length - 1]?.id ?? null);
      if (activeKind === "preview") {
        setActiveKind(resolveFallbackKind({ excludePreviewId: tabId }));
      }
    }
  };

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === "summary") {
      setSummaryTabOpen(true);
      setActiveKind("summary");
      if (focusRequest.section) {
        setOpenSections((prev) => ({ ...prev, [focusRequest.section!]: true }));
      }
      const highlight = String(focusRequest.highlightPath || "").trim();
      if (highlight) {
        const base = highlight.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || "";
        const looksFile = /\.[a-zA-Z0-9]{1,12}$/.test(base);
        if (looksFile) {
          setExtraArtifactPaths((prev) => (prev.includes(highlight) ? prev : [...prev, highlight]));
        }
        setArtifactHighlightPath(highlight);
      }
    } else if (focusRequest.kind === "workspace") {
      setWorkspaceTabOpen(true);
      setActiveKind("workspace");
    } else if (focusRequest.kind === "terminal") {
      setActiveKind("terminal");
      if (focusRequest.tabId) setActivePaneTerminalTab(paneId, focusRequest.tabId);
    } else if (focusRequest.kind === "browser") {
      const focusUrl = String(focusRequest.url || "").trim();
      const focusSrcDoc = focusRequest.srcDoc;
      if (focusUrl && focusSrcDoc != null) {
        const title =
          String(focusRequest.title || "").trim() ||
          artifactBaseName(fileUrlToLocalPath(focusUrl) || focusUrl) ||
          "浏览器";
        const nextId = uid();
        const entry = browserEntry(focusUrl, title, focusSrcDoc);
        setBrowserTabs((prev) => {
          const existing = prev.find((t) => t.url === focusUrl);
          if (existing) {
            // Activate existing tab after commit.
            queueMicrotask(() => setActiveBrowserId(existing.id));
            return prev.map((t) =>
              t.id === existing.id ? pushBrowserHistory(t, entry) : t,
            );
          }
          queueMicrotask(() => setActiveBrowserId(nextId));
          return [
            ...prev,
            createBrowserTab({ id: nextId, title, url: focusUrl, srcDoc: focusSrcDoc }),
          ];
        });
      } else if (focusRequest.tabId) {
        setActiveBrowserId(focusRequest.tabId);
      }
      setActiveKind("browser");
    } else if (focusRequest.kind === "preview") {
      openLocalFilePreview(focusRequest.absolutePath, focusRequest.title, focusRequest.lineRange);
    }
    onFocusRequestHandled?.();
  }, [focusRequest, onFocusRequestHandled, paneId, setActivePaneTerminalTab]);

  useEffect(() => {
    if (subAgents.length > 0) {
      setOpenSections((prev) => (prev.spawns ? prev : { ...prev, spawns: true }));
    } else {
      setOpenSections((prev) => (!prev.spawns ? prev : { ...prev, spawns: false }));
    }
  }, [subAgents.length]);

  useEffect(() => {
    if (artifactPaths.length > 0) {
      setOpenSections((prev) => (prev.artifacts ? prev : { ...prev, artifacts: true }));
    } else {
      setOpenSections((prev) => (!prev.artifacts ? prev : { ...prev, artifacts: false }));
    }
  }, [artifactPaths.length]);

  useEffect(() => {
    if (!referenceBundle.isEmpty) {
      setOpenSections((prev) => (prev.refs ? prev : { ...prev, refs: true }));
    } else {
      setOpenSections((prev) => (!prev.refs ? prev : { ...prev, refs: false }));
    }
  }, [referenceBundle.isEmpty]);

  useEffect(() => {
    setExtraArtifactPaths([]);
    setArtifactHighlightPath(null);
  }, [sessionId]);

  const toggleSection = (id: SummarySectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const closePlus = () => {
    setPlusOpen(false);
    setPlusPos(null);
  };

  const openPlusMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = plusBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setPlusPos({ left: Math.max(8, rect.left), top: rect.bottom + 4 });
    }
    setPlusOpen((v) => !v);
  };

  const openSummaryTab = () => {
    setSummaryTabOpen(true);
    setActiveKind("summary");
    closePlus();
  };

  const closeSummaryTab = () => {
    setSummaryTabOpen(false);
    if (activeKind === "summary") {
      setActiveKind(resolveFallbackKind({ excludeSummary: true }));
    }
  };

  const openWorkspaceTab = () => {
    setWorkspaceTabOpen(true);
    setActiveKind("workspace");
    closePlus();
  };

  const openTerminalTab = () => {
    closePlus();
    void (async () => {
      let cwd = (terminalTabs[0]?.cwd ?? "").trim();
      if (!cwd && sessionId && window.agenticxDesktop?.listTaskspaces) {
        try {
          const result = await window.agenticxDesktop.listTaskspaces(sessionId);
          const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
          const preferred =
            workspaces.find((w) => String(w.id ?? "") === String(activeTaskspaceId ?? "")) ??
            workspaces[0];
          cwd = String(preferred?.path ?? "").trim();
        } catch {
          cwd = "";
        }
      }
      if (!cwd) {
        // No workspace yet — still open a tab; shell will land on default home.
        cwd = "~";
      }
      addPaneTerminalTab(paneId, cwd, "zsh");
      setActiveKind("terminal");
    })();
  };

  const openBrowserTab = () => {
    const id = uid();
    const tab = createBrowserTab({
      id,
      title: "新标签页",
      url: "about:blank",
      draftUrl: "",
    });
    setBrowserTabs((prev) => [...prev, tab]);
    setActiveBrowserId(id);
    setActiveKind("browser");
    closePlus();
  };

  /** Open a remote http(s) reference inside the WorkPanel browser tab (Trae-style). */
  const openWebReferenceInBrowser = (url: string, title: string) => {
    const nextUrl = normalizeBrowseUrl(url);
    if (!/^https?:\/\//i.test(nextUrl)) return;
    const nextTitle = String(title || "").trim() || nextUrl;
    const nextId = uid();
    const entry = browserEntry(nextUrl, nextTitle, null);
    setBrowserTabs((prev) => {
      const existing = prev.find((t) => t.url === nextUrl && t.srcDoc == null);
      if (existing) {
        queueMicrotask(() => setActiveBrowserId(existing.id));
        return prev.map((t) =>
          t.id === existing.id ? pushBrowserHistory(t, entry) : t,
        );
      }
      queueMicrotask(() => setActiveBrowserId(nextId));
      return [
        ...prev,
        createBrowserTab({ id: nextId, title: nextTitle, url: nextUrl, srcDoc: null }),
      ];
    });
    setActiveKind("browser");
  };

  const closeBrowserTab = (tabId: string) => {
    const next = browserTabs.filter((t) => t.id !== tabId);
    setBrowserTabs(next);
    if (activeBrowserId === tabId) {
      setActiveBrowserId(next[next.length - 1]?.id ?? null);
      if (activeKind === "browser") {
        setActiveKind(resolveFallbackKind({ excludeBrowserId: tabId }));
      }
    }
  };

  const openLocalHtmlPreview = (absPath: string) => {
    const path = String(absPath || "").trim();
    if (!path || !isInAppHtmlPreviewPath(path)) return;
    void (async () => {
      const prepared = await loadPreparedHtmlSrcDoc(path);
      if (!prepared.ok) {
        console.warn("[WorkPanel] read HTML failed:", prepared.error);
        return;
      }
      const fileUrl = pathToFileUrl(path);
      const title = artifactBaseName(path) || "HTML";
      const nextId = uid();
      const entry = browserEntry(fileUrl, title, prepared.srcDoc);
      setBrowserTabs((prev) => {
        const existing = prev.find((t) => t.url === fileUrl);
        if (existing) {
          queueMicrotask(() => setActiveBrowserId(existing.id));
          return prev.map((t) =>
            t.id === existing.id ? pushBrowserHistory(t, entry) : t,
          );
        }
        queueMicrotask(() => setActiveBrowserId(nextId));
        return [
          ...prev,
          createBrowserTab({ id: nextId, title, url: fileUrl, srcDoc: prepared.srcDoc }),
        ];
      });
      setActiveKind("browser");
    })();
  };

  const navigateBrowser = (tabId: string) => {
    const tab = browserTabs.find((t) => t.id === tabId);
    if (!tab) return;
    const nextUrl = normalizeBrowseUrl(tab.draftUrl || tab.url);
    const localPath = fileUrlToLocalPath(nextUrl);
    if (localPath && isInAppHtmlPreviewPath(localPath)) {
      void (async () => {
        const prepared = await loadPreparedHtmlSrcDoc(localPath);
        if (!prepared.ok) {
          console.warn("[WorkPanel] read HTML failed:", prepared.error);
          return;
        }
        const title = artifactBaseName(localPath) || "HTML";
        const entry = browserEntry(nextUrl, title, prepared.srcDoc);
        setBrowserTabs((prev) =>
          prev.map((t) => (t.id === tabId ? pushBrowserHistory(t, entry) : t)),
        );
      })();
      return;
    }

    setBrowserTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        let title = t.title;
        try {
          title =
            nextUrl === "about:blank"
              ? "新标签页"
              : new URL(nextUrl).hostname || new URL(nextUrl).pathname.split("/").pop() || "浏览器";
        } catch {
          title = "浏览器";
        }
        return pushBrowserHistory(t, browserEntry(nextUrl, title, null));
      }),
    );
  };

  const goBrowserBack = (tabId: string) => {
    setBrowserTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return goBrowserHistory(t, -1) ?? t;
      }),
    );
  };

  const goBrowserForward = (tabId: string) => {
    setBrowserTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return goBrowserHistory(t, 1) ?? t;
      }),
    );
  };

  /** Trae-style refresh: re-read local HTML / remount remote iframe. */
  const refreshBrowser = (tabId: string) => {
    const tab = browserTabs.find((t) => t.id === tabId);
    if (!tab) return;
    const bump = (t: BrowserTab): BrowserTab => ({
      ...t,
      reloadNonce: (t.reloadNonce ?? 0) + 1,
    });
    const localPath = fileUrlToLocalPath(tab.url);
    if (localPath && isInAppHtmlPreviewPath(localPath)) {
      void (async () => {
        const prepared = await loadPreparedHtmlSrcDoc(localPath);
        if (!prepared.ok) {
          console.warn("[WorkPanel] refresh HTML failed:", prepared.error);
          setBrowserTabs((prev) => prev.map((t) => (t.id === tabId ? bump(t) : t)));
          return;
        }
        const title = artifactBaseName(localPath) || "HTML";
        const entry = browserEntry(tab.url, title, prepared.srcDoc);
        setBrowserTabs((prev) =>
          prev.map((t) => (t.id === tabId ? bump(pushBrowserHistory(t, entry)) : t)),
        );
      })();
      return;
    }
    setBrowserTabs((prev) => prev.map((t) => (t.id === tabId ? bump(t) : t)));
  };

  useEffect(() => {
    if (!plusOpen) return;
    const onDoc = () => closePlus();
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [plusOpen]);

  const plusMenu =
    plusOpen && plusPos
      ? createPortal(
          <div
            className="fixed z-[120] min-w-[148px] overflow-hidden rounded-xl border border-border bg-surface-card py-1.5 shadow-lg"
            style={{ left: plusPos.left, top: plusPos.top }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-strong hover:bg-surface-hover"
              onClick={openSummaryTab}
            >
              <ListTodo className="h-4 w-4 text-text-subtle" strokeWidth={1.7} />
              任务摘要
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-strong hover:bg-surface-hover"
              onClick={openBrowserTab}
            >
              <Globe className="h-4 w-4 text-text-subtle" strokeWidth={1.7} />
              浏览器
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-strong hover:bg-surface-hover"
              onClick={openTerminalTab}
            >
              <TerminalIcon className="h-4 w-4 text-text-subtle" strokeWidth={1.7} />
              终端
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-strong hover:bg-surface-hover"
              onClick={openWorkspaceTab}
            >
              <FolderOpen className="h-4 w-4 text-text-subtle" strokeWidth={1.7} />
              工作区
            </button>
          </div>,
          document.body
        )
      : null;

  const startEntries = [
    {
      key: "summary",
      icon: <ListTodo className="h-5 w-5 shrink-0 text-text-subtle" strokeWidth={1.6} />,
      title: "任务摘要",
      subtitle: "查看任务执行进展、产物汇总及关联信息",
      onClick: openSummaryTab,
    },
    {
      key: "browser",
      icon: <Globe className="h-5 w-5 shrink-0 text-text-subtle" strokeWidth={1.6} />,
      title: "浏览器",
      subtitle: "浏览及调试网页",
      onClick: openBrowserTab,
    },
    {
      key: "terminal",
      icon: <TerminalIcon className="h-5 w-5 shrink-0 text-text-subtle" strokeWidth={1.6} />,
      title: "终端",
      subtitle: "运行命令及脚本",
      onClick: openTerminalTab,
    },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-1.5">
        {summaryTabOpen ? (
          <button
            type="button"
            className={`flex h-7 max-w-[132px] items-center gap-1.5 rounded-full px-1.5 pr-2.5 text-[12px] ${
              activeKind === "summary"
                ? "bg-surface-card-strong text-text-strong"
                : "bg-surface-hover/70 text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => setActiveKind("summary")}
          >
            <span
              role="button"
              tabIndex={0}
              className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-text-faint/40 text-white transition hover:bg-text-faint/60"
              onClick={(e) => {
                e.stopPropagation();
                closeSummaryTab();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSummaryTab();
                }
              }}
              aria-label="关闭任务摘要"
              title="关闭任务摘要"
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.4} />
            </span>
            <span className="truncate">任务摘要</span>
          </button>
        ) : null}

        {workspaceTabOpen ? (
          <button
            type="button"
            className={`flex h-7 max-w-[110px] items-center gap-1.5 rounded-full px-2 text-[12px] ${
              activeKind === "workspace"
                ? "bg-surface-card-strong text-text-strong"
                : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => setActiveKind("workspace")}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">工作区</span>
            <span
              role="button"
              tabIndex={0}
              className="rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-strong"
              onClick={(e) => {
                e.stopPropagation();
                setWorkspaceTabOpen(false);
                if (activeKind === "workspace") {
                  setActiveKind(resolveFallbackKind({ excludeWorkspace: true }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setWorkspaceTabOpen(false);
                  if (activeKind === "workspace") {
                    setActiveKind(resolveFallbackKind({ excludeWorkspace: true }));
                  }
                }
              }}
              aria-label="关闭工作区标签"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </span>
          </button>
        ) : null}

        {terminalTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex h-7 max-w-[110px] items-center gap-1.5 rounded-full px-2 text-[12px] ${
              activeKind === "terminal" && activeTerminalTabId === tab.id
                ? "bg-surface-card-strong text-text-strong"
                : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => {
              setActivePaneTerminalTab(paneId, tab.id);
              setActiveKind("terminal");
            }}
          >
            <TerminalIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{tab.label || "zsh"}</span>
            <span
              role="button"
              tabIndex={0}
              className="rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-strong"
              onClick={(e) => {
                e.stopPropagation();
                removePaneTerminalTab(paneId, tab.id);
                if (activeKind === "terminal" && activeTerminalTabId === tab.id) {
                  setActiveKind(resolveFallbackKind({ excludeTerminalId: tab.id }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  removePaneTerminalTab(paneId, tab.id);
                  if (activeKind === "terminal" && activeTerminalTabId === tab.id) {
                    setActiveKind(resolveFallbackKind({ excludeTerminalId: tab.id }));
                  }
                }
              }}
              aria-label="关闭终端标签"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </span>
          </button>
        ))}

        {browserTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex h-7 max-w-[120px] items-center gap-1.5 rounded-full px-2 text-[12px] ${
              activeKind === "browser" && activeBrowserId === tab.id
                ? "bg-surface-card-strong text-text-strong"
                : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => {
              setActiveBrowserId(tab.id);
              setActiveKind("browser");
            }}
          >
            <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              className="rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-strong"
              onClick={(e) => {
                e.stopPropagation();
                closeBrowserTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeBrowserTab(tab.id);
                }
              }}
              aria-label="关闭浏览器标签"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </span>
          </button>
        ))}

        {previewTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex h-7 max-w-[140px] items-center gap-1.5 rounded-full px-2 text-[12px] ${
              activeKind === "preview" && activePreviewId === tab.id
                ? "bg-surface-card-strong text-text-strong"
                : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => {
              setActivePreviewId(tab.id);
              setActiveKind("preview");
            }}
            title={tab.absolutePath}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              className="rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-strong"
              onClick={(e) => {
                e.stopPropagation();
                closePreviewTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  closePreviewTab(tab.id);
                }
              }}
              aria-label="关闭预览标签"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </span>
          </button>
        ))}

        <button
          ref={plusBtnRef}
          type="button"
          className="agx-topbar-btn !px-[5px]"
          title="打开任务摘要 / 浏览器 / 终端 / 工作区"
          aria-label="新建工作台标签"
          onClick={openPlusMenu}
        >
          <Plus className="h-[16px] w-[16px]" strokeWidth={1.8} />
        </button>

        <div className="flex-1" />

        {onToggleExpand ? (
          <HoverTip label={expanded ? "恢复面板宽度" : "展开面板"}>
            <button
              type="button"
              className={`agx-topbar-btn !px-[5px] ${expanded ? "agx-topbar-btn--active" : ""}`}
              onClick={onToggleExpand}
              title={expanded ? "恢复面板宽度" : "展开面板"}
              aria-label={expanded ? "恢复面板宽度" : "展开面板"}
              aria-pressed={expanded}
            >
              {expanded ? (
                <Minimize2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
              ) : (
                <Maximize2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
              )}
            </button>
          </HoverTip>
        ) : null}

        <HoverTip label="隐藏工具面板">
          <button
            type="button"
            className="agx-topbar-btn !px-[5px]"
            onClick={onClose}
            title="隐藏工具面板"
            aria-label="隐藏工具面板"
          >
            <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </HoverTip>
      </div>

      {plusMenu}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!hasAnyTab ? (
          <div className="flex h-full flex-col px-8 pt-16">
            <div className="text-[15px] text-text-faint">从这里开始</div>
            <div className="mt-6 flex max-w-[360px] flex-col gap-5">
              {startEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="flex items-start gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-surface-hover/50"
                  onClick={entry.onClick}
                >
                  <div className="mt-0.5">{entry.icon}</div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-text-strong">{entry.title}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-text-faint">
                      {entry.subtitle}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {hasAnyTab && activeKind === "summary" && summaryTabOpen ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <Section
              id="todo"
              title="待办"
              open={openSections.todo}
              onToggle={toggleSection}
              scrollBody
              hasContent={false}
            >
              <EmptyBlock
                icon={<CheckSquare className="h-9 w-9" strokeWidth={1.3} />}
                title="暂无待办"
                subtitle="复杂任务的进展会显示在这里"
              />
            </Section>

            <Section
              id="artifacts"
              title="任务产物"
              count={artifactPaths.length}
              open={openSections.artifacts}
              onToggle={toggleSection}
              scrollBody
              hasContent={artifactPaths.length > 0}
              footer={
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-2 text-[12px] text-text-subtle transition hover:border-[var(--ui-btn-primary-border,#3b82f6)] hover:bg-[color-mix(in_srgb,var(--ui-btn-primary-bg,#3b82f6)_12%,transparent)] hover:text-[var(--ui-btn-primary-bg,#3b82f6)]"
                  onClick={onOpenDelivery}
                >
                  <Boxes className="h-3.5 w-3.5" strokeWidth={1.7} />
                  新建交付任务（POC / MVP）
                </button>
              }
            >
              {artifactPaths.length === 0 ? (
                <EmptyBlock
                  icon={<Boxes className="h-9 w-9" strokeWidth={1.3} />}
                  title="暂无产物"
                  subtitle="任务完成后，生成的文件将展示在这里"
                />
              ) : (
                <SessionArtifactList
                  paths={artifactPaths}
                  highlightPath={artifactHighlightPath}
                  onHighlightHandled={() => setArtifactHighlightPath(null)}
                  onOpenPath={(path) => {
                    if (isInAppHtmlPreviewPath(path)) {
                      openLocalHtmlPreview(path);
                      return;
                    }
                    if (looksLikeDirectoryPath(path)) {
                      void window.agenticxDesktop?.shellOpenPath?.(path);
                      return;
                    }
                    if (isInAppArtifactPreviewPath(path)) {
                      // Trae-style: open preview tab in this WorkPanel — never 工作区 / left popup.
                      openLocalFilePreview(path);
                      return;
                    }
                    void window.agenticxDesktop?.shellOpenPath?.(path);
                  }}
                />
              )}
            </Section>

            <Section
              id="refs"
              title="参考信息"
              count={
                referenceBundle.isEmpty
                  ? undefined
                  : referenceBundle.skillCount + referenceBundle.docCount
              }
              open={openSections.refs}
              onToggle={toggleSection}
              scrollBody
              hasContent={!referenceBundle.isEmpty}
            >
              {referenceBundle.isEmpty ? (
                <EmptyBlock
                  icon={<FileCode2 className="h-9 w-9" strokeWidth={1.3} />}
                  title="暂无参考"
                  subtitle="任务执行中调用的技能与参考网页会显示在这里"
                />
              ) : (
                <SessionReferenceList
                  bundle={referenceBundle}
                  onOpenWebUrl={openWebReferenceInBrowser}
                />
              )}
            </Section>

            <Section
              id="spawns"
              title="子智能体"
              count={subAgents.length}
              open={openSections.spawns}
              onToggle={toggleSection}
              scrollBody
              hasContent={subAgents.length > 0}
            >
              {subAgents.length === 0 ? (
                <EmptyBlock
                  icon={<Bot className="h-9 w-9" strokeWidth={1.3} />}
                  title="暂无子智能体"
                  subtitle="派生子智能体后会显示在这里"
                />
              ) : (
                <div className="space-y-2">
                  {subAgents.map((subAgent) => (
                    <SubAgentCard
                      key={subAgent.id}
                      subAgent={subAgent}
                      parentSessionId={sessionId || undefined}
                      selected={selectedSubAgent === subAgent.id}
                      onCancel={onCancelSubAgent}
                      onRetry={onRetrySubAgent}
                      onChat={onChatSubAgent}
                      onModelChange={onModelChangeSubAgent}
                      onConfirmResolve={onConfirmResolveSubAgent}
                    />
                  ))}
                </div>
              )}
            </Section>
          </div>
        ) : null}

        {hasAnyTab && activeKind === "preview" ? (
          <div className="flex h-full min-h-0 flex-col">
            {!activePreview ? (
              <EmptyBlock
                icon={<FileText className="h-9 w-9" strokeWidth={1.3} />}
                title="暂无预览"
                subtitle="从任务产物打开文件以预览"
              />
            ) : activePreview.loading ? (
              <div className="flex h-full items-center justify-center text-[13px] text-text-muted">
                正在加载预览…
              </div>
            ) : activePreview.error || !activePreview.preview ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-[13px] text-rose-300">{activePreview.error || "预览失败"}</p>
                <p className="max-w-sm truncate font-mono text-[11px] text-text-faint" title={activePreview.absolutePath}>
                  {activePreview.absolutePath}
                </p>
              </div>
            ) : (
              <WorkspaceFilePreview
                layout="panel"
                preview={activePreview.preview}
                copied={activePreview.copied}
                initialLineRange={activePreview.lineRange}
                onCopy={(text) => {
                  const value =
                    text ??
                    (activePreview.preview
                      ? activePreview.preview.kind === "text" ||
                        activePreview.preview.kind === "markdown" ||
                        activePreview.preview.kind === "code"
                        ? activePreview.preview.content
                        : activePreview.absolutePath
                      : activePreview.absolutePath);
                  void navigator.clipboard.writeText(value);
                  setPreviewTabs((prev) =>
                    prev.map((t) => (t.id === activePreview.id ? { ...t, copied: true } : t)),
                  );
                  window.setTimeout(() => {
                    setPreviewTabs((prev) =>
                      prev.map((t) => (t.id === activePreview.id ? { ...t, copied: false } : t)),
                    );
                  }, 1600);
                }}
                onClose={() => closePreviewTab(activePreview.id)}
                onQuoteSnippet={onQuotePreviewSnippet}
                onRevealInFileManager={(abs) => {
                  void window.agenticxDesktop?.shellShowItemInFolder?.(abs);
                }}
                revealInFileManagerLabel="在文件管理器中显示"
              />
            )}
          </div>
        ) : null}

        {hasAnyTab && activeKind === "workspace" && workspaceTabOpen ? (
          <WorkspacePanel
            paneId={paneId}
            sessionId={sessionId}
            activeTaskspaceId={activeTaskspaceId}
            onActiveTaskspaceChange={onActiveTaskspaceChange}
            autoRefreshKey={autoRefreshKey}
            tintColor={tintColor}
            hidePanelClose
            onPickFileForReference={onPickFileForReference}
            onPickDirectoryForReference={onPickDirectoryForReference}
            onQuotePreviewSnippet={onQuotePreviewSnippet}
            previewOpenRequest={previewOpenRequest}
            onPreviewOpenRequestHandled={onPreviewOpenRequestHandled}
            onEnsureSessionForWorkspace={onEnsureSessionForWorkspace}
          />
        ) : null}

        {hasAnyTab && activeKind === "terminal" ? (
          <div className="flex h-full min-h-0 flex-col">
            {terminalTabs.length === 0 ? (
              <EmptyBlock
                icon={<TerminalIcon className="h-9 w-9" strokeWidth={1.3} />}
                title="暂无终端"
                subtitle="点击 + 打开终端"
              />
            ) : (
              terminalTabs.map((tab) =>
                tab.id === (activeTerminalTabId ?? terminalTabs[terminalTabs.length - 1]?.id) ? (
                  <div key={tab.id} className="min-h-0 flex-1">
                    <TerminalEmbed tabId={tab.id} cwd={tab.cwd} ccBridgePty={tab.ccBridgePty} />
                  </div>
                ) : null
              )
            )}
          </div>
        ) : null}

        {hasAnyTab && activeKind === "browser" && activeBrowser ? (
          <div className="flex h-full min-h-0 flex-col">
            <form
              className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                navigateBrowser(activeBrowser.id);
              }}
            >
              {(() => {
                const canBack = activeBrowser.historyIndex > 0;
                const canForward =
                  activeBrowser.historyIndex < activeBrowser.history.length - 1;
                const navBtn = (opts: {
                  label: string;
                  disabled: boolean;
                  onClick: () => void;
                  children: ReactNode;
                }) => (
                  <HoverTip label={opts.label}>
                    <button
                      type="button"
                      aria-label={opts.label}
                      disabled={opts.disabled}
                      className={[
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                        opts.disabled
                          ? "cursor-not-allowed text-text-faint opacity-40"
                          : "text-text-muted hover:bg-surface-hover hover:text-text-strong",
                      ].join(" ")}
                      onClick={opts.onClick}
                    >
                      {opts.children}
                    </button>
                  </HoverTip>
                );
                return (
                  <>
                    {navBtn({
                      label: "后退",
                      disabled: !canBack,
                      onClick: () => goBrowserBack(activeBrowser.id),
                      children: <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />,
                    })}
                    {navBtn({
                      label: "前进",
                      disabled: !canForward,
                      onClick: () => goBrowserForward(activeBrowser.id),
                      children: <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />,
                    })}
                    {navBtn({
                      label: "刷新",
                      disabled: false,
                      onClick: () => refreshBrowser(activeBrowser.id),
                      children: <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />,
                    })}
                  </>
                );
              })()}
              <input
                value={activeBrowser.draftUrl}
                onChange={(e) => {
                  const value = e.target.value;
                  setBrowserTabs((prev) =>
                    prev.map((t) => (t.id === activeBrowser.id ? { ...t, draftUrl: value } : t))
                  );
                }}
                placeholder="输入网址，回车打开"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-hover px-2 py-1 text-[12px] text-text-strong outline-none placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
                spellCheck={false}
                autoComplete="off"
              />
            </form>
            {activeBrowser.srcDoc != null ? (
              <div className="min-h-0 flex-1">
                <HtmlPreviewShell
                  content={activeBrowser.srcDoc}
                  title={activeBrowser.title}
                  documentPath={fileUrlToLocalPath(activeBrowser.url)}
                  documentUrl={activeBrowser.url}
                  onQuoteHtmlElement={onQuotePreviewSnippet}
                  showChromeRefresh={false}
                  reloadKey={activeBrowser.reloadNonce ?? 0}
                />
              </div>
            ) : activeBrowser.url && activeBrowser.url !== "about:blank" ? (
              <RemoteBrowserPane
                title={activeBrowser.title}
                url={activeBrowser.url}
                reloadKey={activeBrowser.reloadNonce ?? 0}
              />
            ) : (
              <EmptyBlock
                icon={<Globe className="h-9 w-9" strokeWidth={1.3} />}
                title="新标签页"
                subtitle="在上方地址栏输入网址后回车"
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
