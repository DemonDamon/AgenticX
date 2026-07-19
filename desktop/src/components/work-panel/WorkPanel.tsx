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
  Boxes,
  Bot,
  CheckSquare,
  ChevronDown,
  FileCode2,
  FolderOpen,
  Globe,
  ListTodo,
  PanelRight,
  Plus,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { useAppStore, type SubAgent } from "../../store";
import { WorkspacePanel } from "../WorkspacePanel";
import type { WorkspacePreviewOpenRequest, WorkspacePreviewQuotePayload } from "../workspace/workspace-preview-types";
import { TerminalEmbed } from "../TerminalEmbed";
import { SubAgentCard } from "../SubAgentCard";

export type WorkPanelTabKind = "summary" | "workspace" | "terminal" | "browser";

export type WorkPanelFocus =
  | { kind: "summary" }
  | { kind: "workspace" }
  | { kind: "terminal"; tabId?: string }
  | { kind: "browser"; tabId?: string }
  | null;

type BrowserTab = {
  id: string;
  title: string;
  url: string;
  draftUrl: string;
};

type Props = {
  paneId: string;
  sessionId: string;
  activeTaskspaceId: string | null;
  onActiveTaskspaceChange: (taskspaceId: string | null) => void;
  autoRefreshKey?: number;
  tintColor?: string;
  onClose: () => void;
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

type SummarySectionId = "todo" | "artifacts" | "spawns" | "refs";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeBrowseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "about:blank";
  if (/^https?:\/\//i.test(trimmed) || /^about:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function Section({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: SummarySectionId;
  title: string;
  count?: number;
  open: boolean;
  onToggle: (id: SummarySectionId) => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-strong hover:bg-surface-hover/60"
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
      {open ? <div className="px-3 pb-3">{children}</div> : null}
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

  const [activeKind, setActiveKind] = useState<WorkPanelTabKind>("summary");
  const [activeBrowserId, setActiveBrowserId] = useState<string | null>(null);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [workspaceTabOpen, setWorkspaceTabOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusPos, setPlusPos] = useState<{ left: number; top: number } | null>(null);
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  const [openSections, setOpenSections] = useState<Record<SummarySectionId, boolean>>({
    todo: true,
    artifacts: true,
    spawns: true,
    refs: false,
  });

  const activeBrowser = useMemo(
    () => browserTabs.find((t) => t.id === activeBrowserId) ?? null,
    [browserTabs, activeBrowserId]
  );

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === "summary") {
      setActiveKind("summary");
    } else if (focusRequest.kind === "workspace") {
      setWorkspaceTabOpen(true);
      setActiveKind("workspace");
    } else if (focusRequest.kind === "terminal") {
      setActiveKind("terminal");
      if (focusRequest.tabId) setActivePaneTerminalTab(paneId, focusRequest.tabId);
    } else if (focusRequest.kind === "browser") {
      setActiveKind("browser");
      if (focusRequest.tabId) setActiveBrowserId(focusRequest.tabId);
    }
    onFocusRequestHandled?.();
  }, [focusRequest, onFocusRequestHandled, paneId, setActivePaneTerminalTab]);

  useEffect(() => {
    if (subAgents.length > 0) {
      setOpenSections((prev) => (prev.spawns ? prev : { ...prev, spawns: true }));
    }
  }, [subAgents.length]);

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
    const tab: BrowserTab = {
      id,
      title: "新标签页",
      url: "about:blank",
      draftUrl: "",
    };
    setBrowserTabs((prev) => [...prev, tab]);
    setActiveBrowserId(id);
    setActiveKind("browser");
    closePlus();
  };

  const closeBrowserTab = (tabId: string) => {
    setBrowserTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeBrowserId === tabId) {
        const last = next[next.length - 1];
        setActiveBrowserId(last?.id ?? null);
        if (!last) setActiveKind("summary");
      }
      return next;
    });
  };

  const navigateBrowser = (tabId: string) => {
    setBrowserTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const nextUrl = normalizeBrowseUrl(t.draftUrl || t.url);
        let title = t.title;
        try {
          title = nextUrl === "about:blank" ? "新标签页" : new URL(nextUrl).hostname || "浏览器";
        } catch {
          title = "浏览器";
        }
        return { ...t, url: nextUrl, draftUrl: nextUrl, title };
      })
    );
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
            className="fixed z-[120] min-w-[160px] overflow-hidden rounded-xl border border-border bg-surface-card py-1 shadow-lg"
            style={{ left: plusPos.left, top: plusPos.top }}
            onMouseDown={(e) => e.stopPropagation()}
          >
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

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-surface-card"
      style={tintColor ? { backgroundColor: tintColor } : undefined}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-1.5">
        <button
          type="button"
          className={`flex h-7 max-w-[120px] items-center gap-1.5 rounded-md px-2 text-[12px] ${
            activeKind === "summary"
              ? "bg-surface-card-strong text-text-strong"
              : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
          }`}
          onClick={() => setActiveKind("summary")}
        >
          <ListTodo className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate">任务摘要</span>
        </button>

        {workspaceTabOpen ? (
          <button
            type="button"
            className={`flex h-7 max-w-[110px] items-center gap-1.5 rounded-md px-2 text-[12px] ${
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
                if (activeKind === "workspace") setActiveKind("summary");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setWorkspaceTabOpen(false);
                  if (activeKind === "workspace") setActiveKind("summary");
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
            className={`flex h-7 max-w-[110px] items-center gap-1.5 rounded-md px-2 text-[12px] ${
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
                  setActiveKind("summary");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  removePaneTerminalTab(paneId, tab.id);
                  if (activeKind === "terminal" && activeTerminalTabId === tab.id) {
                    setActiveKind("summary");
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
            className={`flex h-7 max-w-[120px] items-center gap-1.5 rounded-md px-2 text-[12px] ${
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

        <button
          ref={plusBtnRef}
          type="button"
          className="agx-topbar-btn !px-[5px]"
          title="打开终端 / 浏览器 / 工作区"
          aria-label="新建工作台标签"
          onClick={openPlusMenu}
        >
          <Plus className="h-[16px] w-[16px]" strokeWidth={1.8} />
        </button>

        <div className="flex-1" />

        <button
          type="button"
          className="agx-topbar-btn !px-[5px]"
          onClick={onClose}
          title="收起面板"
          aria-label="收起面板"
        >
          <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      {plusMenu}

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeKind === "summary" ? (
          <div className="h-full overflow-y-auto">
            <Section
              id="todo"
              title="待办"
              open={openSections.todo}
              onToggle={toggleSection}
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
              open={openSections.artifacts}
              onToggle={toggleSection}
            >
              <EmptyBlock
                icon={<Boxes className="h-9 w-9" strokeWidth={1.3} />}
                title="暂无产物"
                subtitle="任务完成后，生成的文件将展示在这里"
              />
              <button
                type="button"
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-2 text-[12px] text-text-subtle transition hover:border-[var(--ui-btn-primary-border,#3b82f6)] hover:bg-[color-mix(in_srgb,var(--ui-btn-primary-bg,#3b82f6)_12%,transparent)] hover:text-[var(--ui-btn-primary-bg,#3b82f6)]"
                onClick={onOpenDelivery}
              >
                <Boxes className="h-3.5 w-3.5" strokeWidth={1.7} />
                新建交付任务（POC / MVP）
              </button>
            </Section>

            <Section
              id="spawns"
              title="子智能体"
              count={subAgents.length}
              open={openSections.spawns}
              onToggle={toggleSection}
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

            <Section
              id="refs"
              title="参考信息"
              open={openSections.refs}
              onToggle={toggleSection}
            >
              <EmptyBlock
                icon={<FileCode2 className="h-9 w-9" strokeWidth={1.3} />}
                title="暂无参考"
                subtitle="任务执行中调用的技能与参考网页会显示在这里"
              />
            </Section>
          </div>
        ) : null}

        {activeKind === "workspace" && workspaceTabOpen ? (
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

        {activeKind === "terminal" ? (
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

        {activeKind === "browser" && activeBrowser ? (
          <div className="flex h-full min-h-0 flex-col">
            <form
              className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                navigateBrowser(activeBrowser.id);
              }}
            >
              <Globe className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.7} />
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
            {activeBrowser.url && activeBrowser.url !== "about:blank" ? (
              <iframe
                title={activeBrowser.title}
                src={activeBrowser.url}
                className="min-h-0 w-full flex-1 border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
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
