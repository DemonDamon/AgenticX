import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import type { ErrorInfo, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  Database,
  GitBranch,
  GripVertical,
  Expand,
  Layers,
  LayoutList,
  Quote,
  Search,
  Share2,
  Sparkles,
  Radar,
  SquarePen,
  Wand2,
  Wrench,
  Users,
  FolderOpen,
  Bot,
  History,
  X,
  PanelRightClose,
} from "lucide-react";
import {
  useAppStore,
  type Avatar,
  type ChatPane as ChatPaneState,
  type Message,
  type MessageAttachment,
  type PendingConfirm,
  type QueuedMessage,
} from "../store";
import { startRecording, stopRecording } from "../voice/stt";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { SpawnsColumn } from "./SpawnsColumn";
import { MessageRenderer, renderToolMessageExtras } from "./messages/MessageRenderer";
import { groupConsecutiveToolMessages, type GroupedChatRow } from "./messages/group-tool-messages";
import { expandMessagesToTopLevelRows } from "./messages/react-blocks";
import { TurnToolGroupCard } from "./messages/TurnToolGroupCard";
import { WorkingIndicator } from "./messages/WorkingIndicator";
import { ChatImAvatar, ImBubble } from "./messages/ImBubble";
import { TerminalLine } from "./messages/TerminalLine";
import { CleanBlock } from "./messages/CleanBlock";
import { QueuedMessageBubble } from "./messages/QueuedMessageBubble";
import { StallRecoveryCard } from "./messages/StallRecoveryCard";
import { ForwardPicker, type ForwardConfirmPayload } from "./ForwardPicker";
import { HoverTip } from "./ds/HoverTip";
import { Toast } from "./ds/Toast";
import { extractClipboardImageFiles, withClipboardImageNames } from "../utils/clipboard-images";
import { clipboardPlainTextForPaste } from "../utils/clipboard-plain-text";
import { isKnownNonVisionChatModel } from "../utils/model-vision";
import {
  canStopCurrentRun,
  shouldInterruptOnResend,
} from "../utils/streaming-stop-policy";
import {
  attachmentsFromSessionRow,
  mapLoadedSessionMessage,
  type LoadedSessionMessage,
} from "../utils/session-message-map";
import { filterPersistedMessagesForDeletion } from "../utils/retry-trim-policy";
import { favoriteStorageMessageId } from "../utils/favorite-selection";
import { createResizeRafScheduler } from "../utils/resize-raf";
import { avatarTintBg } from "../utils/avatar-color";
import { getProviderDisplayName } from "../utils/provider-display";
import { isAutomationPaneAvatarId } from "../utils/automation-pane";
import {
  ccBridgeSendToolProgressLabel,
  parseCcBridgeModeFromPayload,
  type CcBridgeSessionModeHint,
} from "../utils/cc-bridge-ui";
import type { AutomationTask } from "./automation/types";
import { parseReasoningContent } from "./messages/reasoning-parser";
import { messagePlainTextForClipboard } from "../utils/markdown-copy-format";
import { usePaneSortableHandle } from "./pane-sortable-context";
import { FeishuBadge } from "./FeishuBadge";
import machiEmptyState from "../assets/machi-logo-transparent.png";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { createKbApi } from "./settings/knowledge/api";
import {
  clearPaneAwaitingFreshSession,
  clearPaneLazyInheritParent,
  markPaneAwaitingFreshSession,
  peekPaneLazyInheritParent,
  setPaneLazyInheritParent,
} from "../utils/pane-fresh-session";

/** Shown in the user bubble and sent as user_input when sending attachments without typed text (API min_length=1). */
const ATTACHMENT_ONLY_USER_PROMPT = "（见附件，请结合附件回答。）";
const VISION_UNSUPPORTED_TOAST = "模型不支持该文件类型";
function resolveQuoteBody(message: Message, selectedText?: string): string {
  const sel = selectedText?.trim() ?? "";
  if (sel.length > 0) return sel;
  if (message.role === "assistant") {
    const parsed = parseReasoningContent(message.content);
    if (parsed.hasReasoningTag) {
      const resp = (parsed.response ?? "").trim();
      if (resp.length > 0) return resp;
    }
  }
  return message.content;
}

function resolveForwardSender(message: Message, userLabel = "我"): string {
  if (message.role !== "assistant") return userLabel.trim() || "我";
  const raw = String(message.avatarName || message.agentId || "AI").trim();
  if (!raw) return "AI";
  return raw.toLowerCase() === "meta" ? "Machi" : raw;
}

function shellSingleQuote(input: string): string {
  return `'${input.replace(/'/g, `'\"'\"'`)}'`;
}

const EMPTY_QUEUE: QueuedMessage[] = [];
const KB_RETRIEVAL_MODE_OPTIONS: { value: "auto" | "always"; label: string }[] = [
  { value: "auto", label: "智能检索" },
  { value: "always", label: "始终检索" },
];

const FALLBACK_PANE: ChatPaneState = {
  id: "fallback-pane",
  avatarId: null,
  avatarName: "Machi",
  sessionId: "",
  modelProvider: "",
  modelName: "",
  messages: [],
  historyOpen: false,
  contextInherited: false,
  taskspacePanelOpen: false,
  membersPanelOpen: false,
  sidePanelTab: "workspace",
  activeTaskspaceId: null,
  spawnsColumnOpen: false,
  spawnsColumnSuppressAuto: false,
  spawnsColumnBaselineIds: [],
  terminalTabs: [],
  activeTerminalTabId: null,
  sessionTokens: { input: 0, output: 0 },
  historySearchTerms: [],
};

/** Compose-style primary action (豆包式「撰写」语义) + 下拉切换「全新对话」/「继承上下文」，默认前者。 */
function NewTopicSplitControl({ onNewTopic }: { onNewTopic: (inherit: boolean) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inheritMode, setInheritMode] = useState(false);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setMenuPos({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
      });
    }
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const panel =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            style={{ bottom: menuPos.bottom, left: menuPos.left }}
            className="fixed z-[9999] w-[160px] overflow-hidden rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
            role="listbox"
            aria-label="新建对话方式"
          >
            <button
              type="button"
              role="option"
              aria-selected={!inheritMode}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                !inheritMode ? "bg-surface-hover" : "hover:bg-surface-hover"
              }`}
              onClick={() => {
                setInheritMode(false);
                setMenuOpen(false);
              }}
            >
              <SquarePen
                className={`h-[15px] w-[15px] shrink-0 ${
                  !inheritMode ? "text-text-strong" : "text-text-muted group-hover:text-text-standard"
                }`}
                strokeWidth={2}
              />
              <span className="flex flex-1 flex-col gap-0.5">
                <span
                  className={`text-[13px] font-medium leading-none ${
                    !inheritMode ? "text-text-strong" : "text-text-standard"
                  }`}
                >
                  全新对话
                </span>
                <span className="text-[11px] leading-none text-text-faint">不继承上下文</span>
              </span>
              <span className="flex w-4 shrink-0 justify-end">
                {!inheritMode && <Check className="h-3.5 w-3.5 text-text-strong" strokeWidth={2.5} />}
              </span>
            </button>
            <button
              type="button"
              role="option"
              aria-selected={inheritMode}
              className={`group mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                inheritMode ? "bg-surface-hover" : "hover:bg-surface-hover"
              }`}
              onClick={() => {
                setInheritMode(true);
                setMenuOpen(false);
              }}
            >
              <GitBranch
                className={`h-[15px] w-[15px] shrink-0 ${
                  inheritMode ? "text-text-strong" : "text-text-muted group-hover:text-text-standard"
                }`}
                strokeWidth={2}
              />
              <span className="flex flex-1 flex-col gap-0.5">
                <span
                  className={`text-[13px] font-medium leading-none ${
                    inheritMode ? "text-text-strong" : "text-text-standard"
                  }`}
                >
                  继承上下文
                </span>
                <span className="text-[11px] leading-none text-text-faint">携带摘要接续</span>
              </span>
              <span className="flex w-4 shrink-0 justify-end">
                {inheritMode && <Check className="h-3.5 w-3.5 text-text-strong" strokeWidth={2.5} />}
              </span>
            </button>
          </div>,
          document.body
        )
      : null;

  const baseTip = inheritMode ? "新对话 · 继承上下文（当前选项）" : "全新对话 · 不继承上下文（当前选项）";

  return (
    <>
      <div ref={rootRef} className="flex h-[26px] shrink-0 items-stretch overflow-hidden rounded-md bg-transparent transition-colors hover:bg-surface-hover">
        <HoverTip label={baseTip}>
          <button
            type="button"
            className="flex h-full w-7 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-text-strong"
            aria-label={inheritMode ? "新建对话：继承上下文" : "新建对话：全新对话"}
            onClick={() => onNewTopic(inheritMode)}
          >
            {inheritMode ? (
              <GitBranch className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden />
            ) : (
              <SquarePen className="h-[14px] w-[14px]" strokeWidth={2} aria-hidden />
            )}
          </button>
        </HoverTip>
        <div className="my-1.5 w-[1px] shrink-0 self-stretch bg-border" aria-hidden />
        <HoverTip label="切换新建方式">
          <button
            ref={chevronRef}
            type="button"
            className="flex h-full w-[18px] shrink-0 items-center justify-center text-text-muted transition-colors hover:text-text-strong"
            aria-label="展开新建对话选项"
            aria-expanded={menuOpen}
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${menuOpen ? "rotate-180" : ""}`} strokeWidth={2.5} aria-hidden />
          </button>
        </HoverTip>
      </div>
      {panel}
    </>
  );
}

interface SkillItem {
  name: string;
  description: string;
  icon?: string;
  source?: string;
  globally_disabled?: boolean;
}

interface SkillPickerButtonProps {
  apiBase: string;
  apiToken: string;
  onSelect: (skill: SkillItem) => void;
}

const SKILL_DROPDOWN_WIDTH = 288; // w-72

function SkillPickerButton({ apiBase, apiToken, onSelect }: SkillPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted";

  const fetchSkills = async () => {
    if (!apiBase) return;
    setLoading(true);
    try {
      const resp = await fetch(`${apiBase}/api/skills`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (resp.ok) {
        const data = (await resp.json()) as { items?: SkillItem[] };
        const items: SkillItem[] = (data.items ?? []).filter((s) => !s.globally_disabled);
        setSkills(items);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Left-align the dropdown to the button so it opens rightward, staying within the chat pane.
      // Clamp: don't let right edge go off screen (8px margin).
      const left = Math.min(rect.left, window.innerWidth - SKILL_DROPDOWN_WIDTH - 8);
      setDropdownPos({
        bottom: window.innerHeight - rect.top + 6,
        left: Math.max(8, left),
      });
    }
    setOpen(true);
    setQuery("");
    if (skills.length === 0) await fetchSkills();
    setTimeout(() => searchRef.current?.focus(), 60);
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const btn = btnRef.current;
      const dropdown = document.getElementById("agx-skill-picker-dropdown");
      if (btn && btn.contains(target)) return;
      if (dropdown && dropdown.contains(target)) return;
      handleClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = query.trim()
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.description?.toLowerCase().includes(query.toLowerCase())
      )
    : skills;

  const dropdown =
    open && dropdownPos
      ? createPortal(
          <div
            id="agx-skill-picker-dropdown"
            style={{ bottom: dropdownPos.bottom, left: dropdownPos.left }}
            className="fixed z-[9999] w-72 rounded-xl border border-border bg-surface-panel shadow-xl backdrop-blur-md"
          >
            <div className="border-b border-border p-2">
              <input
                ref={searchRef}
                type="text"
                className="w-full rounded-lg border border-border bg-surface-card px-2.5 py-1.5 text-[12px] text-text-strong outline-none placeholder:text-text-faint focus:border-[rgba(var(--theme-color-rgb,59,130,246),0.55)]"
                placeholder="搜索技能…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleClose();
                }}
              />
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
              {loading ? (
                <div className="px-3 py-4 text-center text-[11px] text-text-faint">加载中…</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-text-faint">
                  {query ? `未找到"${query}"相关技能` : "暂无可用技能"}
                </div>
              ) : (
                filtered.map((skill) => (
                  <button
                    key={skill.name}
                    type="button"
                    className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-hover"
                    onClick={() => {
                      onSelect(skill);
                      handleClose();
                    }}
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--theme-color-rgb,59,130,246),0.22)] text-[rgb(var(--theme-color-rgb,59,130,246))]">
                      <Wand2 className="h-3 w-3" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium leading-tight text-text-strong">
                        {skill.name}
                      </div>
                      {skill.description ? (
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-faint">
                          {skill.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <HoverTip label="引用技能 · 注入 Skill 上下文">
        <button
          ref={btnRef}
          type="button"
          className={iconBtn}
          aria-label="引用技能"
          onClick={open ? handleClose : handleOpen}
        >
          <Layers className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden />
        </button>
      </HoverTip>
      {dropdown}
    </>
  );
}

class HistoryPanelBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; retryCount: number }
> {
  state = { hasError: false, retryCount: 0 };
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[HistoryPanelBoundary]", error.message, info.componentStack?.slice(0, 200));
    if (this.state.retryCount < 2) {
      this._retryTimer = setTimeout(() => {
        this.setState((prev) => ({ hasError: false, retryCount: prev.retryCount + 1 }));
      }, 300);
    }
  }

  componentWillUnmount() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
  }

  render() {
    if (this.state.hasError) {
      if (this.state.retryCount < 2) return null;
      return (
        <div className="h-full w-[220px] shrink-0 border-l border-border bg-surface-card flex items-center justify-center">
          <button
            className="rounded px-3 py-2 text-xs text-text-subtle hover:bg-surface-hover hover:text-text-strong"
            onClick={() => this.setState({ hasError: false, retryCount: 0 })}
          >
            历史面板出错，点击重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PaneModelPicker({ paneId }: { paneId: string }) {
  const settings = useAppStore((s) => s.settings);
  const setPaneModel = useAppStore((s) => s.setPaneModel);
  const paneModel = useAppStore((s) => s.panes.find((pane) => pane.id === paneId));
  const [open, setOpen] = useState(false);

  const handleSelect = (provider: string, model: string) => {
    setPaneModel(paneId, provider, model);
    setOpen(false);
    // Persist the current pane model as global fallback for restarts.
    void window.agenticxDesktop.saveConfig({ activeProvider: provider, activeModel: model });
    // If this pane is bound to a real session, record the model against that
    // session so a cold restart + jump-back restores the exact pick.
    const sid = String(paneModel?.sessionId ?? "").trim();
    if (sid) {
      void window.agenticxDesktop.setSessionModel({ sessionId: sid, provider, model });
    }
  };

  const options = useMemo(() => {
    const result: { provider: string; model: string; label: string }[] = [];
    for (const [provName, entry] of Object.entries(settings.providers)) {
      if (entry.enabled === false) continue;
      if (!entry.apiKey) continue;
      const provLabel = getProviderDisplayName(provName, entry);
      if (entry.models.length > 0) {
        for (const m of entry.models) result.push({ provider: provName, model: m, label: `${provLabel}/${m}` });
      } else if (entry.model) {
        result.push({ provider: provName, model: entry.model, label: `${provLabel}/${entry.model}` });
      }
    }
    return result;
  }, [settings.providers]);

  const currentProvider = (paneModel?.modelProvider || "").trim();
  const currentModel = (paneModel?.modelName || "").trim();
  const currentLabel = useMemo(() => {
    if (!currentModel) return "未选模型";
    if (!currentProvider) return currentModel;
    const entry = settings.providers[currentProvider];
    const provLabel = getProviderDisplayName(currentProvider, entry);
    return `${provLabel}/${currentModel}`;
  }, [currentModel, currentProvider, settings.providers]);

  return (
    <div className="relative">
      <button
        className="flex h-7 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
        onClick={() => setOpen((v) => !v)}
        title="切换模型"
      >
        <span className="max-w-[180px] truncate">{currentLabel}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-1 w-[240px] overflow-hidden rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-text-faint">
                请先在设置中配置模型
              </div>
            ) : (
              options.map((opt) => {
                const isActive = opt.provider === currentProvider && opt.model === currentModel;
                return (
                  <button
                    key={`${opt.provider}:${opt.model}`}
                    type="button"
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                    onClick={() => handleSelect(opt.provider, opt.model)}
                  >
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span
                        className={`text-[13px] font-medium leading-none ${
                          isActive ? "text-text-strong" : "text-text-standard"
                        }`}
                      >
                        {opt.label}
                      </span>
                    </span>
                    <span className="flex w-4 shrink-0 justify-end">
                      {isActive && <Check className="h-3.5 w-3.5 text-text-strong" strokeWidth={2.5} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PaneKnowledgeRetrievalModeSwitch({
  apiToken,
  apiBase,
}: {
  apiToken: string;
  apiBase: string;
}) {
  const resolveApiBase = useCallback(async () => {
    const base = String(apiBase ?? "").trim();
    if (base) return base.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [apiBase]);
  const api = useMemo(() => createKbApi(apiToken, resolveApiBase), [apiToken, resolveApiBase]);
  const [mode, setMode] = useState<"auto" | "always">("auto");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const body = await api.readConfig();
      const modeRaw = body.config.retrieval?.mode;
      // Legacy configs may still carry "manual" — fold it into auto so the
      // switch stays in sync with the simplified two-state model.
      setMode(modeRaw === "always" ? "always" : "auto");
    } catch {
      // Keep last known mode; Chat should still be usable if KB API is unavailable.
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveMode = useCallback(
    async (nextMode: "auto" | "always") => {
      if (saving) return;
      const previous = mode;
      setMode(nextMode);
      setSaving(true);
      try {
        // Always re-read before write to avoid clobbering concurrent KB edits from settings.
        const current = (await api.readConfig()).config;
        const nextConfig = {
          ...current,
          retrieval: {
            ...current.retrieval,
            mode: nextMode,
          },
        };
        await api.writeConfig(nextConfig);
      } catch {
        setMode(previous);
      } finally {
        setSaving(false);
      }
    },
    [api, mode, saving],
  );

  return (
    <div className="relative">
      <HoverTip label={`知识库检索模式：${KB_RETRIEVAL_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? "智能检索"}`}>
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
          disabled={saving}
          onClick={() => setOpen((v) => !v)}
          aria-label="知识库检索模式"
        >
          {mode === "auto" ? (
            <Sparkles className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden />
          ) : (
            <Radar className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden />
          )}
        </button>
      </HoverTip>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-1 w-[120px] overflow-hidden rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl">
            {KB_RETRIEVAL_MODE_OPTIONS.map((opt) => {
              const isActive = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  className={`group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors ${
                    isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                  } ${opt.value === "always" ? "mt-0.5" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    void saveMode(opt.value);
                  }}
                >
                  <div className="flex items-center gap-2">
                    {opt.value === "auto" ? (
                      <Sparkles
                        className={`h-[15px] w-[15px] shrink-0 ${
                          isActive ? "text-text-strong" : "text-text-muted group-hover:text-text-standard"
                        }`}
                        strokeWidth={2}
                      />
                    ) : (
                      <Radar
                        className={`h-[15px] w-[15px] shrink-0 ${
                          isActive ? "text-text-strong" : "text-text-muted group-hover:text-text-standard"
                        }`}
                        strokeWidth={2}
                      />
                    )}
                    <span
                      className={`whitespace-nowrap text-[13px] font-medium leading-none ${
                        isActive ? "text-text-strong" : "text-text-standard"
                      }`}
                    >
                      {opt.label}
                    </span>
                  </div>
                  {isActive ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-text-strong" strokeWidth={2.5} />
                  ) : (
                    <div className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

type ActionCircleButtonProps = {
  hasInput: boolean;
  streaming: boolean;
  recording: boolean;
  onSend: () => void;
  onMic: () => void;
  onStop: () => void;
};

function ActionCircleButton({ hasInput, streaming, recording, onSend, onMic, onStop }: ActionCircleButtonProps) {
  let onClick: () => void;
  let title: string;
  let icon: ReactNode;
  let filled: boolean;

  if (streaming && hasInput) {
    onClick = onSend;
    title = "排队发送";
    icon = <SendIcon />;
    filled = true;
  } else if (streaming) {
    onClick = onStop;
    title = "中断生成";
    icon = <StopIcon />;
    filled = false;
  } else if (hasInput) {
    onClick = onSend;
    title = "发送";
    icon = <SendIcon />;
    filled = true;
  } else if (recording) {
    onClick = onMic;
    title = "停止录音";
    icon = (
      <span className="flex gap-0.5 items-end h-4">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-0.5 rounded-full animate-pulse"
            style={{
              background: "currentColor",
              height: `${[8, 14, 10, 12][i]}px`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </span>
    );
    filled = false;
  } else {
    onClick = onMic;
    title = "语音输入";
    icon = <MicIcon />;
    filled = false;
  }

  return (
    <button
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150 active:scale-95 ${
        filled ? "" : "text-text-faint hover:text-text-muted"
      }`}
      style={
        filled
          ? { background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }
          : undefined
      }
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

function AttachmentChip({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  const isImage = !!file.dataUrl || file.mimeType.startsWith("image/");
  const isReferenceToken = !!file.referenceToken;
  return (
    <div
      className={`group relative inline-flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
        isReferenceToken
          ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
          : "border-border bg-surface-card hover:bg-surface-hover"
      }`}
      style={{ maxWidth: "240px" }}
    >
      {isImage && file.dataUrl ? (
        <img src={file.dataUrl} alt={file.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : isReferenceToken ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
          <span className="text-lg">↘</span>
        </div>
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#3b82f6] text-white">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </div>
      )}
      <div className="flex min-w-0 flex-col justify-center">
        <div className={`truncate font-medium leading-tight ${isReferenceToken ? "text-sky-100" : "text-text-primary"}`}>
          {file.name}
        </div>
        {isReferenceToken ? (
          <div className="text-xs text-sky-200/80 mt-0.5">@ 文件引用</div>
        ) : file.status === "parsing" ? (
          <div className="text-xs text-text-faint animate-pulse mt-0.5">解析中...</div>
        ) : file.status === "error" ? (
          <div className="truncate text-xs text-status-error mt-0.5">{file.errorText || "解析失败"}</div>
        ) : (
          <div className="text-xs text-text-faint mt-0.5">
            {file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : '文件'} · {formatFileSize(file.size)}
          </div>
        )}
      </div>
      <button
        className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 ${
          isReferenceToken
            ? "bg-sky-500/20 text-sky-200 hover:bg-sky-500/40 hover:text-sky-100"
            : "bg-surface-panel text-text-muted hover:bg-surface-hover hover:text-text-primary"
        }`}
        onClick={onRemove}
        title="移除附件"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

type Props = {
  paneId: string;
  focused: boolean;
  onFocus: () => void;
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
};

function ModelBadge({ provider, model }: { provider?: string; model?: string }) {
  const providers = useAppStore((s) => s.settings.providers);
  if (!model) return null;
  const entry = provider ? providers[provider] : undefined;
  const provLabel = provider ? getProviderDisplayName(provider, entry) : "";
  const label = provLabel ? `${provLabel}/${model}` : model;
  return (
    <span className="mb-1 inline-block rounded bg-surface-card-strong px-1.5 py-0.5 text-[10px] text-text-faint">
      {label}
    </span>
  );
}

function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
}

function normalizeStreamText(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function isNearBottom(el: HTMLDivElement, thresholdPx = 96): boolean {
  const remain = el.scrollHeight - (el.scrollTop + el.clientHeight);
  return remain <= thresholdPx;
}

function formatToolResultMessage(toolNameRaw: unknown, resultRaw: unknown): { content: string; silent: boolean } {
  const toolName = String(toolNameRaw ?? "tool");
  const resultText = String(resultRaw ?? "");
  if (toolName === "delegate_to_avatar") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const delegated = Boolean(parsed.delegated);
      const avatarName = String(parsed.avatar_name ?? "");
      const delegationId = String(parsed.delegation_id ?? parsed.agent_id ?? "").trim();
      if (delegated) {
        return {
          content: `🤝 已委派给 ${avatarName || "分身"}${delegationId ? `\nID: ${delegationId}` : ""}`,
          silent: false,
        };
      }
    } catch {
      // Fall through to generic formatter.
    }
  }
  if (toolName === "spawn_subagent") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const agentId = String(parsed.agent_id ?? "").trim();
      const name = String(parsed.name ?? (agentId || "subagent"));
      const role = String(parsed.role ?? "worker");
      const provider = String(parsed.provider ?? "").trim();
      const model = String(parsed.model ?? "").trim();
      const task = String(parsed.task ?? "").replace(/\s+/g, " ").trim();
      const modelLabel = provider && model ? ` · ${provider}/${model}` : "";
      const taskPreview = task ? `\n任务: ${task.slice(0, 140)}${task.length > 140 ? "…" : ""}` : "";
      return {
        content: `🚀 已启动子智能体: ${name} (${role})${modelLabel}${agentId ? `\nID: ${agentId}` : ""}${taskPreview}`,
        silent: false,
      };
    } catch {
      // Fall through to generic formatter.
    }
  }
  if (toolName === "todo_write") {
    const cleaned = resultText.replace(/\s+\n/g, "\n").trim();
    if (/^\[[ xX]\]/m.test(cleaned)) {
      return { content: `🗂 任务清单更新\n${cleaned}`, silent: false };
    }
  }
  if (toolName === "cc_bridge_send") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const mode = String(parsed.mode ?? "headless");
      const ok = Boolean(parsed.ok);
      const interactive = Boolean(parsed.interactive);
      const pr = String(parsed.parsed_response ?? "").trim();
      const conf = Number(parsed.parse_confidence ?? 0);
      if (mode === "visible_tui") {
        if (interactive && ok) {
          return {
            content:
              "✅ 已发送到 Claude Code（Visible TUI）。请继续在右侧「claude-code」终端交互；如出现权限提示，直接在终端内按键确认。",
            silent: false,
          };
        }
        if (pr && ok) {
          return {
            content: `✅ Claude Code（Visible TUI，解析置信度 ${Math.round(Math.min(1, conf) * 100)}%）\n\n${pr}`,
            silent: false,
          };
        }
        const tail = String(parsed.tail ?? "").slice(0, 900);
        return {
          content: `⏳ Visible TUI：${ok ? "本轮已结束" : "未完成或解析置信度较低"}。请在右侧「claude-code」内嵌交互终端查看；若未自动连接，请确认 cc-bridge 已启动且配置 token 有效。\n${tail ? `\n---\n${tail}` : ""}`,
          silent: false,
        };
      }
    } catch {
      // fall through
    }
  }
  if (toolName === "query_subagent_status") {
    if (/【已阻止】/.test(resultText)) {
      return { content: "", silent: true };
    }
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const one = parsed?.subagent as Record<string, unknown> | undefined;
      if (one) {
        const name = String(one.name ?? one.agent_id ?? "subagent");
        const status = String(one.status ?? "unknown");
        const action = String(one.current_action ?? "").trim();
        return {
          content: `📡 状态快照: ${name} = ${status}${action ? ` · ${action}` : ""}`,
          silent: false,
        };
      }
      const rows = Array.isArray(parsed?.subagents) ? (parsed.subagents as Array<Record<string, unknown>>) : [];
      if (rows.length > 0) {
        const counts = rows.reduce<Record<string, number>>(
          (acc, row) => {
            const s = String(row.status ?? "unknown");
            acc[s] = (acc[s] ?? 0) + 1;
            return acc;
          },
          {}
        );
        const summary = Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ");
        return { content: `📡 状态快照: ${rows.length} 个子智能体 (${summary})`, silent: false };
      }
    } catch {
      // Fall through to generic formatter.
    }
  }
  // Plan-Id: machi-kb-stage1-local-mvp — citation card summary for knowledge_search.
  if (toolName === "knowledge_search") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const ok = parsed.ok !== false;
      const disabled = Boolean(parsed.disabled);
      const rawHits = Array.isArray(parsed.hits) ? (parsed.hits as Array<Record<string, unknown>>) : [];
      if (disabled) {
        return {
          content: "📚 知识库未启用（`knowledge_search` 未产生结果）。",
          silent: false,
        };
      }
      if (!ok) {
        const err = String(parsed.error ?? "未知错误");
        return { content: `⚠️ knowledge_search 失败：${err}`, silent: false };
      }
      if (rawHits.length === 0) {
        return {
          content: "📚 知识库未命中相关片段。建议向用户确认是否需要兜底到一般知识。",
          silent: false,
        };
      }
      const lines: string[] = [`📚 知识库命中 ${rawHits.length} 条引用：`];
      rawHits.slice(0, 5).forEach((hit, idx) => {
        const score = typeof hit.score === "number" ? hit.score.toFixed(3) : "?";
        const source = (hit.source as Record<string, unknown>) ?? {};
        const title = String(source.title ?? source.uri ?? "");
        const chunkIdx = source.chunk_index;
        const chunkLabel = chunkIdx !== null && chunkIdx !== undefined ? ` · #${chunkIdx}` : "";
        const textRaw = String(hit.text ?? "").replace(/\s+/g, " ").trim();
        const preview = textRaw.length > 160 ? `${textRaw.slice(0, 160)}…` : textRaw;
        lines.push(`  ${idx + 1}. ${title}${chunkLabel} · score=${score}\n     ${preview}`);
      });
      if (rawHits.length > 5) {
        lines.push(`  …以及 ${rawHits.length - 5} 条更多`);
      }
      return { content: lines.join("\n"), silent: false };
    } catch {
      // Fall through — JSON parse failure is unexpected but shouldn't block output.
    }
  }

  const compact = resultText.slice(0, 500);
  const isError = /^\s*ERROR:/i.test(resultText);
  const isBenignTodoConflict =
    toolName === "todo_write" && /only one task can be in_progress/i.test(resultText);

  if (isBenignTodoConflict) {
    return {
      content: "🧭 任务清单同步中：系统会自动收敛为单一进行中任务，无需操作。",
      silent: false,
    };
  }
  if (isError) {
    return { content: `⚠️ ${toolName} 提示: ${compact}`, silent: false };
  }
  return { content: `✅ ${toolName} 结果: ${compact}`, silent: false };
}

function deriveToolStatusFromResult(resultRaw: unknown): "done" | "error" {
  const t =
    typeof resultRaw === "string"
      ? resultRaw
      : (() => {
          try {
            return JSON.stringify(resultRaw ?? "");
          } catch {
            return String(resultRaw ?? "");
          }
        })();
  if (/^\s*ERROR:/i.test(t)) return "error";
  const m = t.match(/exit_code=(\d+)/);
  if (m && m[1] !== "0") return "error";
  return "done";
}

function serializeToolResultRaw(resultRaw: unknown): string {
  if (typeof resultRaw === "string") return resultRaw;
  try {
    return JSON.stringify(resultRaw ?? "", null, 2);
  } catch {
    return String(resultRaw ?? "");
  }
}

function isSetTaskspaceToolSuccess(resultRaw: unknown): boolean {
  if (resultRaw && typeof resultRaw === "object") {
    return (resultRaw as { ok?: unknown }).ok === true;
  }
  if (typeof resultRaw !== "string") return false;
  const text = resultRaw.trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as { ok?: unknown };
    return parsed?.ok === true;
  } catch {
    return false;
  }
}

function buildToolCallLivePreview(toolNameRaw: unknown, argsRaw: unknown): string | null {
  const toolName = String(toolNameRaw ?? "").trim();
  const args = (argsRaw ?? {}) as Record<string, unknown>;
  if (toolName === "file_write") {
    const path = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    if (!content.trim()) return null;
    const preview = content.slice(0, 1200);
    return `# file_write: ${path || "(unknown path)"}\n${preview}${content.length > 1200 ? "\n... (truncated)" : ""}`;
  }
  if (toolName === "file_edit") {
    const path = String(args.path ?? "").trim();
    const newText = String(args.new_text ?? "");
    if (!newText.trim()) return null;
    const preview = newText.slice(0, 1200);
    return `# file_edit: ${path || "(unknown path)"}\n${preview}${newText.length > 1200 ? "\n... (truncated)" : ""}`;
  }
  return null;
}

const TASKSPACE_WIDTH_STORAGE_KEY = "agenticx:taskspace-panel-width";
const SPAWNS_WIDTH_STORAGE_KEY = "agenticx:spawns-column-width";
const TEXT_ATTACHMENT_LIMIT = 32000;

type AttachedFileStatus = "parsing" | "ready" | "error";

type AttachedFile = {
  name: string;
  size: number;
  mimeType: string;
  status: AttachedFileStatus;
  content: string;
  dataUrl?: string;
  errorText?: string;
  sourcePath?: string;
  referenceToken?: boolean;
};

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function isLikelyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const lower = file.name.toLowerCase();
  return [
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".sh",
    ".bash",
    ".toml",
    ".xml",
    ".csv",
    ".sql",
  ].some((ext) => lower.endsWith(ext));
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

/** Match composer attachment to parsed contextFiles row for /api/chat context_files body. */
function resolveReadyAttachment(
  file: MessageAttachment,
  readyTuples: [string, AttachedFile][]
): AttachedFile | undefined {
  const byAlias = new Map<string, AttachedFile>();
  for (const [stateKey, rec] of readyTuples) {
    byAlias.set(stateKey, rec);
    const sp = String(rec.sourcePath || "").trim();
    if (sp) byAlias.set(sp, rec);
    const nm = String(rec.name || "").trim();
    if (nm) byAlias.set(nm, rec);
  }
  const keys = [file.sourcePath, file.name].map((k) => String(k || "").trim()).filter(Boolean);
  for (const k of keys) {
    const hit = byAlias.get(k);
    if (hit) return hit;
  }
  for (const [, rec] of readyTuples) {
    if (file.sourcePath && rec.sourcePath === file.sourcePath) return rec;
    if (file.name && rec.name === file.name && file.size === rec.size) return rec;
  }
  for (const [, rec] of readyTuples) {
    if (file.name && rec.name === file.name) return rec;
  }
  return undefined;
}

type AtCandidate =
  | {
      kind: "avatar";
      avatarId: string;
      label: string;
      role: string;
      avatarUrl?: string;
    }
  | {
      kind: "file";
      taskspaceId: string;
      path: string;
      label: string;
    }
  | {
      kind: "taskspace";
      taskspaceId: string;
      path: string;
      label: string;
      alias: string;
    };

const MEMBER_PALETTE = [
  "bg-cyan-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-fuchsia-600",
];

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function memberColorClass(id: string): string {
  let h = 0;
  for (const ch of id) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return MEMBER_PALETTE[Math.abs(h) % MEMBER_PALETTE.length];
}

const GroupMembersSidePanel = memo(function GroupMembersSidePanel({
  groupId,
  avatarList,
  metaLeaderLabel,
  onClose,
}: {
  groupId: string;
  avatarList: Avatar[];
  /** Meta-Agent pane title; shown as group coordinator in member grid. */
  metaLeaderLabel: string;
  onClose?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"browse" | "add" | "remove">("browse");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const group = groups.find((g) => g.id === groupId);

  useEffect(() => {
    if (!panelRef.current) return;
    const target = panelRef.current;
    const update = () => setPanelWidth(target.clientWidth);
    const { schedule, cancel } = createResizeRafScheduler(update);
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, []);

  const avatarById = useMemo(() => {
    const map = new Map<string, Avatar>();
    for (const item of avatarList) map.set(item.id, item);
    return map;
  }, [avatarList]);

  const showMetaAgent = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const label = metaLeaderLabel.trim().toLowerCase();
    return (
      "meta-agent".includes(q) ||
      "meta agent".includes(q) ||
      "元智能体".includes(q) ||
      "组长".includes(q) ||
      (label.length > 0 && label.includes(q))
    );
  }, [search, metaLeaderLabel]);

  const filteredIds = useMemo(() => {
    if (!group) return [];
    const q = search.trim().toLowerCase();
    if (!q) return group.avatarIds;
    return group.avatarIds.filter((id) => {
      const a = avatarById.get(id);
      const name = (a?.name ?? id).toLowerCase();
      const role = (a?.role ?? "").toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [group, avatarById, search]);

  const addCandidates = useMemo(() => {
    if (!group) return [];
    const selected = new Set(group.avatarIds);
    const q = search.trim().toLowerCase();
    return avatarList.filter((a) => {
      if (selected.has(a.id)) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
    });
  }, [group, avatarList, search]);

  const memberGrid = useMemo(() => {
    const width = panelWidth || 320;
    const columns = width <= 250 ? 2 : width <= 360 ? 3 : 4;
    const avatarSize = width <= 250 ? 38 : width <= 360 ? 44 : 48;
    const nameClass = width <= 250 ? "text-[10px]" : "text-[11px]";
    return { columns, avatarSize, nameClass };
  }, [panelWidth]);

  const [dialogChecked, setDialogChecked] = useState<Set<string>>(new Set());
  const [dialogSearch, setDialogSearch] = useState("");

  const dialogCandidates = useMemo(() => {
    if (mode !== "add" || !group) return [];
    const existing = new Set(group.avatarIds);
    const q = dialogSearch.trim().toLowerCase();
    return avatarList.filter((a) => {
      if (existing.has(a.id)) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
    });
  }, [mode, group, avatarList, dialogSearch]);

  if (!group) {
    return (
      <div ref={panelRef} className="flex h-full flex-col bg-surface-card p-3">
        <p className="text-xs text-text-faint">未找到该群配置，可在侧栏刷新群列表后重试。</p>
      </div>
    );
  }

  const persistMembers = async (nextAvatarIds: string[]) => {
    if (!group || saving) return;
    setSaving(true);
    setErrorText("");
    const prevAvatarIds = group.avatarIds;
    setGroups(
      groups.map((item) => (item.id === group.id ? { ...item, avatarIds: nextAvatarIds } : item))
    );
    try {
      const res = await window.agenticxDesktop.updateGroup({
        id: group.id,
        avatar_ids: nextAvatarIds,
      });
      if (!res.ok) {
        throw new Error(res.error || "更新群成员失败");
      }
    } catch (err) {
      setGroups(
        groups.map((item) => (item.id === group.id ? { ...item, avatarIds: prevAvatarIds } : item))
      );
      setErrorText(err instanceof Error ? err.message : "更新群成员失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = (avatarId: string) => {
    if (!group || group.avatarIds.includes(avatarId)) return;
    void persistMembers([...group.avatarIds, avatarId]);
  };

  const handleRemoveMember = (avatarId: string) => {
    if (!group || !group.avatarIds.includes(avatarId)) return;
    void persistMembers(group.avatarIds.filter((id) => id !== avatarId));
  };

  const openAddDialog = () => {
    setDialogChecked(new Set());
    setDialogSearch("");
    setMode("add");
  };

  const handleDialogConfirm = () => {
    if (!group || dialogChecked.size === 0) return;
    void persistMembers([...group.avatarIds, ...Array.from(dialogChecked)]);
    setMode("browse");
  };

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-card">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索群成员"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
          />
          {onClose && (
            <button
              type="button"
              className="shrink-0 rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
              onClick={onClose}
              title="关闭成员面板"
            >
              <PanelRightClose className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          )}
        </div>
        {errorText ? <p className="text-[10px] text-rose-300">{errorText}</p> : null}
        {mode === "remove" ? (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-rose-300">点击成员头像移出群聊</span>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setMode("browse")}
            >
              完成
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {filteredIds.length === 0 && !showMetaAgent && search.trim() ? (
          <p className="p-3 text-xs text-text-faint">无匹配成员，换个关键词试试。</p>
        ) : (
          <div
            className="grid gap-x-1 gap-y-3 px-2 py-3"
            style={{ gridTemplateColumns: `repeat(${memberGrid.columns}, minmax(0, 1fr))` }}
          >
            {/* Meta-Agent: 固定首位、不可移除 */}
            {showMetaAgent ? (
              <div className="relative flex flex-col items-center gap-1.5 rounded-lg text-center">
                <div
                  className="flex shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-[10px] font-bold leading-tight text-white"
                  style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                >
                  {memberInitials(metaLeaderLabel)}
                </div>
                <span
                  className={`w-full truncate px-0.5 text-text-muted ${memberGrid.nameClass}`}
                  title={`${metaLeaderLabel} · 群聊协调者`}
                >
                  {metaLeaderLabel}
                </span>
              </div>
            ) : null}
            {filteredIds.map((id) => {
              const a = avatarById.get(id);
              const label = a?.name ?? id.slice(0, 6);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (mode === "remove") handleRemoveMember(id);
                  }}
                  disabled={saving}
                  className={`relative flex flex-col items-center gap-1.5 rounded-lg text-center transition ${
                    mode === "remove" ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                  } disabled:opacity-60`}
                >
                  {a?.avatarUrl ? (
                    <img
                      src={a.avatarUrl}
                      alt=""
                      className="shrink-0 rounded-xl object-cover"
                      style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    />
                  ) : (
                    <div
                      className={`flex shrink-0 items-center justify-center rounded-xl font-bold text-white ${memberColorClass(id)}`}
                      style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    >
                      {memberInitials(label)}
                    </div>
                  )}
                  <span className={`w-full truncate px-0.5 text-text-muted ${memberGrid.nameClass}`} title={`${label}${a?.role ? ` · ${a.role}` : ""}\n${id}`}>
                    {label}
                  </span>
                  {mode === "remove" ? (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold leading-none text-white shadow">−</span>
                  ) : null}
                </button>
              );
            })}
            {/* ── 微信风格: 添加 / 移出 两个虚线方块 ── */}
            {!search.trim() ? (
              <>
                <div className="relative flex flex-col items-center gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={openAddDialog}
                    disabled={saving}
                    className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-2xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
                    style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    title="添加成员"
                  >
                    +
                  </button>
                  <span className={`text-text-muted ${memberGrid.nameClass}`}>添加</span>
                </div>
                <div className="relative flex flex-col items-center gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => setMode((prev) => (prev === "remove" ? "browse" : "remove"))}
                    disabled={saving || group.avatarIds.length === 0}
                    className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-2xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
                    style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    title="移出成员"
                  >
                    −
                  </button>
                  <span className={`text-text-muted ${memberGrid.nameClass}`}>移出</span>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── 添加成员 模态对话框（微信风格） ── */}
      {mode === "add" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMode("browse")}>
          <div
            className="flex h-[480px] w-[520px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-text-strong">添加群成员</span>
              <span className="text-xs text-text-faint">
                {dialogChecked.size > 0 ? `已选 ${dialogChecked.size} 人` : ""}
              </span>
            </div>

            {/* 主体区域：左列表 + 右已选 */}
            <div className="flex min-h-0 flex-1">
              {/* 左侧：搜索 + 可选列表 */}
              <div className="flex min-h-0 flex-1 flex-col border-r border-border">
                <div className="shrink-0 px-3 py-2">
                  <input
                    type="search"
                    value={dialogSearch}
                    onChange={(e) => setDialogSearch(e.target.value)}
                    placeholder="搜索"
                    autoFocus
                    className="w-full rounded-lg border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                  {dialogCandidates.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-text-faint">
                      {dialogSearch.trim() ? "无匹配结果" : "所有分身都已在群里"}
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {dialogCandidates.map((a) => {
                        const checked = dialogChecked.has(a.id);
                        return (
                          <label
                            key={a.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition hover:bg-surface-hover"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setDialogChecked((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(a.id)) next.delete(a.id);
                                  else next.add(a.id);
                                  return next;
                                });
                              }}
                              className="h-4 w-4 shrink-0 accent-cyan-500"
                            />
                            {a.avatarUrl ? (
                              <img src={a.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                            ) : (
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${memberColorClass(a.id)}`}>
                                {memberInitials(a.name || a.id)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs text-text-primary">{a.name || a.id}</div>
                              {a.role ? <div className="truncate text-[10px] text-text-faint">{a.role}</div> : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：已选预览 */}
              <div className="flex w-[160px] shrink-0 flex-col bg-surface-card">
                <div className="shrink-0 px-3 py-2">
                  <span className="text-[11px] text-text-faint">已选成员</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2">
                  {dialogChecked.size === 0 ? (
                    <p className="px-1 text-[11px] text-text-faint">勾选左侧分身</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {Array.from(dialogChecked).map((id) => {
                        const a = avatarById.get(id);
                        const label = a?.name ?? id.slice(0, 6);
                        return (
                          <div key={id} className="flex items-center gap-2 rounded-md px-1 py-1">
                            {a?.avatarUrl ? (
                              <img src={a.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
                            ) : (
                              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${memberColorClass(id)}`}>
                                {memberInitials(label)}
                              </div>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{label}</span>
                            <button
                              type="button"
                              className="shrink-0 text-xs text-text-faint transition hover:text-rose-400"
                              onClick={() => setDialogChecked((prev) => { const n = new Set(prev); n.delete(id); return n; })}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => setMode("browse")}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
                disabled={dialogChecked.size === 0 || saving}
                onClick={handleDialogConfirm}
              >
                添加{dialogChecked.size > 0 ? ` (${dialogChecked.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

export function ChatPane({ paneId, focused, onFocus, onOpenConfirm }: Props) {
  const pane = useAppStore((s) => s.panes.find((item) => item.id === paneId) ?? FALLBACK_PANE);
  const paneSortableListeners = usePaneSortableHandle();
  const panes = useAppStore((s) => s.panes);
  const metaLeaderDisplayName = useMemo(() => {
    const mp = panes.find((p) => p.avatarId === null);
    const t = (mp?.avatarName ?? "").trim();
    return t && t !== "分身" ? t : "Machi";
  }, [panes]);
  const removePane = useAppStore((s) => s.removePane);
  const closePaneAndCleanupEmptySession = () => {
    void (async () => {
      const sid = String(pane.sessionId ?? "").trim();
      const hasUser = pane.messages.some(
        (m) => m.role === "user" && String(m.content ?? "").trim().length > 0,
      );
      if (sid && !hasUser && typeof window.agenticxDesktop?.deleteSession === "function") {
        try {
          await window.agenticxDesktop.deleteSession(sid);
        } catch {
          /* ignore */
        }
      }
      removePane(pane.id);
    })();
  };
  const addPane = useAppStore((s) => s.addPane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const togglePaneHistory = useAppStore((s) => s.togglePaneHistory);
  const cycleSidePanel = useAppStore((s) => s.cycleSidePanel);
  const openSidePanel = useAppStore((s) => s.openSidePanel);
  const addPaneTerminalTab = useAppStore((s) => s.addPaneTerminalTab);
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);
  const addPaneMessage = useAppStore((s) => s.addPaneMessage);
  const updatePaneMessageByToolCallId = useAppStore((s) => s.updatePaneMessageByToolCallId);
  const clearPaneMessages = useAppStore((s) => s.clearPaneMessages);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneContextInherited = useAppStore((s) => s.setPaneContextInherited);
  const queuedMessages = useAppStore((s) => s.pendingMessages[paneId] ?? EMPTY_QUEUE);
  const removePendingMessage = useAppStore((s) => s.removePendingMessage);
  const editPendingMessage = useAppStore((s) => s.editPendingMessage);
  const setSpawnsColumnOpen = useAppStore((s) => s.setSpawnsColumnOpen);
  const dismissSpawnsColumn = useAppStore((s) => s.dismissSpawnsColumn);
  const clearSpawnsColumnSuppress = useAppStore((s) => s.clearSpawnsColumnSuppress);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const storeActiveProvider = useAppStore((s) => s.activeProvider);
  const storeActiveModel = useAppStore((s) => s.activeModel);
  const { chatProvider, chatModel } = useMemo(() => {
    const pp = (pane?.modelProvider ?? "").trim();
    const pm = (pane?.modelName ?? "").trim();
    if (pp && pm) return { chatProvider: pp, chatModel: pm };
    return { chatProvider: storeActiveProvider, chatModel: storeActiveModel };
  }, [pane?.modelProvider, pane?.modelName, storeActiveProvider, storeActiveModel]);
  const selectedSubAgent = useAppStore((s) => s.selectedSubAgent);
  const setSelectedSubAgent = useAppStore((s) => s.setSelectedSubAgent);
  const addSubAgent = useAppStore((s) => s.addSubAgent);
  const updateSubAgent = useAppStore((s) => s.updateSubAgent);
  const addSubAgentEvent = useAppStore((s) => s.addSubAgentEvent);
  const subAgents = useAppStore((s) => s.subAgents);
  const avatars = useAppStore((s) => s.avatars);
  const groups = useAppStore((s) => s.groups);
  const metaAvatarUrl = useAppStore((s) => s.metaAvatarUrl);
  const userAvatarUrl = useAppStore((s) => s.userAvatarUrl);
  const chatStyle = useAppStore((s) => s.chatStyle);
  const userNickname = useAppStore((s) => s.userNickname);
  const userPreference = useAppStore((s) => s.userPreference);
  const focusMode = useAppStore((s) => s.focusMode);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);
  const userBubbleLabel = useMemo(() => userNickname.trim() || "我", [userNickname]);
  const isGroupPane = Boolean(pane?.avatarId?.startsWith("group:"));
  /** 元智能体窗格：顶栏已展示当前模型，气泡内不再重复展示模型徽章 */
  const isMachiMetaPane = pane.avatarId === null;
  const isAutomationTaskPane = isAutomationPaneAvatarId(pane?.avatarId);
  const groupChatId = isGroupPane && pane?.avatarId ? pane.avatarId.slice("group:".length) : "";
  const activeGroup = useMemo(
    () => (isGroupPane ? groups.find((g) => g.id === groupChatId) : undefined),
    [groups, isGroupPane, groupChatId]
  );
  const groupMembers = useMemo(
    () =>
      (activeGroup?.avatarIds ?? [])
        .map((id) => avatars.find((a) => a.id === id))
        .filter((a): a is Avatar => Boolean(a)),
    [activeGroup, avatars]
  );
  const workspacePanelOpen = !!pane?.taskspacePanelOpen;

  const paneAvatarMeta = useMemo(() => {
    const aid = pane?.avatarId;
    if (!aid) {
      // avatarId 为空即为 Machi 窗格；勿依赖 avatarName===「Machi」才给 meta 头像（飞书绑定曾错误写入「分身」）
      const paneName = (pane?.avatarName ?? "").trim();
      const name = paneName && paneName !== "分身" ? paneName : "Machi";
      return { name, url: metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL };
    }
    if (aid.startsWith("group:")) return { name: pane?.avatarName || "AI", url: undefined };
    const found = avatars.find((a) => a.id === aid);
    return {
      name: found?.name || pane?.avatarName || "AI",
      url: found?.avatarUrl || undefined,
    };
  }, [pane?.avatarId, pane?.avatarName, avatars, metaAvatarUrl]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [streamedAssistantText, setStreamedAssistantText] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [runGuardSessionId, setRunGuardSessionId] = useState("");
  const [streamingModel, setStreamingModel] = useState<{ provider: string; model: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionAbortControllersRef = useRef<Record<string, AbortController>>({});
  const sessionStreamStateRef = useRef<
    Record<string, { active: boolean; text: string; provider: string; model: string }>
  >({});
  const streamTextRef = useRef("");
  const streamCommittedRef = useRef(false);
  /** Text last committed at a tool_call boundary; avoids duplicating the same assistant bubble at stream end. */
  const lastMidStreamAssistantCommitRef = useRef<string | null>(null);
  const [stallState, setStallState] = useState<"none" | "stall" | "exhausted">("none");
  const [exhaustedRounds, setExhaustedRounds] = useState<{ rounds: number; maxRounds: number } | null>(null);
  const lastSseEventAtRef = useRef(0);
  const deferredSessionMessagesRef = useRef<Record<string, Array<Parameters<typeof addPaneMessage>>>>({});
  const streamRafRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollPinnedRef = useRef(true);
  const imeComposingRef = useRef(false);
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atCandidates, setAtCandidates] = useState<AtCandidate[]>([]);
  const [groupTyping, setGroupTyping] = useState<Record<string, string>>({});
  const lastGroupProgressRef = useRef<Record<string, string>>({});
  const [quoteTarget, setQuoteTarget] = useState<{ message: Message; body: string } | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [pendingForwardMessages, setPendingForwardMessages] = useState<
    Array<{ sender: string; role: string; content: string; avatar_url?: string; timestamp?: number }>
  >([]);
  const [contextFiles, setContextFiles] = useState<Record<string, AttachedFile>>({});
  const [attachToastOpen, setAttachToastOpen] = useState(false);
  const [favoriteToastOpen, setFavoriteToastOpen] = useState(false);
  const [favoriteToastMsg, setFavoriteToastMsg] = useState("");
  const [feishuDesktopBound, setFeishuDesktopBound] = useState(false);
  const boundSessionIdRef = useRef<{ feishu: string; wechat: string }>({ feishu: "", wechat: "" });
  const ccBridgeVisibleLaunchGuardRef = useRef<Map<string, number>>(new Map());
  const ccBridgeTailGuardRef = useRef<Map<string, number>>(new Map());
  /** Last resolved bridge session mode (cc_bridge_start), not global Settings radio. */
  const ccBridgeLastSessionModeRef = useRef<CcBridgeSessionModeHint>("");
  const [wechatDesktopBound, setWechatDesktopBound] = useState(false);
  const [automationTaskErrorHint, setAutomationTaskErrorHint] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  useEffect(() => {
    if (!favoriteToastOpen) return;
    const t = window.setTimeout(() => setFavoriteToastOpen(false), 1800);
    return () => window.clearTimeout(t);
  }, [favoriteToastOpen]);
  useEffect(() => {
    ccBridgeLastSessionModeRef.current = "";
  }, [pane.sessionId]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [taskspaceAutoRefreshKey, setTaskspaceAutoRefreshKey] = useState(0);
  const [taskspaceWidth, setTaskspaceWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(TASKSPACE_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore storage access failures
    }
    return 340;
  });
  const [spawnsWidth, setSpawnsWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SPAWNS_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore storage access failures
    }
    return 300;
  });
  const [historyWidth, setHistoryWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem("agx-history-width-v1");
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore
    }
    return 220;
  });
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  const visibleMessages = useMemo(
    () =>
      (pane?.messages ?? []).filter((item) => {
        if (isGroupPane) return true;
        if (item.role === "assistant" && isThinkingPlaceholderText(item.content || "")) return false;
        return !item.agentId || item.agentId === "meta";
      }),
    [isGroupPane, pane?.messages]
  );
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveToolMessages(visibleMessages),
    [visibleMessages]
  );
  const isStreamingCurrentSession =
    streaming &&
    !isGroupPane &&
    !!streamingSessionId &&
    streamingSessionId === (pane.sessionId || "").trim();
  const streamTextForCurrentSession = isStreamingCurrentSession ? (streamedAssistantText || "") : "";
  /** Mid-turn commit can persist assistant text while SSE keeps streaming the same body — hide __stream__ so we don't show two identical bubbles (store still has correct count). */
  const hideStreamOverlayAsDuplicate = useMemo(() => {
    if (!isStreamingCurrentSession) return false;
    const t = streamTextForCurrentSession.trim();
    if (!t) return false;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === "user") break;
      if (m.role === "assistant" && (!m.agentId || m.agentId === "meta")) {
        return String(m.content ?? "").trim() === t;
      }
    }
    return false;
  }, [isStreamingCurrentSession, streamTextForCurrentSession, visibleMessages]);
  const useReActImLayout = !isGroupPane && chatStyle === "im";
  const visibleMessagesWithStream = useMemo(() => {
    if (useReActImLayout && isStreamingCurrentSession && !hideStreamOverlayAsDuplicate) {
      return [
        ...visibleMessages,
        {
          id: "__stream__",
          role: "assistant",
          content: streamTextForCurrentSession,
          provider: streamingModel?.provider,
          model: streamingModel?.model,
        } as Message,
      ];
    }
    return visibleMessages;
  }, [
    useReActImLayout,
    visibleMessages,
    isStreamingCurrentSession,
    hideStreamOverlayAsDuplicate,
    streamTextForCurrentSession,
    streamingModel,
  ]);

  const topLevelRowsIm = useMemo(
    () => (useReActImLayout ? expandMessagesToTopLevelRows(visibleMessagesWithStream) : null),
    [useReActImLayout, visibleMessagesWithStream]
  );
  const focusComposerOnly = focusMode && visibleMessages.length === 0;

  useEffect(() => {
    if (!isAutomationTaskPane || !pane?.avatarId?.startsWith("automation:")) {
      setAutomationTaskErrorHint(null);
      return;
    }
    if (visibleMessages.length > 0) {
      setAutomationTaskErrorHint(null);
      return;
    }
    const taskId = pane.avatarId.slice("automation:".length);
    let cancelled = false;
    const loadErr = async () => {
      try {
        const r = await window.agenticxDesktop.loadAutomationTasks();
        if (!r?.ok || cancelled) return;
        const list = Array.isArray(r.tasks) ? (r.tasks as AutomationTask[]) : [];
        const task = list.find((t) => t.id === taskId);
        if (cancelled) return;
        if (task?.lastRunStatus === "error" && task.lastRunError) {
          setAutomationTaskErrorHint(task.lastRunError);
        } else {
          setAutomationTaskErrorHint(null);
        }
      } catch {
        if (!cancelled) setAutomationTaskErrorHint(null);
      }
    };
    void loadErr();
    const timer = window.setInterval(loadErr, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAutomationTaskPane, pane?.avatarId, visibleMessages.length]);

  const paneSubAgents = useMemo(() => {
    const sid = (pane?.sessionId ?? "").trim();
    if (!sid) return [];
    return subAgents.filter((item) => (item.sessionId ?? "").trim() === sid);
  }, [pane?.sessionId, subAgents]);
  const paneSubAgentIdsKey = useMemo(
    () =>
      paneSubAgents
        .map((s) => s.id)
        .sort()
        .join("\0"),
    [paneSubAgents]
  );
  const primaryPaneForSessionId = useMemo(() => {
    const sid = (pane?.sessionId ?? "").trim();
    if (!sid) return null;
    return panes.find((p) => p.sessionId === sid)?.id ?? null;
  }, [panes, pane?.sessionId]);
  const shouldShowBoundFeishuBadge =
    feishuDesktopBound && primaryPaneForSessionId === pane.id && !isAutomationTaskPane;
  const shouldShowFeishuBadge = shouldShowBoundFeishuBadge;
  const shouldShowWechatBadge =
    wechatDesktopBound && primaryPaneForSessionId === pane.id && !isAutomationTaskPane;

  useEffect(() => {
    if (focusMode) return;
    if (paneSubAgents.length === 0) {
      if (pane.spawnsColumnOpen) setSpawnsColumnOpen(pane.id, false);
      return;
    }
    const baseline = new Set(pane.spawnsColumnBaselineIds ?? []);
    if (pane.spawnsColumnSuppressAuto) {
      const hasNew = paneSubAgents.some((s) => !baseline.has(s.id));
      if (hasNew) {
        clearSpawnsColumnSuppress(pane.id);
        setSpawnsColumnOpen(pane.id, true);
      }
      return;
    }
    if (!pane.spawnsColumnOpen) {
      setSpawnsColumnOpen(pane.id, true);
    }
  }, [
    pane.id,
    pane.spawnsColumnOpen,
    pane.spawnsColumnSuppressAuto,
    pane.spawnsColumnBaselineIds,
    paneSubAgentIdsKey,
    paneSubAgents.length,
    focusMode,
    clearSpawnsColumnSuppress,
    setSpawnsColumnOpen,
  ]);
  const attachmentEntries = useMemo(() => Object.entries(contextFiles), [contextFiles]);
  const visibleAttachmentEntries = useMemo(
    () => attachmentEntries.filter(([, file]) => !file.referenceToken),
    [attachmentEntries]
  );
  const readyAttachments = useMemo(
    () =>
      attachmentEntries
        .filter(([, file]) => file.status === "ready")
        .map(([sourcePath, file]) => ({ ...file, sourcePath: file.sourcePath || sourcePath })),
    [attachmentEntries]
  );

  const hasDelegation = useMemo(() => {
    const fromPaneSubs = paneSubAgents.some(
      (sub) =>
        (sub.status === "running" || sub.status === "pending") &&
        (sub.id.startsWith("dlg-") || sub.events?.some((evt) => evt.type.startsWith("delegation")))
    );
    if (fromPaneSubs) return true;
    const paneName = (pane?.avatarName ?? "").trim().toLowerCase();
    if (!paneName) return false;
    return subAgents.some(
      (sub) =>
        (sub.status === "running" || sub.status === "pending") &&
        sub.id.startsWith("dlg-") &&
        (sub.name ?? "").trim().toLowerCase() === paneName
    );
  }, [paneSubAgents, subAgents, pane?.avatarName]);

  const lastPollCountRef = useRef(0);
  const pollSessionSidRef = useRef<string>("");

  useEffect(() => {
    if (!pane?.sessionId) return;
    const sidNow = pane.sessionId;
    if (sidNow !== pollSessionSidRef.current) {
      pollSessionSidRef.current = sidNow;
      lastPollCountRef.current = 0;
    }
    let active = true;
    let timer: number | undefined;

    const isFeishuBoundSession = async (sid: string): Promise<boolean> => {
      try {
        const r = await window.agenticxDesktop.loadFeishuBinding();
        if (!r.ok) return false;
        const desk = r.bindings["_desktop"] as { session_id?: string } | undefined;
        return Boolean(desk && desk.session_id === sid);
      } catch {
        return false;
      }
    };

    const isWechatBoundSession = async (sid: string): Promise<boolean> => {
      try {
        const r = await window.agenticxDesktop.loadWechatBinding();
        if (!r.ok) return false;
        const desk = r.bindings["_desktop"] as { session_id?: string } | undefined;
        return Boolean(desk && desk.session_id === sid);
      } catch {
        return false;
      }
    };

    const poll = async () => {
      if (!active) return;
      const currentSid = pane.sessionId;
      if (!currentSid) return;
      const otherPaneHasSameSid = panes.some(
        (p) => p.id !== pane.id && p.sessionId === currentSid
      );
      if (otherPaneHasSameSid) {
        console.warn("[ChatPane] poll skipped — session %s is shared with another pane", currentSid);
        return;
      }
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(currentSid);
        if (!active) return;
        // Session may have changed while the load was in flight (e.g. user
        // clicked "新对话" mid-poll). Never overwrite the new session's pane
        // with messages from the previous session.
        const latestSid = String(
          useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
        ).trim();
        if (latestSid !== currentSid) return;
        if (result.ok && Array.isArray(result.messages) && result.messages.length > 0) {
          if (result.messages.length <= lastPollCountRef.current) return;
          lastPollCountRef.current = result.messages.length;
          const seen = new Set<string>();
          const deduped: Message[] = [];
          for (let idx = 0; idx < result.messages.length; idx++) {
            const item = result.messages[idx];
            const role = String(item.role ?? "");
            const content = String(item.content ?? "").trim();
            const rowAtts = attachmentsFromSessionRow(
              (item as { attachments?: unknown }).attachments
            );
            if (!content && !rowAtts?.length) continue;
            const attSig =
              rowAtts?.length && rowAtts[0]?.dataUrl
                ? rowAtts[0].dataUrl.slice(0, 72)
                : "";
            const key = `${role}::${content.slice(0, 300)}::${attSig}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(mapLoadedSessionMessage(item as LoadedSessionMessage, `dlgpoll-${currentSid}`, idx));
          }
          setPaneMessages(pane.id, deduped);
        }
      } catch {
        // ignore polling failures
      }
    };

    const setup = async () => {
      if (!active) return;
      const sid = pane.sessionId;
      if (!sid) return;
      const isImSession = sid.startsWith("im-");
      const isFeishuBound = await isFeishuBoundSession(sid);
      const isWechatBound = await isWechatBoundSession(sid);
      if (!active) return;
      const needsExternalPoll = isImSession || isFeishuBound || isWechatBound;
      if (!hasDelegation && !needsExternalPoll && (pane.messages?.length ?? 0) > 0) return;
      void poll();
      if (!hasDelegation && !needsExternalPoll) return;
      timer = window.setInterval(() => void poll(), 3000);
    };

    void setup();
    return () => {
      active = false;
      if (timer != null) window.clearInterval(timer);
    };
  }, [
    hasDelegation,
    feishuDesktopBound,
    wechatDesktopBound,
    pane?.sessionId,
    pane?.id,
    pane?.messages?.length,
    panes,
    setPaneMessages,
  ]);

  useEffect(() => {
    if (isGroupPane || !pane?.sessionId || isAutomationTaskPane) {
      boundSessionIdRef.current.feishu = "";
      boundSessionIdRef.current.wechat = "";
      setFeishuDesktopBound(false);
      setWechatDesktopBound(false);
      return;
    }
    let cancelled = false;
    const sid = pane.sessionId;

    const checkBound = async () => {
      if (cancelled) return;
      try {
        const r = await window.agenticxDesktop.loadFeishuBinding();
        if (cancelled) return;
        if (r.ok) {
          const desk = r.bindings["_desktop"] as { session_id?: string } | undefined;
          const boundSid = typeof desk?.session_id === "string" ? desk.session_id.trim() : "";
          boundSessionIdRef.current.feishu = boundSid;
          setFeishuDesktopBound(
            Boolean(boundSid && boundSid === sid)
          );
        } else {
          boundSessionIdRef.current.feishu = "";
          setFeishuDesktopBound(false);
        }
      } catch {
        if (!cancelled) {
          boundSessionIdRef.current.feishu = "";
          setFeishuDesktopBound(false);
        }
      }
      try {
        const rw = await window.agenticxDesktop.loadWechatBinding();
        if (cancelled) return;
        if (rw.ok) {
          const deskW = rw.bindings["_desktop"] as { session_id?: string } | undefined;
          const boundSidW = typeof deskW?.session_id === "string" ? deskW.session_id.trim() : "";
          boundSessionIdRef.current.wechat = boundSidW;
          setWechatDesktopBound(
            Boolean(boundSidW && boundSidW === sid)
          );
        } else if (!cancelled) {
          boundSessionIdRef.current.wechat = "";
          setWechatDesktopBound(false);
        }
      } catch {
        boundSessionIdRef.current.wechat = "";
        if (!cancelled) setWechatDesktopBound(false);
      }
    };

    void checkBound();
    const timer = window.setInterval(() => void checkBound(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isGroupPane, isAutomationTaskPane, pane?.sessionId]);

  const bindingModelSyncRef = useRef<{ feishu: string; wechat: string }>({ feishu: "", wechat: "" });
  useEffect(() => {
    if (isGroupPane || isAutomationTaskPane || !pane?.sessionId) return;
    const currentSid = (pane.sessionId || "").trim();
    const provider = (pane.modelProvider || "").trim();
    const model = (pane.modelName || "").trim();
    const signature = `${pane.sessionId}::${provider}::${model}`;
    const aid = pane.avatarId?.startsWith("group:") ? null : pane.avatarId || null;
    const isFeishuBoundToCurrentSession =
      feishuDesktopBound && boundSessionIdRef.current.feishu === currentSid;
    if (isFeishuBoundToCurrentSession && bindingModelSyncRef.current.feishu !== signature) {
      bindingModelSyncRef.current.feishu = signature;
      void window.agenticxDesktop.saveFeishuDesktopBinding({
        sessionId: pane.sessionId,
        avatarId: aid,
        avatarName: pane.avatarName || null,
        provider: provider || null,
        model: model || null,
      });
    }
    const isWechatBoundToCurrentSession =
      wechatDesktopBound && boundSessionIdRef.current.wechat === currentSid;
    if (isWechatBoundToCurrentSession && bindingModelSyncRef.current.wechat !== signature) {
      bindingModelSyncRef.current.wechat = signature;
      void window.agenticxDesktop.saveWechatDesktopBinding({
        sessionId: pane.sessionId,
        avatarId: aid,
        avatarName: pane.avatarName || null,
        provider: provider || null,
        model: model || null,
      });
    }
    if (!feishuDesktopBound) bindingModelSyncRef.current.feishu = "";
    if (!wechatDesktopBound) bindingModelSyncRef.current.wechat = "";
  }, [
    feishuDesktopBound,
    wechatDesktopBound,
    isAutomationTaskPane,
    isGroupPane,
    pane?.sessionId,
    pane?.avatarId,
    pane?.avatarName,
    pane?.modelProvider,
    pane?.modelName,
  ]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const updatePinned = () => {
      autoScrollPinnedRef.current = isNearBottom(el);
    };
    updatePinned();
    el.addEventListener("scroll", updatePinned, { passive: true });
    return () => el.removeEventListener("scroll", updatePinned);
  }, [paneId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current && autoScrollPinnedRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  }, [visibleMessages, streamedAssistantText]);

  const highlightJumpKeyRef = useRef<string>("");
  useEffect(() => {
    const terms = (pane.historySearchTerms ?? []).filter((t) => String(t || "").trim().length > 0);
    if (!pane.sessionId || terms.length === 0) {
      highlightJumpKeyRef.current = "";
      return;
    }
    const key = `${pane.sessionId}::${terms.join("|")}::${visibleMessages.length}`;
    if (highlightJumpKeyRef.current === key) return;
    let cancelled = false;
    const run = (attempt = 0) => {
      if (cancelled) return;
      const root = listRef.current;
      if (!root) return;
      const first = root.querySelector(".agx-keyword-highlight") as HTMLElement | null;
      if (first) {
        highlightJumpKeyRef.current = key;
        first.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        return;
      }
      if (attempt < 3) {
        window.setTimeout(() => run(attempt + 1), 90);
      }
    };
    requestAnimationFrame(() => {
      window.setTimeout(() => run(0), 20);
    });
    return () => {
      cancelled = true;
    };
  }, [pane.sessionId, pane.historySearchTerms, visibleMessages.length]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  useEffect(() => {
    if (!paneRef.current) return;
    const target = paneRef.current;
    const update = () => setPaneWidth(target.clientWidth);
    const { schedule, cancel } = createResizeRafScheduler(update);
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, []);

  const openDelegatedAvatarSession = async (agentId: string): Promise<boolean> => {
    const sub = useAppStore.getState().subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? "").trim();
    if (!targetSessionId) return false;

    const targetName = String(sub?.name ?? "").trim();
    const existingPane = panes.find((item) => {
      if (!item.avatarId || item.avatarId.startsWith("group:")) return false;
      const found = avatars.find((avatar) => avatar.id === item.avatarId);
      return !!found && found.name === targetName;
    });
    const targetPaneId = existingPane?.id ?? addPane(null, targetName || "Avatar", targetSessionId);
    setPaneSessionId(targetPaneId, targetSessionId);
    setActivePaneId(targetPaneId);
    setSelectedSubAgent(null);

    try {
      const result = await window.agenticxDesktop.loadSessionMessages(targetSessionId);
      if (result.ok && Array.isArray(result.messages)) {
        const mapped: Message[] = result.messages.map((item, index) =>
          mapLoadedSessionMessage(item as LoadedSessionMessage, targetSessionId, index)
        );
        setPaneMessages(targetPaneId, mapped);
      } else {
        setPaneMessages(targetPaneId, []);
      }
    } catch {
      setPaneMessages(targetPaneId, []);
    }
    return true;
  };

  const cancelStreamRenderFrame = () => {
    if (streamRafRef.current !== null) {
      window.cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
  };

  const searchAtCandidates = async (queryText: string) => {
    const lowered = queryText.trim().toLowerCase();
    const avatarCandidates: AtCandidate[] = isGroupPane
      ? groupMembers
          .filter((a) => !lowered || a.name.toLowerCase().includes(lowered) || a.role.toLowerCase().includes(lowered))
          .map((a) => ({
            kind: "avatar" as const,
            avatarId: a.id,
            label: a.name,
            role: a.role,
            avatarUrl: a.avatarUrl || undefined,
          }))
      : [];

    if (!pane.sessionId) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const wsResp = await window.agenticxDesktop.listTaskspaces(pane.sessionId);
    if (!wsResp.ok || !Array.isArray(wsResp.workspaces) || wsResp.workspaces.length === 0) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const activeId = pane.activeTaskspaceId && wsResp.workspaces.some((item) => item.id === pane.activeTaskspaceId)
      ? pane.activeTaskspaceId
      : wsResp.workspaces[0].id;
    if (!pane.activeTaskspaceId) setActiveTaskspace(pane.id, activeId);
    const rootResp = await window.agenticxDesktop.listTaskspaceFiles({
      sessionId: pane.sessionId,
      taskspaceId: activeId,
      path: ".",
    });
    if (!rootResp.ok || !Array.isArray(rootResp.files)) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const flatRows: Extract<AtCandidate, { kind: "file" }>[] = [];
    const folderRows: Extract<AtCandidate, { kind: "taskspace" }>[] = wsResp.workspaces.map((item) => ({
      kind: "taskspace",
      taskspaceId: item.id,
      path: item.path,
      label: item.label || item.path.split("/").filter(Boolean).pop() || "taskspace",
      alias: item.label || item.path.split("/").filter(Boolean).pop() || "taskspace",
    }));
    const queue: string[] = ["."];
    const visited = new Set<string>();
    while (queue.length > 0 && flatRows.length < 200) {
      const current = queue.shift() || ".";
      if (visited.has(current)) continue;
      visited.add(current);
      const listResp =
        current === "."
          ? rootResp
          : await window.agenticxDesktop.listTaskspaceFiles({
              sessionId: pane.sessionId,
              taskspaceId: activeId,
              path: current,
            });
      if (!listResp.ok || !Array.isArray(listResp.files)) continue;
      for (const row of listResp.files) {
        if (row.type === "file") {
          flatRows.push({ kind: "file", taskspaceId: activeId, path: row.path, label: row.name });
          continue;
        }
        if (row.type === "dir" && !visited.has(row.path) && queue.length < 200) {
          queue.push(row.path);
        }
      }
    }
    const filteredFiles = !lowered
      ? flatRows.slice(0, 20)
      : flatRows.filter((item) => item.path.toLowerCase().includes(lowered)).slice(0, 20);
    const filteredFolders = !lowered
      ? folderRows.slice(0, 8)
      : folderRows
          .filter(
            (item) =>
              item.alias.toLowerCase().includes(lowered) ||
              item.path.toLowerCase().includes(lowered)
          )
          .slice(0, 8);
    setAtCandidates([...avatarCandidates, ...filteredFolders, ...filteredFiles].slice(0, 24));
  };

  const triggerCcBridgeVisibleTerminal = useCallback(
    async (toolCallKey: string) => {
      if (focusMode) return;
      if (!pane.sessionId) return;
      const now = Date.now();
      const last = ccBridgeVisibleLaunchGuardRef.current.get(toolCallKey) ?? 0;
      if (now - last < 20_000) return;
      ccBridgeVisibleLaunchGuardRef.current.set(toolCallKey, now);
      // Keep guard map bounded.
      if (ccBridgeVisibleLaunchGuardRef.current.size > 32) {
        const cutoff = now - 120_000;
        for (const [k, ts] of ccBridgeVisibleLaunchGuardRef.current.entries()) {
          if (ts < cutoff) ccBridgeVisibleLaunchGuardRef.current.delete(k);
        }
      }

      const wsResp = await window.agenticxDesktop.listTaskspaces(pane.sessionId);
      if (!wsResp.ok || !Array.isArray(wsResp.workspaces) || wsResp.workspaces.length === 0) return;
      const activeWorkspace =
        (pane.activeTaskspaceId
          ? wsResp.workspaces.find((item) => item.id === pane.activeTaskspaceId)
          : undefined) ?? wsResp.workspaces[0];
      if (!activeWorkspace?.path) return;
      if (!pane.activeTaskspaceId || pane.activeTaskspaceId !== activeWorkspace.id) {
        setActiveTaskspace(pane.id, activeWorkspace.id);
      }

      openSidePanel(pane.id, "workspace");
      addPaneTerminalTab(pane.id, activeWorkspace.path, "cc-bridge");

      let bridgeUrl = "http://127.0.0.1:9742";
      try {
        const headers: Record<string, string> = {};
        if (apiToken) headers["x-agx-desktop-token"] = apiToken;
        const res = await fetch(`${apiBase}/api/cc-bridge/config`, { headers });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        const parsedUrl = typeof data?.url === "string" ? data.url.trim() : "";
        if (parsedUrl) bridgeUrl = parsedUrl;
      } catch {
        // keep fallback URL
      }

      let launchCmd =
        'lsof -nP -iTCP:9742 -sTCP:LISTEN >/dev/null 2>&1 && echo "[cc-bridge] already listening on 127.0.0.1:9742" || agx cc-bridge serve --host 127.0.0.1 --port 9742';
      try {
        const parsed = new URL(bridgeUrl);
        const host = (parsed.hostname || "").trim();
        const lowerHost = host.toLowerCase();
        const loopback = lowerHost === "127.0.0.1" || lowerHost === "localhost" || lowerHost === "::1";
        const parsedPort = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
        const safePort = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 9742;
        if (loopback) {
          launchCmd = [
            `lsof -nP -iTCP:${safePort} -sTCP:LISTEN >/dev/null 2>&1`,
            `&& echo "[cc-bridge] already listening on ${host || "127.0.0.1"}:${safePort}"`,
            `|| agx cc-bridge serve --host ${shellSingleQuote(host || "127.0.0.1")} --port ${safePort}`,
          ].join(" ");
        } else {
          launchCmd = `echo "[cc-bridge] configured remote URL: ${bridgeUrl}. Skip local autostart."`;
        }
      } catch {
        // keep fallback launch command
      }

      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const latestPane = useAppStore.getState().panes.find((item) => item.id === pane.id);
      const terminalTabId = latestPane?.activeTerminalTabId;
      if (!terminalTabId) return;
      for (let i = 0; i < 20; i += 1) {
        const latestPane = useAppStore.getState().panes.find((item) => item.id === pane.id);
        if (!latestPane) return;
        const writeRes = await window.agenticxDesktop.terminalWriteByTab({
          tabId: terminalTabId,
          data: `${launchCmd}\n`,
        });
        if (writeRes?.ok) return;
        await sleep(180);
      }
    },
    [
      pane.id,
      pane.sessionId,
      pane.activeTaskspaceId,
      apiBase,
      apiToken,
      focusMode,
      setActiveTaskspace,
      openSidePanel,
      addPaneTerminalTab,
    ]
  );

  const triggerCcBridgeTailTerminal = useCallback(
    async (sessionId: string) => {
      if (focusMode) return;
      const sid = sessionId.trim();
      if (!/^[0-9a-fA-F-]{36}$/.test(sid) || !pane.sessionId) return;
      const now = Date.now();
      const last = ccBridgeTailGuardRef.current.get(sid) ?? 0;
      if (now - last < 60_000) return;
      ccBridgeTailGuardRef.current.set(sid, now);

      const wsResp = await window.agenticxDesktop.listTaskspaces(pane.sessionId);
      if (!wsResp.ok || !Array.isArray(wsResp.workspaces) || wsResp.workspaces.length === 0) return;
      const activeWorkspace =
        (pane.activeTaskspaceId
          ? wsResp.workspaces.find((item) => item.id === pane.activeTaskspaceId)
          : undefined) ?? wsResp.workspaces[0];
      if (!activeWorkspace?.path) return;
      openSidePanel(pane.id, "workspace");

      let bridgeUrl = "http://127.0.0.1:9742";
      let bridgeToken = "";
      try {
        const headers: Record<string, string> = {};
        if (apiToken) headers["x-agx-desktop-token"] = apiToken;
        const res = await fetch(`${apiBase}/api/cc-bridge/config`, { headers });
        const data = res.ok ? await res.json() : {};
        const u = typeof data?.url === "string" ? data.url.trim() : "";
        if (u) bridgeUrl = u.replace(/\/$/, "");
        bridgeToken = typeof data?.token === "string" ? data.token : "";
      } catch {
        /* use defaults */
      }

      if (bridgeToken) {
        addPaneTerminalTab(pane.id, activeWorkspace.path, "claude-code", {
          sessionId: sid,
          baseUrl: bridgeUrl,
          token: bridgeToken,
        });
        return;
      }

      addPaneTerminalTab(pane.id, activeWorkspace.path, "claude-code");
      const logPath = `$HOME/.agenticx/logs/cc-bridge/${sid}.log`;
      const tailCmd = [
        `LOG_FILE="${logPath}"`,
        `echo "[claude-code] tailing $LOG_FILE"`,
        'if [ ! -f "$LOG_FILE" ]; then echo "[claude-code] waiting for log file..."; fi',
        'while [ ! -f "$LOG_FILE" ]; do sleep 0.5; done',
        'echo "[claude-code] log file detected."',
        'tail -n 200 -f "$LOG_FILE"',
      ].join("; ");

      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const latestPane = useAppStore.getState().panes.find((item) => item.id === pane.id);
      const terminalTabId = latestPane?.activeTerminalTabId;
      if (!terminalTabId) return;
      for (let i = 0; i < 20; i += 1) {
        const writeRes = await window.agenticxDesktop.terminalWriteByTab({
          tabId: terminalTabId,
          data: `${tailCmd}\n`,
        });
        if (writeRes?.ok) return;
        await sleep(180);
      }
    },
    [pane.id, pane.sessionId, pane.activeTaskspaceId, apiBase, apiToken, focusMode, openSidePanel, addPaneTerminalTab]
  );

  const updateAtStateFromText = useCallback(
    (value: string) => {
      const match = value.match(/(?:^|\s)@([^\s@]*)$/);
      if (match) {
        const query = match[1] ?? "";
        setAtOpen(true);
        setAtQuery(query);
        void searchAtCandidates(query);
      } else {
        setAtOpen(false);
        setAtQuery("");
      }
    },
    [searchAtCandidates]
  );

  const extractComposerText = useCallback((): string => {
    const el = composerRef.current;
    if (!el) return "";
    // Keep visual token text clean (without "@"), but serialize it as "@name" for routing.
    const clone = el.cloneNode(true) as HTMLDivElement;
    const tokenNodes = clone.querySelectorAll<HTMLElement>("[data-ref-token='1']");
    for (const node of tokenNodes) {
      const name = String(node.dataset.refName || node.textContent || "").trim();
      node.textContent = name ? `@${name}` : "";
    }
    // Serialize skill tokens as "@skill://name"
    const skillNodes = clone.querySelectorAll<HTMLElement>("[data-skill-token='1']");
    for (const node of skillNodes) {
      const name = String(node.dataset.skillName || "").trim();
      node.textContent = name ? `@skill://${name}` : "";
    }
    return (clone.innerText || "").replace(/\u00a0/g, " ");
  }, []);

  const focusComposerEnd = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const createFileRefToken = useCallback((name: string) => {
    const token = document.createElement("span");
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-ref-token", "1");
    token.setAttribute("data-ref-name", name);
    token.className =
      "agx-composer-inline-chip mx-0.5 inline-flex items-center rounded-md px-1.5 py-0.5 align-baseline text-[12px] font-medium leading-[1.2]";
    token.textContent = name;
    return token;
  }, []);

  const createSkillRefToken = useCallback((name: string) => {
    const token = document.createElement("span");
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-skill-token", "1");
    token.setAttribute("data-skill-name", name);
    token.className =
      "agx-composer-inline-chip mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[12px] font-medium leading-[1.2]";
    // wrench SVG icon + name
    const icon = document.createElement("span");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>';
    token.appendChild(icon);
    const label = document.createElement("span");
    label.textContent = name;
    token.appendChild(label);
    return token;
  }, []);

  const setComposerText = useCallback(
    (value: string, options?: { tokenNames?: string[] }) => {
      const el = composerRef.current;
      if (!el) {
        setInput(value);
        updateAtStateFromText(value);
        return;
      }
      const tokenNames = new Set<string>();
      for (const [, file] of Object.entries(contextFiles)) {
        if (file.referenceToken && file.name) tokenNames.add(file.name);
      }
      for (const name of options?.tokenNames ?? []) {
        if (name) tokenNames.add(name);
      }
      el.innerHTML = "";
      const tokenNamesByLength = Array.from(tokenNames).sort((a, b) => b.length - a.length);
      let cursor = 0;
      let textBuffer = "";
      while (cursor < value.length) {
        if (value[cursor] !== "@") {
          textBuffer += value[cursor];
          cursor += 1;
          continue;
        }
        const rest = value.slice(cursor + 1);
        const matched = tokenNamesByLength.find((name) => {
          if (!rest.startsWith(name)) return false;
          const tail = rest.slice(name.length, name.length + 1);
          return tail.length === 0 || /\s/.test(tail);
        });
        if (!matched) {
          textBuffer += value[cursor];
          cursor += 1;
          continue;
        }
        if (textBuffer) {
          el.appendChild(document.createTextNode(textBuffer));
          textBuffer = "";
        }
        el.appendChild(createFileRefToken(matched));
        cursor += matched.length + 1;
      }
      if (textBuffer) {
        el.appendChild(document.createTextNode(textBuffer));
      }
      setInput(value);
      updateAtStateFromText(value);
      focusComposerEnd();
    },
    [contextFiles, createFileRefToken, focusComposerEnd, updateAtStateFromText]
  );

  const addContextFile = async (
    taskspaceId: string,
    relPath: string,
    options?: { referenceToken?: boolean }
  ): Promise<string | null> => {
    if (!pane.sessionId || !relPath) return null;
    const fileResp = await window.agenticxDesktop.readTaskspaceFile({
      sessionId: pane.sessionId,
      taskspaceId,
      path: relPath,
    });
    if (!fileResp.ok || typeof fileResp.content !== "string") return null;
    const key = String(fileResp.absolute_path || relPath);
    const content = (fileResp.content ?? "").slice(0, TEXT_ATTACHMENT_LIMIT);
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: key.split(/[\\/]/).pop() || key,
        size: content.length,
        mimeType: "text/plain",
        status: "ready",
        content,
        sourcePath: key,
        referenceToken: !!options?.referenceToken,
      },
    }));
    return key;
  };

  const addTaskspaceAliasReference = async (taskspaceId: string, alias: string, absolutePath: string) => {
    if (!pane.sessionId) return;
    const queue: string[] = ["."];
    const visited = new Set<string>();
    const lines: string[] = [];
    let fileCount = 0;
    const maxFiles = 160;
    while (queue.length > 0 && fileCount < maxFiles) {
      const current = queue.shift() || ".";
      if (visited.has(current)) continue;
      visited.add(current);
      const listResp = await window.agenticxDesktop.listTaskspaceFiles({
        sessionId: pane.sessionId,
        taskspaceId,
        path: current,
      });
      if (!listResp.ok || !Array.isArray(listResp.files)) continue;
      for (const row of listResp.files) {
        if (row.type === "dir") {
          if (!visited.has(row.path)) queue.push(row.path);
          continue;
        }
        lines.push(`- ${row.path}`);
        fileCount += 1;
        if (fileCount >= maxFiles) break;
      }
    }
    const summary = [
      `# directory_alias: ${alias}`,
      `path: ${absolutePath}`,
      "",
      "files:",
      ...lines,
      fileCount >= maxFiles ? "- ... (truncated)" : "",
    ]
      .filter(Boolean)
      .join("\n");
    const key = `@dir:${alias}:${absolutePath}`;
    const content = summary.slice(0, 16000);
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: key,
        size: content.length,
        mimeType: "text/plain",
        status: "ready",
        content,
      },
    }));
  };

  const revealFileInTaskspace = useCallback(async (absPath: string) => {
    if (!pane.sessionId) return;
    const cleanPath = String(absPath || "").trim();
    if (!cleanPath) return;
    const dirPath = cleanPath.includes("/") ? cleanPath.slice(0, cleanPath.lastIndexOf("/")) : cleanPath;
    const result = await window.agenticxDesktop.addTaskspace({
      sessionId: pane.sessionId,
      path: dirPath,
      label: dirPath.split("/").pop() || "taskspace",
    });
    if (result.ok && result.workspace?.id) {
      setActiveTaskspace(pane.id, result.workspace.id);
      if (!pane.taskspacePanelOpen) openSidePanel(pane.id, "workspace");
    }
  }, [pane.id, pane.sessionId, pane.taskspacePanelOpen, setActiveTaskspace, openSidePanel]);

  const copyMessage = useCallback(async (message: Message) => {
    const textToCopy = messagePlainTextForClipboard(message);
    try {
      const firstImage = (message.attachments ?? []).find(
        (attachment) => !!attachment.dataUrl && attachment.mimeType.startsWith("image/")
      );
      if (
        firstImage?.dataUrl &&
        typeof window.ClipboardItem !== "undefined" &&
        typeof navigator.clipboard?.write === "function"
      ) {
        const imageBlob = await fetch(firstImage.dataUrl).then((resp) => resp.blob());
        const imageMime = imageBlob.type || firstImage.mimeType || "image/png";
        await navigator.clipboard.write([
          new ClipboardItem({
            [imageMime]: imageBlob,
            "text/plain": new Blob([textToCopy], { type: "text/plain" }),
          }),
        ]);
        return;
      }
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      // ignore clipboard failures
    }
  }, []);

  /** Copy the full content of a ReAct block: assistant text, reasoning, and tool call results. */
  const copyReActBlock = useCallback(async (messages: Message[]) => {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.id === "__stream__") continue;
      if (msg.role === "assistant") {
        const text = messagePlainTextForClipboard(msg);
        if (text.trim()) parts.push(text.trim());
      } else if (msg.role === "tool") {
        const name = msg.toolName || "tool";
        const result = (msg.content || "").trim();
        if (result) {
          parts.push(`[${name}]\n${result}`);
        } else if (name !== "tool") {
          parts.push(`[${name}]`);
        }
      }
    }
    const textToCopy = parts.join("\n\n");
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const favoriteMessage = useCallback(async (message: Message, selectedText?: string) => {
    if (!apiBase || !pane.sessionId) return;
    const trimmedSel = selectedText?.trim() ?? "";
    const content = trimmedSel.length > 0 ? trimmedSel : message.content;
    const messageId = favoriteStorageMessageId(message.id, content, message.content);
    try {
      const res = await fetch(`${apiBase}/api/memory/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: pane.sessionId,
          message_id: messageId,
          content,
          role: message.role,
        }),
      });
      const data = (await res.json().catch(() => null)) as { already_saved?: boolean } | null;
      if (!res.ok || !data) {
        setFavoriteToastMsg("收藏失败，请稍后重试");
        setFavoriteToastOpen(true);
        return;
      }
      setFavoriteToastMsg(data.already_saved ? "已收藏过" : "已收藏");
      setFavoriteToastOpen(true);
    } catch {
      setFavoriteToastMsg("收藏失败，请稍后重试");
      setFavoriteToastOpen(true);
    }
  }, [apiBase, apiToken, pane.sessionId]);

  const toggleSelectMessage = useCallback((message: Message) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      const linkedIds = new Set<string>([message.id]);
      // In IM ReAct layout, selecting a user message should also toggle its following assistant/tool block.
      if (useReActImLayout && topLevelRowsIm && message.role === "user") {
        for (let i = 0; i < topLevelRowsIm.length; i++) {
          const row = topLevelRowsIm[i];
          if (row.kind === "user" && row.message.id === message.id) {
            const nextRow = topLevelRowsIm[i + 1];
            if (nextRow && nextRow.kind === "react") {
              for (const m of nextRow.block.workMessages) linkedIds.add(m.id);
              if (nextRow.block.finalAssistant) linkedIds.add(nextRow.block.finalAssistant.id);
            }
            break;
          }
        }
      }
      const allSelected = Array.from(linkedIds).every((id) => next.has(id));
      if (allSelected) {
        for (const id of linkedIds) next.delete(id);
      } else {
        for (const id of linkedIds) next.add(id);
      }
      return next;
    });
  }, [topLevelRowsIm, useReActImLayout]);

  /** Toggle the entire ReAct block: if any message in the block is selected, deselect all; otherwise select all. */
  const toggleSelectBlock = useCallback((messages: Message[]) => {
    setSelectedMessageIds((prev) => {
      const anySelected = messages.some((m) => prev.has(m.id));
      const next = new Set(prev);
      if (anySelected) {
        for (const m of messages) next.delete(m.id);
      } else {
        for (const m of messages) next.add(m.id);
      }
      return next;
    });
  }, []);

  const selectUpTo = useCallback((targetMessage: Message) => {
    setSelectedMessageIds((prev) => {
      if (prev.size === 0) return new Set([targetMessage.id]);
      let lastSelectedIdx = -1;
      for (let i = visibleMessages.length - 1; i >= 0; i--) {
        if (prev.has(visibleMessages[i].id)) { lastSelectedIdx = i; break; }
      }
      const targetIdx = visibleMessages.findIndex((m) => m.id === targetMessage.id);
      if (targetIdx < 0) return prev;
      if (lastSelectedIdx < 0) return new Set([targetMessage.id]);
      const lo = Math.min(lastSelectedIdx, targetIdx);
      const hi = Math.max(lastSelectedIdx, targetIdx);
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(visibleMessages[i].id);
      return next;
    });
  }, [visibleMessages]);

  const selectedMessages = useMemo(
    () => visibleMessages.filter((m) => selectedMessageIds.has(m.id)),
    [visibleMessages, selectedMessageIds]
  );

  const resolveForwardTarget = useCallback(
    async (payload: ForwardConfirmPayload): Promise<{ paneId: string; sessionId: string }> => {
      const state = useAppStore.getState();
      if (payload.type === "session") {
        const sid = payload.sessionId.trim();
        const p = state.panes.find((item) => (item.sessionId || "").trim() === sid);
        if (!p) {
          throw new Error("找不到对应窗格，请从侧栏重新打开该会话后再试");
        }
        return { paneId: p.id, sessionId: sid };
      }
      if (payload.type === "avatar") {
        let pane = state.panes.find((item) => item.avatarId === payload.avatarId);
        if (!pane) {
          const paneId = addPane(payload.avatarId, payload.displayName, "");
          setActiveAvatarId(payload.avatarId);
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(paneId, created.session_id);
          return { paneId, sessionId: created.session_id };
        }
        if (payload.forceNewSession) {
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(pane.id, created.session_id);
          setActivePaneId(pane.id);
          setActiveAvatarId(payload.avatarId);
          return { paneId: pane.id, sessionId: created.session_id };
        }
        let sid = (pane.sessionId || "").trim();
        if (!sid) {
          const created = await window.agenticxDesktop.createSession({ avatar_id: payload.avatarId });
          if (!created.ok || !created.session_id) {
            throw new Error(created.error || "创建分身会话失败");
          }
          setPaneSessionId(pane.id, created.session_id);
          sid = created.session_id;
        }
        setActivePaneId(pane.id);
        setActiveAvatarId(payload.avatarId);
        return { paneId: pane.id, sessionId: sid };
      }
      const groupAvatarId = `group:${payload.groupId}`;
      let groupPane = state.panes.find((item) => item.avatarId === groupAvatarId);
      if (!groupPane) {
        const paneId = addPane(groupAvatarId, `群聊 · ${payload.displayName}`, "");
        setActiveAvatarId(null);
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(paneId, created.session_id);
        return { paneId, sessionId: created.session_id };
      }
      if (payload.forceNewSession) {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(groupPane.id, created.session_id);
        setActivePaneId(groupPane.id);
        setActiveAvatarId(null);
        return { paneId: groupPane.id, sessionId: created.session_id };
      }
      let sid = (groupPane.sessionId || "").trim();
      if (!sid) {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        });
        if (!created.ok || !created.session_id) {
          throw new Error(created.error || "创建群聊会话失败");
        }
        setPaneSessionId(groupPane.id, created.session_id);
        sid = created.session_id;
      }
      setActivePaneId(groupPane.id);
      setActiveAvatarId(null);
      return { paneId: groupPane.id, sessionId: sid };
    },
    [addPane, setActiveAvatarId, setActivePaneId, setPaneSessionId]
  );

  const executeForward = useCallback(
    async (targetPayload: ForwardConfirmPayload, followUpNote: string) => {
      if (!apiBase || !pane.sessionId || pendingForwardMessages.length === 0) return;
      const follow = followUpNote.trim();
      /** 与自动追问一致；空则写入默认提示，保证持久化转发卡片里可见（避免仅 skip_user_history 追问在重载后消失）。 */
      const defaultForwardFollowCue = "请阅读刚转发的聊天记录并继续回复。";
      const effectiveFollowNote = follow || defaultForwardFollowCue;
      try {
        const { paneId: targetPaneId, sessionId: targetSessionId } = await resolveForwardTarget(targetPayload);
        const resp = await fetch(`${apiBase}/api/messages/forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
          body: JSON.stringify({
            source_session_id: pane.sessionId,
            target_session_id: targetSessionId,
            messages: pendingForwardMessages,
            follow_up_note: effectiveFollowNote,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(text.slice(0, 200) || `转发失败 HTTP ${resp.status}`);
        }
        setActivePaneId(targetPaneId);
        const targetPaneMeta = useAppStore.getState().panes.find((p) => p.id === targetPaneId);
        const aid = targetPaneMeta?.avatarId;
        if (aid?.startsWith("group:")) {
          setActiveAvatarId(null);
        } else {
          setActiveAvatarId(aid ?? null);
        }
        try {
          const result = await window.agenticxDesktop.loadSessionMessages(targetSessionId);
          if (result.ok && Array.isArray(result.messages)) {
            const mapped: Message[] = result.messages.map((item, index) =>
              mapLoadedSessionMessage(item as LoadedSessionMessage, targetSessionId, index)
            );
            setPaneMessages(targetPaneId, mapped);
          }
        } catch {
          // keep server state; pane may refresh on next poll
        }
        useAppStore.getState().setForwardAutoReply({
          paneId: targetPaneId,
          sessionId: targetSessionId,
          text: effectiveFollowNote,
        });
        useAppStore.getState().bumpSessionCatalogRevision();
        window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 450);
      } catch (err) {
        console.error("[ChatPane] forward failed:", err);
        throw err;
      } finally {
        setPendingForwardMessages([]);
      }
    },
    [
      apiBase,
      apiToken,
      pane.sessionId,
      pendingForwardMessages,
      resolveForwardTarget,
      setActiveAvatarId,
      setActivePaneId,
      setPaneMessages,
    ]
  );

  const forwardOneMessage = useCallback((message: Message, selectedText?: string) => {
    const sender = resolveForwardSender(message, userBubbleLabel);
    const content = resolveQuoteBody(message, selectedText);
    setPendingForwardMessages([
      {
        sender,
        role: message.role,
        content,
        avatar_url: message.avatarUrl,
        timestamp: message.timestamp,
      },
    ]);
    setForwardPickerOpen(true);
  }, [userBubbleLabel]);

  const forwardSelectedMessages = useCallback(() => {
    if (selectedMessages.length === 0) return;
    setPendingForwardMessages(
      selectedMessages.map((message) => ({
        sender: resolveForwardSender(message, userBubbleLabel),
        role: message.role,
        content: resolveQuoteBody(message),
        avatar_url: message.avatarUrl,
        timestamp: message.timestamp,
      }))
    );
    setForwardPickerOpen(true);
  }, [selectedMessages, userBubbleLabel]);

  const deleteSelectedMessages = useCallback(async () => {
    if (selectedMessages.length === 0 || !apiBase || !pane.sessionId) return;
    const desktop = window.agenticxDesktop;
    const confirmResult =
      typeof desktop.confirmDialog === "function"
        ? await desktop.confirmDialog({
            title: "确认删除消息",
            message: `确认删除已选中的 ${selectedMessages.length} 条消息？`,
            detail: "删除后不可恢复。",
            confirmText: "删除",
            cancelText: "取消",
            destructive: true,
          })
        : {
            ok: true,
            confirmed: window.confirm(`确认删除已选中的 ${selectedMessages.length} 条消息？删除后不可恢复。`),
          };
    if (!confirmResult.confirmed) return;
    try {
      const resp = await fetch(`${apiBase}/api/session/messages/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: pane.sessionId,
          messages: selectedMessages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            agent_id: m.agentId,
          })),
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { ok?: boolean; removed?: number; requested?: number };
      const removed = typeof data.removed === "number" ? data.removed : 0;
      const requested =
        typeof data.requested === "number" ? data.requested : selectedMessages.length;
      if (!data.ok || removed < requested) {
        const result = await window.agenticxDesktop.loadSessionMessages(pane.sessionId);
        if (result.ok && Array.isArray(result.messages)) {
          const mapped = result.messages.map((item, idx) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, pane.sessionId, idx)
          );
          setPaneMessages(pane.id, mapped);
        }
      } else {
        const selectedIds = new Set(selectedMessages.map((m) => m.id));
        setPaneMessages(
          pane.id,
          (pane.messages ?? []).filter((m) => !selectedIds.has(m.id))
        );
      }
      setSelectedMessageIds(new Set());
    } catch (err) {
      console.error("[ChatPane] delete selected messages failed:", err);
    }
  }, [apiBase, apiToken, pane.id, pane.messages, pane.sessionId, selectedMessages, setPaneMessages]);

  const retryUserMessage = useCallback(
    async (msg: Message) => {
      if (msg.role !== "user") return;
      const sid = (pane.sessionId || "").trim();
      if (!sid || !apiBase) return;
      const msgs = pane.messages ?? [];
      const idx = msgs.findIndex((m) => m.id === msg.id);
      if (idx < 0) return;
      let end = idx + 1;
      while (end < msgs.length && msgs[end].role !== "user") {
        end++;
      }
      const toRemove = msgs.slice(idx + 1, end);
      if (toRemove.length > 0) {
        try {
          let deletable: Array<Pick<Message, "role" | "content" | "timestamp" | "agentId">> = toRemove;
          const persisted = await window.agenticxDesktop.loadSessionMessages(sid);
          if (persisted.ok && Array.isArray(persisted.messages)) {
            deletable = filterPersistedMessagesForDeletion(
              toRemove,
              persisted.messages as LoadedSessionMessage[]
            );
          }
          if (deletable.length > 0) {
            const resp = await fetch(`${apiBase}/api/session/messages/delete`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
              body: JSON.stringify({
                session_id: sid,
                messages: deletable.map((m) => ({
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  agent_id: m.agentId,
                })),
              }),
            });
            const data = (await resp.json()) as { ok?: boolean; removed?: number; requested?: number };
            const removed = typeof data.removed === "number" ? data.removed : 0;
            const requested = typeof data.requested === "number" ? data.requested : deletable.length;
            if (!resp.ok || !data.ok || removed < requested) {
              const result = await window.agenticxDesktop.loadSessionMessages(sid);
              if (result.ok && Array.isArray(result.messages)) {
                const mapped = result.messages.map((item, midx) =>
                  mapLoadedSessionMessage(item as LoadedSessionMessage, sid, midx)
                );
                setPaneMessages(pane.id, mapped);
              }
              return;
            }
          }
          setPaneMessages(pane.id, msgs.slice(0, idx + 1));
        } catch (err) {
          console.error("[ChatPane] retry trim messages failed:", err);
          return;
        }
      }
      await sendChatRef.current(msg.content, {
        retryAttachments: msg.attachments ?? [],
        suppressUserEcho: true,
        skipUserHistory: true,
      });
    },
    [apiBase, apiToken, pane.id, pane.messages, pane.sessionId, setPaneMessages]
  );

  const editUserMessage = useCallback(
    async (msg: Message, newContent: string) => {
      if (msg.role !== "user") return;
      const sid = (pane.sessionId || "").trim();
      if (!sid || !apiBase) return;
      const msgs = pane.messages ?? [];
      const idx = msgs.findIndex((m) => m.id === msg.id);
      if (idx < 0) return;
      const toRemove = msgs.slice(idx);
      if (toRemove.length > 0) {
        try {
          let deletable: Array<Pick<Message, "role" | "content" | "timestamp" | "agentId">> = toRemove;
          const persisted = await window.agenticxDesktop.loadSessionMessages(sid);
          if (persisted.ok && Array.isArray(persisted.messages)) {
            deletable = filterPersistedMessagesForDeletion(
              toRemove,
              persisted.messages as LoadedSessionMessage[]
            );
          }
          if (deletable.length > 0) {
            const resp = await fetch(`${apiBase}/api/session/messages/delete`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
              body: JSON.stringify({
                session_id: sid,
                messages: deletable.map((m) => ({
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  agent_id: m.agentId,
                })),
              }),
            });
            const data = (await resp.json()) as { ok?: boolean; removed?: number; requested?: number };
            const removed = typeof data.removed === "number" ? data.removed : 0;
            const requested = typeof data.requested === "number" ? data.requested : deletable.length;
            if (!resp.ok || !data.ok || removed < requested) {
              const result = await window.agenticxDesktop.loadSessionMessages(sid);
              if (result.ok && Array.isArray(result.messages)) {
                const mapped = result.messages.map((item, midx) =>
                  mapLoadedSessionMessage(item as LoadedSessionMessage, sid, midx)
                );
                setPaneMessages(pane.id, mapped);
              }
              return;
            }
          }
          setPaneMessages(pane.id, msgs.slice(0, idx));
        } catch (err) {
          console.error("[ChatPane] edit trim messages failed:", err);
          return;
        }
      }
      await sendChatRef.current(newContent, {
        retryAttachments: msg.attachments ?? [],
      });
    },
    [apiBase, apiToken, pane.id, pane.messages, pane.sessionId, setPaneMessages]
  );

  // Group chats also have a real streaming run in flight; only the
  // assistant-text overlay is gated by !isGroupPane (group chats render
  // per-member typing bubbles instead). The stop button + barge-in resend
  // judgment must work in both modes.
  const canInterruptCurrentSession = canStopCurrentRun({
    streaming,
    streamingSessionId,
    currentSessionId: pane.sessionId || "",
  });
  const isRunGuardCurrentSession =
    !canInterruptCurrentSession &&
    !!pane.sessionId &&
    runGuardSessionId === (pane.sessionId || "").trim();

  const syncStreamingUiForCurrentSession = useCallback(() => {
    const sid = (pane.sessionId || "").trim();
    const st = sid ? sessionStreamStateRef.current[sid] : undefined;
    const active = Boolean(st?.active);
    setStreaming(active);
    setStreamingSessionId(active ? sid : "");
    setStreamedAssistantText(active ? st?.text || "" : "");
    setStreamingModel(
      active && st ? { provider: st.provider || "", model: st.model || "" } : null
    );
    abortRef.current = active ? sessionAbortControllersRef.current[sid] ?? null : null;
    if (sid) {
      const deferred = deferredSessionMessagesRef.current[sid] ?? [];
      if (deferred.length > 0) {
        const existing = new Set(
          (pane.messages ?? []).map((m) => `${m.role}::${String(m.agentId ?? "")}::${String(m.content ?? "")}`)
        );
        for (const args of deferred) {
          const role = String(args[1] ?? "");
          const content = String(args[2] ?? "");
          const agentId = String(args[3] ?? "");
          const sig = `${role}::${agentId}::${content}`;
          if (existing.has(sig)) continue;
          addPaneMessage(...args);
          existing.add(sig);
        }
        deferredSessionMessagesRef.current[sid] = [];
      }
    }
  }, [addPaneMessage, pane.messages, pane.sessionId]);

  useEffect(() => {
    syncStreamingUiForCurrentSession();
  }, [syncStreamingUiForCurrentSession]);

  /** 任一 SSE 帧视为仍有响应：刷新计时并在曾误判 stall 时立即收起提示 */
  const recordSseActivity = useCallback(() => {
    lastSseEventAtRef.current = Date.now();
    setStallState((prev) => (prev === "stall" ? "none" : prev));
  }, []);

  const stopCurrentRun = useCallback(() => {
    const sid = (streamingSessionId || pane.sessionId || "").trim();
    if (!sid) return;
    setRunGuardSessionId(sid);
    void window.agenticxDesktop.interruptSession?.(sid);
    const st = sessionStreamStateRef.current[sid];
    if (st) {
      st.text = "⏹ 正在中断...";
      sessionStreamStateRef.current[sid] = st;
    }
    abortRef.current?.abort();
    if ((pane.sessionId || "").trim() === sid) {
      setStreamedAssistantText("⏹ 正在中断...");
    }
    addPaneMessage(pane.id, "tool", "已发送中断请求", "meta");
    setStallState("none");
  }, [addPaneMessage, pane.id, pane.sessionId, streamingSessionId]);

  useEffect(() => {
    if (!isStreamingCurrentSession) {
      setStallState((prev) => prev === "stall" ? "stall" : "none");
      return;
    }
    /** 首 token / 工具进度前模型可能静默较久，阈值过短易误报 */
    const STALL_THRESHOLD_MS = 60_000;
    const tick = () => {
      const lastAt = lastSseEventAtRef.current;
      if (lastAt > 0 && Date.now() - lastAt > STALL_THRESHOLD_MS) {
        setStallState("stall");
      } else {
        setStallState((prev) => (prev === "stall" ? "none" : prev));
      }
    };
    tick();
    const timer = window.setInterval(tick, 3000);
    return () => window.clearInterval(timer);
  }, [isStreamingCurrentSession]);

  useEffect(() => {
    if (isStreamingCurrentSession || !pane.sessionId) return;
    const sid = (pane.sessionId || "").trim();
    const shouldTrackExecutionState =
      stallState === "stall" ||
      stallState === "exhausted" ||
      runGuardSessionId === sid;
    if (!shouldTrackExecutionState) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await window.agenticxDesktop.listSessions(pane.avatarId ?? undefined);
        if (cancelled || !r.ok) return;
        const row = (r.sessions ?? []).find((s) => s.session_id === sid);
        if (row?.execution_state === "idle") {
          setStallState("none");
          if (runGuardSessionId === sid) {
            setRunGuardSessionId("");
          }
          addPaneMessage(pane.id, "tool", "后台任务已完成", "meta");
          try {
            const msgs = await window.agenticxDesktop.loadSessionMessages(sid);
            if (!cancelled && msgs.ok && Array.isArray(msgs.messages)) {
              // Do not overwrite - messages already in memory are richer than disk
            }
          } catch { /* best effort */ }
        }
      } catch { /* ignore */ }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isStreamingCurrentSession, stallState, pane.sessionId, pane.avatarId, pane.id, addPaneMessage, runGuardSessionId]);

  const resumeCurrentTask = useCallback(() => {
    setStallState("none");
    const prompt = stallState === "exhausted"
      ? "继续执行，从上次停止的地方接续。"
      : "请汇报之前任务的执行结果，如果任务未完成请继续执行。";
    void sendChatRef.current(prompt);
  }, [stallState]);

  const sendFollowupChip = useCallback((text: string) => {
    const t = String(text || "").trim();
    if (!t) return;
    void sendChatRef.current(t);
  }, []);

  const renderedMessages = useMemo(() => {
    const renderGroupedRow = (
      row: GroupedChatRow,
      rowIdx: number,
      opts: {
        reactWorkColumn?: boolean;
        reactFlat?: boolean;
        reactHideBadge?: boolean;
        reactShowActions?: boolean;
        omitSuggestedQuestions?: boolean;
      }
    ) => {
      const reactCol = opts.reactWorkColumn ?? false;
      const reactFlat = opts.reactFlat ?? false;
      const reactHideBadge = opts.reactHideBadge ?? false;
      const reactShowActions = opts.reactShowActions ?? false;
      const omitSuggestedQuestions = opts.omitSuggestedQuestions ?? false;
      if (row.kind === "message") {
        const message = row.message;
        const canRetryThisUserMessage = message.role === "user" && !isStreamingCurrentSession;
        const isSelecting = selectedMessageIds.size > 0;
        const rowSelectable = isSelecting && !reactCol;
        const isSelected = selectedMessageIds.has(message.id);
        return (
          <div key={message.id} className="group/sel relative">
            {rowSelectable && !isSelected && (
              <button
                type="button"
                className="absolute -top-1 left-0 z-10 flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] text-text-muted shadow-sm opacity-0 transition-opacity group-hover/sel:opacity-100 hover:!opacity-100 hover:bg-surface-hover hover:text-text-strong"
                onClick={() => selectUpTo(message)}
              >
                ↓ 选择到这里
              </button>
            )}
            <MessageRenderer
              message={message}
              highlightTerms={pane.historySearchTerms}
              assistantBadge={
                message.role === "assistant" && !reactHideBadge && !isMachiMetaPane ? (
                  <ModelBadge provider={message.provider} model={message.model} />
                ) : undefined
              }
              imAssistantVisual={
                message.role === "assistant" && reactCol
                  ? reactShowActions ? "compact-inline-with-actions" : "compact-inline"
                  : "default"
              }
              noBubbleBorder={reactFlat}
              toolCardOmitLeadingSpacer={message.role === "tool" && reactCol}
              onRevealPath={(path) => void revealFileInTaskspace(path)}
              assistantName={paneAvatarMeta.name}
              assistantAvatarUrl={paneAvatarMeta.url}
              userName={userBubbleLabel}
              userAvatarUrl={userAvatarUrl || undefined}
              onCopyMessage={copyMessage}
              onQuoteMessage={(msg, selectedText) =>
                setQuoteTarget({ message: msg, body: resolveQuoteBody(msg, selectedText) })
              }
              onFavoriteMessage={favoriteMessage}
              onForwardMessage={forwardOneMessage}
              onRetryMessage={canRetryThisUserMessage ? retryUserMessage : undefined}
              onEditMessage={canRetryThisUserMessage ? editUserMessage : undefined}
              onToggleSelectMessage={toggleSelectMessage}
              onResolveInlineConfirm={(confirm, approved) => void resolveGroupInlineConfirm(confirm, approved)}
              selectable={rowSelectable}
              selected={rowSelectable && isSelected}
              onFollowupClick={sendFollowupChip}
              omitSuggestedQuestions={omitSuggestedQuestions}
            />
          </div>
        );
      }
      const groupKey = `tg-${row.messages[0]?.id ?? rowIdx}`;
      const isSelecting = selectedMessageIds.size > 0;
      const groupSelectable = isSelecting && !reactCol;
      const anySelected = row.messages.some((m) => selectedMessageIds.has(m.id));
      const anchorMessage = row.messages[row.messages.length - 1];
      return (
        <div key={groupKey} className="group/sel relative">
          {groupSelectable && !anySelected && (
            <button
              type="button"
              className="absolute -top-1 left-0 z-10 flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] text-text-muted shadow-sm opacity-0 transition-opacity group-hover/sel:opacity-100 hover:!opacity-100 hover:bg-surface-hover hover:text-text-strong"
              onClick={() => selectUpTo(anchorMessage)}
            >
              ↓ 选择到这里
            </button>
          )}
          <TurnToolGroupCard
            messages={row.messages}
            highlightTerms={pane.historySearchTerms}
            renderExtras={(m) =>
              renderToolMessageExtras(m, {
                onRevealPath: (p) => void revealFileInTaskspace(p),
                onResolveInlineConfirm: (c, a) => void resolveGroupInlineConfirm(c, a),
              })
            }
            selectable={groupSelectable}
            selectedIds={selectedMessageIds}
            onToggleSelectMessage={toggleSelectMessage}
            omitLeadingSpacer={reactCol}
            flat={reactFlat}
          />
        </div>
      );
    };

    const mainRows =
      topLevelRowsIm !== null
        ? topLevelRowsIm.map((seg, segIdx) => {
            if (seg.kind === "user") {
              return renderGroupedRow({ kind: "message", message: seg.message }, segIdx, {});
            }
            const { workMessages, finalAssistant } = seg.block;
            const groupedWork = groupConsecutiveToolMessages(workMessages);
            const blockKey = `react-${workMessages[0]?.id ?? segIdx}-${finalAssistant?.id ?? ""}`;
            const hasTools = groupedWork.some(
              (r) => r.kind === "tool_group" || (r.kind === "message" && r.message.role === "tool")
            );
            const hasStreamingRow = groupedWork.some(
              (r) => r.kind === "message" && r.message.role === "assistant" && r.message.id === "__stream__"
            );
            const useUnifiedReActCard = hasTools || hasStreamingRow;
            const isSelecting = selectedMessageIds.size > 0;
            const blockAnySelected = workMessages.some((m) => selectedMessageIds.has(m.id));
            const lastAssistantInBlock = [...workMessages].reverse().find(
              (m) => m.role === "assistant" && m.id !== "__stream__"
            ) ?? null;
            let peeledFollowupAssistant: Message | null = null;
            if (useUnifiedReActCard) {
              for (const m of workMessages) {
                if (
                  m.role === "assistant" &&
                  m.id !== "__stream__" &&
                  m.suggestedQuestions &&
                  m.suggestedQuestions.length > 0
                ) {
                  peeledFollowupAssistant = m;
                }
              }
            }
            return (
              <div key={blockKey} className="space-y-2">
                <div className="flex min-w-0 items-start gap-2">
                  {isSelecting ? (
                    <button
                      type="button"
                      className={`mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                        blockAnySelected
                          ? "border-[rgb(var(--theme-color-rgb,6,182,212))] bg-[rgb(var(--theme-color-rgb,6,182,212))] text-white"
                          : "border-text-faint bg-transparent text-transparent"
                      }`}
                      onClick={() => toggleSelectBlock(workMessages)}
                      aria-label={blockAnySelected ? "取消选择回复块" : "选择回复块"}
                    >
                      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
                      </svg>
                    </button>
                  ) : null}
                  {useUnifiedReActCard ? (
                    <div
                      className="min-w-0 flex-1 overflow-hidden"
                    >
                      {groupedWork.map((r, i) => {
                        const omitSq =
                          Boolean(
                            peeledFollowupAssistant &&
                              r.kind === "message" &&
                              r.message.role === "assistant" &&
                              r.message.id === peeledFollowupAssistant.id
                          );
                        return renderGroupedRow(r, i, {
                          reactWorkColumn: true,
                          reactFlat: true,
                          reactHideBadge: i > 0,
                          omitSuggestedQuestions: omitSq,
                        });
                      })}
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      {groupedWork.map((r, i) => renderGroupedRow(r, i, { reactWorkColumn: true, reactShowActions: true }))}
                    </div>
                  )}
                </div>
                {useUnifiedReActCard &&
                hasStreamingRow &&
                peeledFollowupAssistant?.suggestedQuestions &&
                peeledFollowupAssistant.suggestedQuestions.length > 0 ? (
                  <div className="flex min-w-0 items-start gap-2">
                    {isSelecting ? <div className="h-5 w-5 shrink-0" aria-hidden /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col items-start gap-1.5">
                        {peeledFollowupAssistant.suggestedQuestions.slice(0, 3).map((q, qi) => (
                          <button
                            key={`${qi}-${q}`}
                            type="button"
                            className="max-w-full w-fit rounded-full border border-border bg-surface-hover/80 px-2.5 py-1 text-left text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong whitespace-normal"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => sendFollowupChip(q)}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {finalAssistant
                  ? renderGroupedRow({ kind: "message", message: finalAssistant }, segIdx + 1000, {})
                  : null}
                {/* Block-level actions; peeled follow-ups on the next line below icons */}
                {!hasStreamingRow && workMessages.length > 0 && useUnifiedReActCard ? (
                  <div className="flex min-w-0 items-start gap-2">
                    {isSelecting ? <div className="h-5 w-5 shrink-0" aria-hidden /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex w-fit flex-wrap items-center gap-0.5 text-text-faint">
                          <HoverTip label="复制">
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => void copyReActBlock(workMessages)}
                            >
                              <Copy size={13} />
                            </button>
                          </HoverTip>
                          {lastAssistantInBlock ? (
                            <>
                              <HoverTip label="引用">
                                <button
                                  type="button"
                                  className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() =>
                                    setQuoteTarget({
                                      message: lastAssistantInBlock,
                                      body: resolveQuoteBody(lastAssistantInBlock, undefined),
                                    })
                                  }
                                >
                                  <Quote size={13} />
                                </button>
                              </HoverTip>
                              <HoverTip label="收藏">
                                <button
                                  type="button"
                                  className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => void favoriteMessage(lastAssistantInBlock, undefined)}
                                >
                                  <Bookmark size={13} />
                                </button>
                              </HoverTip>
                              <HoverTip label="转发">
                                <button
                                  type="button"
                                  className="rounded p-1 hover:bg-surface-hover hover:text-text-strong"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => forwardOneMessage(lastAssistantInBlock, undefined)}
                                >
                                  <Share2 size={13} />
                                </button>
                              </HoverTip>
                            </>
                          ) : null}
                          <HoverTip label="多选">
                            <button
                              type="button"
                              className={`rounded p-1 hover:bg-surface-hover ${
                                blockAnySelected ? "text-cyan-400 hover:text-cyan-300" : "hover:text-text-strong"
                              }`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleSelectBlock(workMessages)}
                            >
                              <LayoutList size={13} />
                            </button>
                          </HoverTip>
                        </div>
                        {peeledFollowupAssistant?.suggestedQuestions &&
                        peeledFollowupAssistant.suggestedQuestions.length > 0 ? (
                          <div className="flex min-w-0 flex-col items-start gap-1.5">
                            {peeledFollowupAssistant.suggestedQuestions.slice(0, 3).map((q, qi) => (
                              <button
                                key={`${qi}-${q}`}
                                type="button"
                                className="max-w-full w-fit rounded-full border border-border bg-surface-hover/80 px-2.5 py-1 text-left text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong whitespace-normal"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => sendFollowupChip(q)}
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        : groupedVisibleMessages.map((row, rowIdx) => renderGroupedRow(row, rowIdx, {}));

    return (
    <>
      {mainRows}
      {Object.entries(groupTyping).map(([agentId, name]) => (
        <ImBubble
          key={`typing-${agentId}`}
          message={{ id: `typing-${agentId}`, role: "assistant", content: "", avatarName: name, agentId }}
          assistantName={name}
        />
      ))}
      {isStreamingCurrentSession && !hideStreamOverlayAsDuplicate && !useReActImLayout ? (
        chatStyle === "terminal" ? (
          <TerminalLine
            message={{ id: "__stream__", role: "assistant", content: streamTextForCurrentSession }}
            badge={
              !isMachiMetaPane && streamingModel ? (
                <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
              ) : undefined
            }
          />
        ) : chatStyle === "clean" ? (
          <CleanBlock
            message={{ id: "__stream__", role: "assistant", content: streamTextForCurrentSession }}
            badge={
              !isMachiMetaPane && streamingModel ? (
                <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
              ) : undefined
            }
          />
        ) : (
          <ImBubble
            message={{ id: "__stream__", role: "assistant", content: streamTextForCurrentSession }}
            highlightTerms={pane.historySearchTerms}
            badge={
              !isMachiMetaPane && streamingModel ? (
                <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
              ) : undefined
            }
            assistantName={paneAvatarMeta.name}
            assistantAvatarUrl={paneAvatarMeta.url}
          />
        )
      ) : null}
      {queuedMessages.length > 0 && queuedMessages.map((qm, qi) => (
        <QueuedMessageBubble
          key={qm.id}
          msg={qm}
          index={qi}
          total={queuedMessages.length}
          onEdit={(id, newText) => editPendingMessage(paneId, id, newText)}
          onRemove={(id) => removePendingMessage(paneId, id)}
        />
      ))}
      {stallState === "stall" && (
        <StallRecoveryCard
          kind="stall"
          onResume={resumeCurrentTask}
          onStop={stopCurrentRun}
        />
      )}
      {stallState === "exhausted" && (
        <StallRecoveryCard
          kind="exhausted"
          rounds={exhaustedRounds?.rounds}
          maxRounds={exhaustedRounds?.maxRounds}
          onResume={resumeCurrentTask}
          onStop={stopCurrentRun}
          onOpenSettings={() => useAppStore.getState().openSettings()}
        />
      )}
    </>
    );
  }, [chatStyle, copyMessage, copyReActBlock, editPendingMessage, exhaustedRounds, favoriteMessage, forwardOneMessage, groupTyping, groupedVisibleMessages, hideStreamOverlayAsDuplicate, input, isGroupPane, isMachiMetaPane, isRunGuardCurrentSession, isStreamingCurrentSession, pane.historySearchTerms, pane.sessionId, paneAvatarMeta, paneId, queuedMessages, readyAttachments.length, removePendingMessage, resolveGroupInlineConfirm, resolveQuoteBody, resumeCurrentTask, revealFileInTaskspace, retryUserMessage, selectUpTo, selectedMessageIds, sendFollowupChip, setQuoteTarget, stallState, stopCurrentRun, streamTextForCurrentSession, streamingModel, toggleSelectBlock, toggleSelectMessage, topLevelRowsIm, userAvatarUrl, userBubbleLabel]);

  const removeAttachment = useCallback((key: string) => {
    setContextFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const parseLocalFile = useCallback((file: File, key: string) => {
    if (isImageFile(file) && isKnownNonVisionChatModel(chatProvider, chatModel)) {
      setAttachToastOpen(true);
      return;
    }
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "parsing",
        content: "",
      },
    }));

    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "image/*",
            status: "ready",
            content: `[图片: ${file.name}]`,
            dataUrl,
          },
        }));
      };
      reader.onerror = () => {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "image/*",
            status: "error",
            content: "",
            errorText: "图片解析失败",
          },
        }));
      };
      reader.readAsDataURL(file);
      return;
    }

    if (isLikelyTextFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "text/plain",
            status: "ready",
            content: text.slice(0, TEXT_ATTACHMENT_LIMIT),
          },
        }));
      };
      reader.onerror = () => {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "text/plain",
            status: "error",
            content: "",
            errorText: "文本解析失败",
          },
        }));
      };
      reader.readAsText(file);
      return;
    }

    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "error",
        content: "",
        errorText: "不支持的文件格式",
      },
    }));
  }, [chatProvider, chatModel]);

  const onMicClick = () => {
    if (recording) {
      stopRecording();
      setRecording(false);
      return;
    }
    setRecording(true);
    void startRecording(
      async (text) => {
        setRecording(false);
        await sendChat(text);
      },
      () => {
        // Keep UI simple in pane mode: no interim transcript rendering.
      }
    );
    window.setTimeout(() => {
      stopRecording();
      setRecording(false);
    }, 5000);
  };

  const sendChatRef = useRef<(
    text: string,
    options?: {
      retryAttachments?: MessageAttachment[];
      suppressUserEcho?: boolean;
      skipUserHistory?: boolean;
    }
  ) => Promise<void>>(
    async () => {}
  );

  /** Send a team-mode action (ADD_TASK / PAUSE / RESUME / STOP) to TaskLock via Studio API. */
  const sendGroupTeamAction = async (action: string, data?: Record<string, unknown>) => {
    if (!isGroupPane || !groupChatId || !pane?.sessionId) return;
    try {
      const agxUrl = (window as unknown as { __AGX_URL__?: string }).__AGX_URL__ ?? "http://localhost:19080";
      await fetch(`${agxUrl}/api/groups/${groupChatId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, session_id: pane.sessionId, data: data ?? {} }),
      });
    } catch (e) {
      console.warn("[GroupTeam] action failed:", e);
    }
  };

  const sendChat = async (
    userText: string,
    options?: {
      retryAttachments?: MessageAttachment[];
      suppressUserEcho?: boolean;
      skipUserHistory?: boolean;
    }
  ) => {
    if (focusMode) {
      try {
        // @ts-expect-error - focusModeExpand is added in a newer IPC version
        const expandFn = window.agenticxDesktop?.focusModeExpand;
        if (expandFn) {
          const res = await expandFn();
          if (res?.ok) {
            useAppStore.getState().setFocusModeTall(true);
          } else {
            useAppStore.getState().exitFocusMode();
          }
        } else {
          // Fallback if main process hasn't been restarted and IPC is missing
          useAppStore.getState().exitFocusMode();
        }
      } catch {
        useAppStore.getState().exitFocusMode();
      }
    }
    const text = userText.trim();
    const messageText = text || ATTACHMENT_ONLY_USER_PROMPT;
    const retryAttachments = options?.retryAttachments;
    const suppressUserEcho = !!options?.suppressUserEcho;
    const skipUserHistory = !!options?.skipUserHistory;
    const readyEntries = attachmentEntries.filter(([, file]) => file.status === "ready");
    const composerAttachments: MessageAttachment[] = readyAttachments.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      dataUrl: file.dataUrl,
      sourcePath: file.sourcePath,
      referenceToken: file.referenceToken,
    }));
    const rawUserAttachments: MessageAttachment[] =
      retryAttachments && retryAttachments.length > 0
        ? retryAttachments.map((item) => ({ ...item }))
        : composerAttachments;
    // Do not drop reference/workspace attachments when the user asks a short follow-up without @文件名;
    // otherwise context_files never reaches the model and the file looks "invisible".
    const userAttachments: MessageAttachment[] = rawUserAttachments;
    const hasReadyAttachments = userAttachments.length > 0;
    if ((!text && !hasReadyAttachments) || !apiBase) return;

    const useLazySession = !isGroupPane && !isAutomationTaskPane;
    let requestSessionId = (pane.sessionId || "").trim();

    if (!requestSessionId) {
      if (!useLazySession) return;
      try {
        const avatarId =
          pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
        const inheritFrom = peekPaneLazyInheritParent(pane.id);
        const created = await window.agenticxDesktop.createSession({
          avatar_id: avatarId,
          ...(inheritFrom ? { inherit_from_session_id: inheritFrom } : {}),
        });
        if (!created.ok || !created.session_id) {
          addPaneMessage(
            pane.id,
            "tool",
            `⚠️ 无法创建会话：${created.error || "未知错误"}。请检查后端服务。`,
            "meta"
          );
          return;
        }
        requestSessionId = created.session_id;
        clearPaneLazyInheritParent(pane.id);
        if (created.inherited) {
          setPaneContextInherited(pane.id, true);
        }
        // Defensive reset: a brand-new lazy session must never display any
        // residual messages from the previously-running session (which may
        // have been racily restored by poll/sync effects while sessionId
        // was transitioning from "" to the new id).
        useAppStore.getState().setPaneMessages(pane.id, []);
        lastPollCountRef.current = 0;
        pollSessionSidRef.current = requestSessionId;
        setPaneSessionId(pane.id, requestSessionId);
        clearPaneAwaitingFreshSession(pane.id);
        useAppStore.getState().bumpSessionCatalogRevision();
        window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 450);
      } catch (err) {
        addPaneMessage(pane.id, "tool", `⚠️ 创建会话失败：${String(err)}`, "meta");
        return;
      }
    }
    if (
      shouldInterruptOnResend({
        isStreamRunActive: !!sessionStreamStateRef.current[requestSessionId]?.active,
      })
    ) {
      // Barge-in semantics (Cursor / ChatGPT style): when the user sends a
      // follow-up while the previous round is still streaming, abort the
      // current run and start a new round. The natural chat history (Q1 +
      // partial assistant + Q2) is preserved by the SSE finally block which
      // commits any non-empty partial text before resolving.
      try {
        await window.agenticxDesktop.interruptSession?.(requestSessionId);
      } catch (err) {
        console.warn("[ChatPane] barge-in interrupt failed:", err);
      }
      const prevAbort = sessionAbortControllersRef.current[requestSessionId];
      if (prevAbort) {
        try {
          prevAbort.abort();
        } catch {
          // Already aborted.
        }
        delete sessionAbortControllersRef.current[requestSessionId];
      }
      const prevState = sessionStreamStateRef.current[requestSessionId];
      if (prevState) {
        prevState.active = false;
        prevState.text = "";
        sessionStreamStateRef.current[requestSessionId] = prevState;
      }
      if ((pane.sessionId || "").trim() === requestSessionId) {
        setStreamedAssistantText("");
      }
      setStallState("none");
      // Fall through: proceed with a normal send below.
    }

    const otherPanesWithSameSession = panes.filter(
      (p) => p.id !== pane.id && (p.sessionId || "").trim() === requestSessionId && requestSessionId.length > 0
    );
    if (otherPanesWithSameSession.length > 0) {
      console.warn(
        "[ChatPane] session collision detected: pane %s shares session %s with %d other pane(s); creating isolated session",
        pane.id,
        requestSessionId,
        otherPanesWithSameSession.length,
      );
      try {
        const avatarId =
          pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
        const created = await window.agenticxDesktop.createSession({ avatar_id: avatarId });
        if (created.ok && created.session_id) {
          requestSessionId = created.session_id;
          // Fresh isolated session must start with a clean pane so we do not
          // keep displaying the shared/stale messages from the colliding peer.
          useAppStore.getState().setPaneMessages(pane.id, []);
          lastPollCountRef.current = 0;
          pollSessionSidRef.current = requestSessionId;
          setPaneSessionId(pane.id, requestSessionId);
          addPaneMessage(pane.id, "tool", "⚠️ 检测到会话冲突，已自动切换到独立会话。", "meta");
        }
      } catch (err) {
        console.error("[ChatPane] failed to create isolated session:", err);
      }
      return;
    }
    const selectedIsPaneSubagent =
      !!selectedSubAgent && paneSubAgents.some((item) => item.id === selectedSubAgent);
    const targetAgentId = selectedIsPaneSubagent ? selectedSubAgent : "meta";
    const mentionMap = new Map(
      groupMembers.map((a) => [a.name.trim().toLowerCase(), a.id])
    );
    const mentionRegex = /@([^\s@]+)/g;
    const mentionedAvatarIds: string[] = [];
    if (isGroupPane) {
      let m: RegExpExecArray | null;
      while ((m = mentionRegex.exec(text)) !== null) {
        const matchedName = (m[1] || "").trim().toLowerCase();
        const avatarId = mentionMap.get(matchedName);
        if (avatarId && !mentionedAvatarIds.includes(avatarId)) mentionedAvatarIds.push(avatarId);
      }
    }
    if (targetAgentId === "meta") {
      if (!suppressUserEcho) {
        addPaneMessage(
          pane.id,
          "user",
          messageText,
          "meta",
          undefined,
          undefined,
          userAttachments,
          quoteTarget
            ? {
                quotedMessageId: quoteTarget.message.id,
                quotedContent: `${quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}: ${quoteTarget.body.slice(0, 120)}`,
              }
            : undefined
        );
      }
    } else {
      addSubAgentEvent(targetAgentId, { type: "user", content: messageText });
      addPaneMessage(pane.id, "tool", `🗣 发送给 ${targetAgentId}: ${messageText}`, "meta");
    }
    setComposerText("");
    setQuoteTarget(null);
    // Clear attachments immediately so chips do not linger until the stream ends (finally also clears).
    setContextFiles({});
    sessionStreamStateRef.current[requestSessionId] = {
      active: true,
      text: "",
      provider: chatProvider,
      model: chatModel,
    };
    setRunGuardSessionId(requestSessionId);
    recordSseActivity();
    setStallState("none");
    setExhaustedRounds(null);
    if ((pane.sessionId || "").trim() === requestSessionId) {
      syncStreamingUiForCurrentSession();
    }
    cancelStreamRenderFrame();
    setStreamedAssistantText("");
    streamTextRef.current = "";
    streamCommittedRef.current = false;
    lastMidStreamAssistantCommitRef.current = null;
    const abortController = new AbortController();
    sessionAbortControllersRef.current[requestSessionId] = abortController;
    if ((pane.sessionId || "").trim() === requestSessionId) {
      abortRef.current = abortController;
    }
    const isTargetSessionStillActive = () => {
      const currentPane = useAppStore.getState().panes.find((p) => p.id === pane.id);
      return (currentPane?.sessionId || "").trim() === requestSessionId;
    };
    const addPaneMessageIfSessionActive = (...args: Parameters<typeof addPaneMessage>) => {
      if (!isTargetSessionStillActive()) {
        const bucket = deferredSessionMessagesRef.current[requestSessionId] ?? [];
        bucket.push(args);
        deferredSessionMessagesRef.current[requestSessionId] = bucket.slice(-80);
        return;
      }
      addPaneMessage(...args);
    };
    const commitCurrentStreamIfNeeded = () => {
      const raw = streamTextRef.current.trim();
      // Trim trailing colon ("：" or ":") that model writes just before calling a tool
      // — prevents orphaned "检查文件：" bubbles before a ToolCallCard.
      const partial = raw.replace(/[：:]\s*$/, "").trimEnd();
      if (!partial || isThinkingPlaceholderText(partial) || streamCommittedRef.current) return false;
      addPaneMessageIfSessionActive(pane.id, "assistant", partial, "meta", chatProvider, chatModel);
      streamCommittedRef.current = true;
      lastMidStreamAssistantCommitRef.current = partial;
      return true;
    };
    const scheduleStreamTextUpdate = (nextText: string) => {
      streamTextRef.current = nextText;
      const state = sessionStreamStateRef.current[requestSessionId];
      if (state) {
        state.text = nextText;
        sessionStreamStateRef.current[requestSessionId] = state;
      }
      if (abortController.signal.aborted) return;
      if (streamRafRef.current !== null) return;
      streamRafRef.current = window.requestAnimationFrame(() => {
        streamRafRef.current = null;
        if (!abortController.signal.aborted && isTargetSessionStillActive()) {
          setStreamedAssistantText(streamTextRef.current);
        }
      });
    };

    try {
      const body: Record<string, unknown> = { session_id: requestSessionId, user_input: messageText };
      if (skipUserHistory) body.skip_user_history = true;
      const ats = (pane.activeTaskspaceId || "").trim();
      if (ats) body.active_taskspace_id = ats;
      if (quoteTarget) {
        body.quoted_message_id = quoteTarget.message.id;
        body.quoted_content = `${quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}: ${quoteTarget.body}`;
      }
      if (chatProvider) body.provider = chatProvider;
      if (chatModel) body.model = chatModel;
      if (targetAgentId !== "meta") body.agent_id = targetAgentId;
      if (isGroupPane && targetAgentId === "meta") {
        body.group_id = groupChatId;
        body.mentioned_avatar_ids = mentionedAvatarIds;
        body.meta_leader_display_name = metaLeaderDisplayName;
        body.user_display_name = userBubbleLabel;
      }
      if (userBubbleLabel && userBubbleLabel !== "我") body.user_nickname = userBubbleLabel;
      if (userPreference.trim()) body.user_preference = userPreference.trim();
      // Extract @skill:// references from message text
      const skillSlugMatches = messageText.match(/@skill:\/\/([^\s@,，。！？\n]+)/g);
      if (skillSlugMatches && skillSlugMatches.length > 0) {
        const skillSlugs = [...new Set(skillSlugMatches.map((m) => m.replace("@skill://", "")))];
        if (skillSlugs.length > 0) body.skill_slugs = skillSlugs;
      }
      if (userAttachments.length > 0) {
        const imageInputs = userAttachments
          .filter((file) => !!file.dataUrl && file.mimeType.startsWith("image/"))
          .map((file) => ({
            name: file.name,
            data_url: file.dataUrl as string,
            mime_type: file.mimeType,
            size: file.size,
          }));
        const canSendImageInputs = targetAgentId === "meta" && !isGroupPane;
        if (canSendImageInputs && imageInputs.length > 0) {
          body.image_inputs = imageInputs;
        }
        const contextFilePayload: Record<string, string> = {};
        for (const file of userAttachments) {
          const key = String(file.sourcePath || file.name || "").trim();
          if (!key) continue;
          const ready = resolveReadyAttachment(file, readyEntries);
          const isImage = !!file.dataUrl || file.mimeType.startsWith("image/") || !!ready?.dataUrl || ready?.mimeType.startsWith("image/");
          if (isImage) {
            contextFilePayload[key] = "[图片文件]";
          } else if (ready?.content) {
            contextFilePayload[key] = ready.content;
          } else {
            contextFilePayload[key] = `[附件] ${file.name}`;
          }
        }
        if (Object.keys(contextFilePayload).length > 0) {
          body.context_files = contextFilePayload;
        }
      }
      const sendChatRequest = (sessionId: string) => {
        body.session_id = sessionId;
        return fetch(`${apiBase}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });
      };

      let resp = await sendChatRequest(requestSessionId);
      if (resp.status === 404) {
        // Recover from stale bound session IDs (e.g. old WeChat binding points to removed session).
        const created = await window.agenticxDesktop.createSession({
          avatar_id: pane.avatarId && !pane.avatarId.startsWith("group:") ? pane.avatarId : undefined,
        });
        if (created.ok && created.session_id) {
          const oldSessionId = requestSessionId;
          requestSessionId = created.session_id;
          setPaneSessionId(pane.id, requestSessionId);

          try {
            const rw = await window.agenticxDesktop.loadWechatBinding();
            const desk = rw.ok
              ? (rw.bindings["_desktop"] as {
                  session_id?: string;
                  avatar_id?: string;
                  avatar_name?: string;
                  provider?: string;
                  model?: string;
                } | undefined)
              : undefined;
            if (desk?.session_id === oldSessionId) {
              await window.agenticxDesktop.saveWechatDesktopBinding({
                sessionId: requestSessionId,
                avatarId: (desk.avatar_id ?? pane.avatarId ?? null) as string | null,
                avatarName: (desk.avatar_name ?? pane.avatarName ?? null) as string | null,
                provider: (desk.provider ?? pane.modelProvider ?? null) as string | null,
                model: (desk.model ?? pane.modelName ?? null) as string | null,
              });
            }
          } catch {
            // best-effort binding sync
          }

          addPaneMessageIfSessionActive(pane.id, "tool", "⚠️ 会话已失效，已自动迁移到新会话并重试。", "meta");
          resp = await sendChatRequest(requestSessionId);
        }
      }
      lastGroupProgressRef.current = {};
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let full = "";
      let cumulativeFull = "";
      let pendingSuggestedQuestions: string[] = [];
      let buffer = "";
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            recordSseActivity();
            const eventAgentId = payload.data?.agent_id ?? "meta";
            if (payload.type === "group_typing") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              continue;
            }
            if (payload.type === "group_progress") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const progressText = String(payload.data?.content ?? "").trim();
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              if (!progressText) continue;
              const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
              if (prevText === progressText) continue;
              lastGroupProgressRef.current[eventAgentId] = progressText;
              addPaneMessageIfSessionActive(
                pane.id,
                "tool",
                `${avatarName}：${progressText}`,
                eventAgentId,
                chatProvider,
                chatModel,
                undefined,
                { avatarName, avatarUrl: avatarUrl || undefined }
              );
              continue;
            }
            if (payload.type === "group_blocked") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const blockedText = String(payload.data?.content ?? "").trim();
              const requestId = String(payload.data?.confirm_request_id ?? "").trim();
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (!blockedText) continue;
              const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
              if (prevText === blockedText) continue;
              lastGroupProgressRef.current[eventAgentId] = blockedText;
              const strategy = useAppStore.getState().confirmStrategy;
              if (strategy === "auto" && requestId) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "tool",
                  `${avatarName}：确认通过，继续执行`,
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
                fetch(`${apiBase}/api/confirm`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                  body: JSON.stringify({
                    session_id: requestSessionId,
                    request_id: requestId,
                    approved: true,
                    agent_id: eventAgentId,
                  }),
                }).catch(() => {});
                continue;
              }
              addPaneMessageIfSessionActive(
                pane.id,
                "tool",
                `${avatarName}：⏸ ${blockedText}`,
                eventAgentId,
                chatProvider,
                chatModel,
                undefined,
                {
                  avatarName,
                  avatarUrl: avatarUrl || undefined,
                  inlineConfirm: requestId
                    ? {
                        requestId,
                        question: blockedText,
                        agentId: eventAgentId,
                        sessionId: requestSessionId,
                      }
                    : undefined,
                }
              );
              continue;
            }
            if (payload.type === "group_reply") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const content = String(payload.data?.content ?? "");
              const errorText = String(payload.data?.error ?? "");
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (content.trim()) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  content,
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              } else if (errorText.trim()) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  `${avatarName} 回复失败：${errorText}`,
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              }
              continue;
            }
            if (payload.type === "group_nudge") {
              const avatarName = String(payload.data?.avatar_name ?? metaLeaderDisplayName);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const content = String(payload.data?.content ?? "");
              if (content.trim()) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  content,
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              }
              continue;
            }
            if (payload.type === "group_skipped") {
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              continue;
            }
            // ── workforce.* events (routing="team") ──────────────────────
            if (typeof payload.type === "string" && payload.type.startsWith("workforce.")) {
              const wfAction = payload.type.replace("workforce.", "");
              const wfContent = String(payload.data?.content || "").trim();
              const wfData = payload.data || {};
              // Clear typing indicator for the member
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (wfAction === "message.assistant" && wfContent) {
                // Route assistant messages to the message area (visible to user)
                const avatarName = String(wfData.avatar_name ?? eventAgentId);
                const avatarUrl = String(wfData.avatar_url ?? "");
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  wfContent,
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined }
                );
              } else if (wfAction === "task.created" || wfAction === "task.assigned" || wfAction === "task.started") {
                // Show a brief notice for task lifecycle events (using assistant role, system-like prefix)
                const desc = String(wfData.task_description || wfData.content || "").slice(0, 120);
                if (desc) {
                  const label =
                    wfAction === "task.created" ? "📋 任务创建" :
                    wfAction === "task.assigned" ? "👤 任务分配" : "▶️ 执行中";
                  addPaneMessageIfSessionActive(
                    pane.id,
                    "assistant",
                    `[系统] ${label}：${desc}`,
                    "__meta__",
                    chatProvider,
                    chatModel,
                    undefined,
                    { avatarName: "Team", avatarUrl: undefined }
                  );
                }
              } else if (wfAction === "task.completed") {
                const result = String(wfData.result || wfData.content || "").slice(0, 200);
                if (result) {
                  addPaneMessageIfSessionActive(
                    pane.id,
                    "assistant",
                    `[系统] ✅ 任务完成：${result}`,
                    "__meta__",
                    chatProvider,
                    chatModel,
                    undefined,
                    { avatarName: "Team", avatarUrl: undefined }
                  );
                }
              } else if (wfAction === "task.failed") {
                const err = String(wfData.error || wfData.content || "失败").slice(0, 120);
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  `[系统] ❌ 任务失败：${err}`,
                  "__meta__",
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName: "Team", avatarUrl: undefined }
                );
              } else if (wfAction === "system.workforce_stopped") {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  "[系统] 🏁 团队任务已完成",
                  "__meta__",
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName: "Team", avatarUrl: undefined }
                );
              }
              continue;
            }
            if (payload.type === "tool_progress") {
              const name = String(payload.data?.name ?? "tool");
              const sec = Number(payload.data?.elapsed_seconds ?? 0);
              const outputLine = payload.data?.line as string | undefined;
              const progressCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              if (eventAgentId === "meta" && progressCallId) {
                const patch: Parameters<typeof updatePaneMessageByToolCallId>[2] = {
                  toolStatus: "running",
                };
                if (Number.isFinite(sec)) patch.toolElapsedSec = sec;
                if (outputLine !== undefined) patch.appendStreamLine = String(outputLine);
                updatePaneMessageByToolCallId(pane.id, progressCallId, patch);
                continue;
              }
              if (outputLine !== undefined && eventAgentId === "meta" && !progressCallId) {
                // Legacy events without tool_call_id: keep liveness on stream (no merged card).
                continue;
              }
              if (eventAgentId === "meta") {
                continue;
              }
              if (name === "cc_bridge_send") {
                updateSubAgent(eventAgentId, {
                  currentAction: ccBridgeSendToolProgressLabel(sec, ccBridgeLastSessionModeRef.current),
                });
              } else {
                updateSubAgent(eventAgentId, {
                  currentAction: Number.isFinite(sec) ? `${name} 执行中… (${sec}s)` : `${name} 执行中…`,
                });
              }
              continue;
            }
            if (payload.type === "token") {
              if (eventAgentId === "meta") {
                const rawToken = String(payload.data?.text ?? "");
                // Strip backend-emitted ⏳ waiting placeholder — prevents it from appearing
                // in Thought blocks or committed assistant messages.
                const tokenText = rawToken.replace(/⏳\s*/g, "");
                if (!tokenText) continue;
                if (isThinkingPlaceholderText(tokenText) && !full.trim()) {
                  // Ignore other placeholder tokens to prevent ghost answers.
                  continue;
                }
                full += tokenText;
                cumulativeFull += tokenText;
                scheduleStreamTextUpdate(full);
              } else {
                const tok = String(payload.data?.text ?? "");
                if (tok) {
                  const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                  const prev = sub?.liveOutput ?? "";
                  const next = (prev + tok).slice(-4000);
                  updateSubAgent(eventAgentId, { liveOutput: next });
                }
              }
            }
            if (payload.type === "tool_call") {
              const toolNameStr = String(payload.data?.name ?? "tool");
              const toolArgs = (payload.data?.arguments ?? payload.data?.args ?? {}) as Record<string, unknown>;
              const toolCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              if (eventAgentId === "meta" && toolNameStr === "cc_bridge_start") {
                const callKey = toolCallId || `${requestSessionId || "session"}:cc_bridge_start`;
                const modeHint = parseCcBridgeModeFromPayload(toolArgs);
                if (modeHint === "headless") {
                  ccBridgeLastSessionModeRef.current = "headless";
                } else if (modeHint === "visible_tui") {
                  ccBridgeLastSessionModeRef.current = "visible_tui";
                }
                if (modeHint !== "headless") {
                  void triggerCcBridgeVisibleTerminal(callKey);
                }
              }
              // Filter out internal housekeeping tools that add no user-visible signal
              const SILENT_TOOLS = new Set(["check_resources"]);
              if (!SILENT_TOOLS.has(toolNameStr)) {
                if (eventAgentId === "meta") {
                  commitCurrentStreamIfNeeded();
                  full = "";
                  streamTextRef.current = "";
                  cancelStreamRenderFrame();
                  scheduleStreamTextUpdate("");
                  streamCommittedRef.current = false;
                  const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
                  const lastMsg = pan?.messages.length ? pan.messages[pan.messages.length - 1] : undefined;
                  const toolGroupId =
                    lastMsg?.role === "tool" && lastMsg.toolGroupId
                      ? lastMsg.toolGroupId
                      : crypto.randomUUID();
                  const rawArgs = JSON.stringify(toolArgs);
                  const content =
                    rawArgs.length > 80_000 ? `${rawArgs.slice(0, 80_000)}\n… (truncated)` : rawArgs;
                  if (toolCallId) {
                    addPaneMessageIfSessionActive(pane.id, "tool", content, "meta", undefined, undefined, undefined, {
                      toolCallId,
                      toolName: toolNameStr,
                      toolArgs,
                      toolStatus: "running",
                      toolGroupId,
                    });
                  } else {
                    const legacy = `\u{1F527} ${toolNameStr}: ${JSON.stringify(toolArgs).slice(0, 120)}`;
                    addPaneMessageIfSessionActive(pane.id, "tool", legacy, "meta");
                  }
                } else {
                  const legacy = `\u{1F527} ${toolNameStr}: ${JSON.stringify(toolArgs).slice(0, 120)}`;
                  addSubAgentEvent(eventAgentId, { type: "tool_call", content: legacy });
                  const livePreview = buildToolCallLivePreview(toolNameStr, toolArgs);
                  if (livePreview) {
                    const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                    const prev = sub?.liveOutput ?? "";
                    const next = `${prev}${prev ? "\n\n" : ""}${livePreview}`.slice(-12000);
                    updateSubAgent(eventAgentId, { liveOutput: next });
                  }
                }
              }
            }
            if (payload.type === "tool_result") {
              const toolName = String(payload.data?.name ?? "");
              const formatted = formatToolResultMessage(toolName, payload.data?.result);
              if (formatted.silent) continue;
              const resultCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              const rawContent = serializeToolResultRaw(payload.data?.result);
              const preview = formatted.content.replace(/\s+/g, " ").trim().slice(0, 160);
              const mergedStatus = deriveToolStatusFromResult(payload.data?.result);
              if (eventAgentId === "meta" && resultCallId) {
                const merged = updatePaneMessageByToolCallId(pane.id, resultCallId, {
                  content: rawContent,
                  toolStatus: mergedStatus,
                  toolResultPreview: preview,
                  toolStreamLines: [],
                });
                if (!merged) {
                  addPaneMessageIfSessionActive(pane.id, "tool", formatted.content, "meta");
                }
              } else if (eventAgentId === "meta") {
                addPaneMessageIfSessionActive(pane.id, "tool", formatted.content, "meta");
              } else {
                addSubAgentEvent(eventAgentId, { type: "tool_result", content: formatted.content });
                if (toolName === "file_write" || toolName === "file_edit") {
                  const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                  const prev = sub?.liveOutput ?? "";
                  const marker = `\n\n# ${toolName} applied`;
                  updateSubAgent(eventAgentId, { liveOutput: `${prev}${marker}`.slice(-12000) });
                }
              }
              if (toolName === "spawn_subagent" && eventAgentId === "meta") {
                try {
                  const spawnResult = typeof payload.data?.result === "string"
                    ? JSON.parse(payload.data.result)
                    : payload.data?.result;
                  const spawnId = spawnResult?.agent_id;
                  if (spawnId) {
                    console.debug("[ChatPane] spawn_subagent tool_result fallback addSubAgent", spawnId);
                    addSubAgent({
                      id: spawnId,
                      name: spawnResult.name ?? spawnId,
                      role: spawnResult.role ?? "worker",
                      provider: spawnResult.provider ?? undefined,
                      model: spawnResult.model ?? undefined,
                      task: spawnResult.task ?? "",
                      sessionId: requestSessionId || undefined,
                    });
                  }
                } catch { /* ignore parse errors */ }
              }
              if (
                eventAgentId === "meta" &&
                toolName === "set_taskspace" &&
                isSetTaskspaceToolSuccess(payload.data?.result)
              ) {
                setTaskspaceAutoRefreshKey((prev) => prev + 1);
              }
              if (eventAgentId === "meta" && toolName === "cc_bridge_start") {
                try {
                  const resultRaw = payload.data?.result;
                  const resultObj = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
                  const hint = parseCcBridgeModeFromPayload(resultObj);
                  if (hint) {
                    ccBridgeLastSessionModeRef.current = hint;
                  }
                  const sid = typeof resultObj?.session_id === "string" ? resultObj.session_id : "";
                  if (sid && hint === "visible_tui") {
                    void triggerCcBridgeTailTerminal(sid);
                  }
                } catch {
                  // ignore parse errors
                }
              }
              if (eventAgentId === "meta" && toolName === "cc_bridge_send") {
                try {
                  const resultRaw = payload.data?.result;
                  const resultObj = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
                  if (
                    resultObj?.mode === "visible_tui" &&
                    resultObj?.ok === true &&
                    String(resultObj?.parsed_response ?? "").trim().length > 0
                  ) {
                    addPaneMessageIfSessionActive(
                      pane.id,
                      "assistant",
                      String(resultObj.parsed_response),
                      "meta",
                    );
                  }
                } catch {
                  /* ignore */
                }
              }
            }
            if (payload.type === "confirm_required") {
              if (eventAgentId !== "meta") {
                const confirmReqId = String(payload.data?.id ?? "");
                updateSubAgent(eventAgentId, {
                  status: "awaiting_confirm",
                  currentAction: "等待你的确认",
                  pendingConfirm: confirmReqId
                    ? {
                        requestId: confirmReqId,
                        question: payload.data?.question ?? "是否确认执行？",
                        agentId: eventAgentId,
                        sessionId: requestSessionId,
                        context: payload.data?.context,
                      }
                    : undefined,
                });
                addSubAgentEvent(eventAgentId, {
                  type: "confirm_required",
                  content: payload.data?.question ?? "等待确认",
                });
              }
              const ok = await onOpenConfirm(
                payload.data?.id ?? "",
                payload.data?.question ?? "是否确认执行？",
                payload.data?.context?.diff,
                eventAgentId,
                payload.data?.context
              );
              await fetch(`${apiBase}/api/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                body: JSON.stringify({
                  session_id: requestSessionId,
                  request_id: payload.data?.id,
                  approved: ok,
                  agent_id: eventAgentId,
                }),
              });
            }
            if (payload.type === "confirm_response") {
              if (eventAgentId !== "meta") {
                const approved = !!payload.data?.approved;
                updateSubAgent(eventAgentId, {
                  status: approved ? "running" : "cancelled",
                  currentAction: approved ? "确认通过，继续执行" : "确认拒绝，执行终止",
                  pendingConfirm: undefined,
                });
                addSubAgentEvent(eventAgentId, {
                  type: "confirm_response",
                  content: approved ? "确认通过" : "确认拒绝",
                });
              }
            }
            if (payload.type === "subagent_started") {
              const subId = payload.data?.agent_id;
              console.debug("[ChatPane] SSE subagent_started", subId, "sessionId:", requestSessionId);
              if (subId) {
                const isDelegation = Boolean(payload.data?.delegation);
                const avatarSessionId =
                  (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim()) || "";
                addSubAgent({
                  id: subId,
                  name: payload.data?.name ?? subId,
                  role: payload.data?.role ?? (isDelegation ? "delegated avatar" : "worker"),
                  provider: payload.data?.provider ?? undefined,
                  model: payload.data?.model ?? undefined,
                  task: payload.data?.task ?? "",
                  sessionId: avatarSessionId || requestSessionId || undefined,
                });
                updateSubAgent(subId, {
                  status: "running",
                  currentAction: isDelegation ? "委派执行中" : "执行中",
                });
                addSubAgentEvent(
                  subId,
                  { type: isDelegation ? "delegation_started" : "started", content: isDelegation ? `已委派给 ${payload.data?.name ?? subId}` : "已启动" }
                );
                if (isDelegation && avatarSessionId && !isGroupPane) {
                  const dlgName = String(payload.data?.name ?? "").trim();
                  const dlgAvatarId = typeof payload.data?.avatar_id === "string" ? payload.data.avatar_id.trim() : "";
                  const store = useAppStore.getState();
                  const existingPane = store.panes.find((p) => {
                    if (p.avatarId && dlgAvatarId && p.avatarId === dlgAvatarId) return true;
                    return dlgName && (p.avatarName ?? "").trim().toLowerCase() === dlgName.toLowerCase();
                  });
                  if (existingPane) {
                    // Only sync session if the pane has no session yet (freshly opened).
                    // Never overwrite an active session — the delegation already runs
                    // in _find_or_create_avatar_session which reuses the avatar's existing session.
                  } else {
                    const newPaneId = addPane(dlgAvatarId || null, dlgName || subId, avatarSessionId);
                    setActivePaneId(newPaneId);
                  }
                }
              }
            }
            if (payload.type === "subagent_progress") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "执行中";
                updateSubAgent(subId, { currentAction: text });
                // Keep heartbeat visible in status line, but avoid flooding detail logs.
                if (!/^执行中（\d+s）/.test(text)) {
                  addSubAgentEvent(subId, { type: "progress", content: text });
                }
              }
            }
            if (payload.type === "subagent_checkpoint") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "阶段检查点";
                updateSubAgent(subId, { status: "running", currentAction: text });
                addSubAgentEvent(subId, { type: "checkpoint", content: text });
              }
            }
            if (payload.type === "subagent_paused") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "已暂停，等待指令";
                updateSubAgent(subId, { status: "running", currentAction: text });
                addSubAgentEvent(subId, { type: "paused", content: text });
              }
            }
            if (payload.type === "subagent_completed") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const isDelegation = Boolean(payload.data?.delegation);
                updateSubAgent(subId, {
                  status: "completed",
                  currentAction: isDelegation ? "委派完成（查看摘要）" : "已完成（查看摘要）",
                  resultSummary:
                    typeof payload.data?.summary === "string" ? payload.data.summary : undefined,
                  sessionId:
                    (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim())
                      || undefined,
                });
                addSubAgentEvent(
                  subId,
                  { type: isDelegation ? "delegation_completed" : "completed", content: payload.data?.summary ?? "完成" }
                );
              }
            }
            if (payload.type === "subagent_error") {
              const subId = payload.data?.agent_id;
              if (subId) {
                const text = payload.data?.text ?? "执行异常";
                const isDelegation = Boolean(payload.data?.delegation);
                updateSubAgent(subId, {
                  status: payload.data?.status === "cancelled" ? "cancelled" : "failed",
                  currentAction: text,
                  sessionId:
                    (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim())
                      || undefined,
                });
                addSubAgentEvent(subId, { type: isDelegation ? "delegation_error" : "error", content: text });
              }
            }
            if (payload.type === "final") {
              if (eventAgentId === "meta") {
                const finalText = String(payload.data?.text ?? "");
                const sqRaw = payload.data?.suggested_questions;
                pendingSuggestedQuestions = Array.isArray(sqRaw)
                  ? sqRaw.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 3)
                  : [];
                // Final payload is authoritative. Replacing (instead of merging) avoids
                // duplicate concatenation when token stream shape differs from final text.
                if (finalText.trim() && !isThinkingPlaceholderText(finalText)) {
                  full = finalText;
                  cumulativeFull = finalText;
                }
                scheduleStreamTextUpdate(full);
              } else {
                updateSubAgent(eventAgentId, { status: "completed", currentAction: "已完成" });
                addSubAgentEvent(eventAgentId, { type: "final", content: payload.data?.text ?? "" });
              }
            }
            if (payload.type === "token_usage") {
              const inp = Number(payload.data?.input_tokens ?? 0);
              const out = Number(payload.data?.output_tokens ?? 0);
              if (inp > 0 || out > 0) {
                useAppStore.getState().accumulatePaneTokens(pane.id, inp, out);
              }
            }
            if (payload.type === "error") {
              const errText = String(payload.data?.text ?? "未知错误");
              if (errText.includes("已达到最大工具调用轮数")) {
                const maxRounds = Number(payload.data?.max_rounds ?? 0) || 30;
                const rounds = Number(payload.data?.round ?? maxRounds);
                setExhaustedRounds({ rounds, maxRounds });
                setStallState("exhausted");
                addPaneMessageIfSessionActive(pane.id, "tool", errText, "meta");
              } else {
                addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
              }
            }
          } catch {
            // Ignore malformed frame.
          }
        }
      }

      const trimmedFull = full.trim();
      const sugExtras =
        pendingSuggestedQuestions.length > 0
          ? { suggestedQuestions: pendingSuggestedQuestions.slice(0, 3) }
          : undefined;
      if (trimmedFull && !isThinkingPlaceholderText(full) && !streamCommittedRef.current) {
        const mid = lastMidStreamAssistantCommitRef.current;
        if (mid !== null && trimmedFull === mid) {
          streamCommittedRef.current = true;
          if (sugExtras) {
            useAppStore.getState().mergeLastPaneMessageByRole(pane.id, "assistant", sugExtras);
          }
        } else {
          addPaneMessageIfSessionActive(
            pane.id,
            "assistant",
            full,
            "meta",
            chatProvider,
            chatModel,
            undefined,
            sugExtras,
          );
          streamCommittedRef.current = true;
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        addPaneMessageIfSessionActive(pane.id, "tool", `❌ 请求失败: ${String(error)}`, "meta");
      }
    } finally {
      delete sessionAbortControllersRef.current[requestSessionId];
      const ended = sessionStreamStateRef.current[requestSessionId];
      if (ended) {
        ended.active = false;
        ended.text = "";
        sessionStreamStateRef.current[requestSessionId] = ended;
      }
      if ((pane.sessionId || "").trim() === requestSessionId) {
        syncStreamingUiForCurrentSession();
      }
      abortRef.current = null;
      cancelStreamRenderFrame();
      streamTextRef.current = "";
      streamCommittedRef.current = false;
      setGroupTyping({});
      setContextFiles({});
      useAppStore.getState().bumpSessionCatalogRevision();
      window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 500);

      const nextQueued = useAppStore.getState().dequeuePaneMessage(pane.id);
      if (nextQueued) {
        requestAnimationFrame(() => {
          void sendChatRef.current(nextQueued.text, {
            retryAttachments: nextQueued.attachments,
          });
        });
      }
    }
  };

  sendChatRef.current = sendChat;

  const forwardAutoReply = useAppStore((s) => s.forwardAutoReply);
  useEffect(() => {
    if (!forwardAutoReply) return;
    if (forwardAutoReply.paneId !== paneId) return;
    if ((pane.sessionId || "").trim() !== forwardAutoReply.sessionId.trim()) return;
    useAppStore.getState().setForwardAutoReply(null);
    void sendChatRef.current(forwardAutoReply.text, {
      suppressUserEcho: true,
      skipUserHistory: true,
    });
  }, [forwardAutoReply, paneId, pane.sessionId]);

  const initSession = async (inherit = false, prevSessionId?: string) => {
    const avatarId =
      pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
    try {
      const result = await window.agenticxDesktop.createSession({
        avatar_id: avatarId,
        ...(inherit && prevSessionId ? { inherit_from_session_id: prevSessionId } : {}),
      });
      if (result.ok && result.session_id) {
        setPaneSessionId(pane.id, result.session_id);
        clearPaneAwaitingFreshSession(pane.id);
        if (result.inherited) {
          setPaneContextInherited(pane.id, true);
        }
        useAppStore.getState().bumpSessionCatalogRevision();
        window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 450);
        return;
      }
      console.error("[ChatPane] createSession returned error:", result.error);
    } catch (err) {
      console.error("[ChatPane] createSession threw:", err);
    }
    clearPaneAwaitingFreshSession(pane.id);
    if (prevSessionId) {
      setPaneSessionId(pane.id, prevSessionId);
      setPaneContextInherited(pane.id, false);
    }
    addPaneMessage(pane.id, "tool", "⚠️ 会话创建失败，已恢复上一会话。请检查后端服务是否正常。", "meta");
  };

  const createNewTopic = (inherit = true) => {
    const prevSessionId = (pane.sessionId || "").trim();
    clearPaneMessages(pane.id);
    setPaneContextInherited(pane.id, false);
    // Mark this pane as explicitly awaiting a brand-new session, so
    // WorkspacePanel's auto-restore effect will not snap it back to the
    // previously-running session (which would trap new messages in the
    // running session's queue).
    markPaneAwaitingFreshSession(pane.id);
    setPaneSessionId(pane.id, "");
    setPaneLazyInheritParent(pane.id, inherit && prevSessionId ? prevSessionId : undefined);
    // Defer server createSession until the user sends the first message so an
    // empty session never appears in the history sidebar with an id-only title.
  };

  const maxTaskspaceWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.4)) : 480;
  const minTaskspaceWidth = 220;
  const maxSpawnsWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.42)) : 420;
  const minSpawnsWidth = 220;
  const maxHistoryWidth = paneWidth > 0 ? Math.max(220, Math.floor(paneWidth * 0.35)) : 360;
  const minHistoryWidth = 200;

  useEffect(() => {
    setTaskspaceWidth((prev) => Math.min(maxTaskspaceWidth, Math.max(minTaskspaceWidth, prev)));
  }, [maxTaskspaceWidth]);

  useEffect(() => {
    setSpawnsWidth((prev) => Math.min(maxSpawnsWidth, Math.max(minSpawnsWidth, prev)));
  }, [maxSpawnsWidth]);

  useEffect(() => {
    setHistoryWidth((prev) => Math.min(maxHistoryWidth, Math.max(minHistoryWidth, prev)));
  }, [maxHistoryWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASKSPACE_WIDTH_STORAGE_KEY, String(taskspaceWidth));
    } catch {
      // ignore storage access failures
    }
  }, [taskspaceWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SPAWNS_WIDTH_STORAGE_KEY, String(spawnsWidth));
    } catch {
      // ignore storage access failures
    }
  }, [spawnsWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem("agx-history-width-v1", String(historyWidth));
    } catch {
      // ignore
    }
  }, [historyWidth]);

  const startResizeHistory = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = historyWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.max(minHistoryWidth, Math.min(maxHistoryWidth, startWidth + delta));
      setHistoryWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };


  const startResizeTaskspace = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = taskspaceWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.max(minTaskspaceWidth, Math.min(maxTaskspaceWidth, startWidth + delta));
      setTaskspaceWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResizeSpawns = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = spawnsWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.max(minSpawnsWidth, Math.min(maxSpawnsWidth, startWidth + delta));
      setSpawnsWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const cancelPaneSubAgent = async (agentId: string) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, { status: "cancelled", currentAction: "用户请求中断..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: targetSessionId, agent_id: agentId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "cancel", content: "已发送中断请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "cancelled", currentAction: "中断请求失败（后端未找到该任务）" });
      addSubAgentEvent(agentId, { type: "error", content: `中断请求失败: ${String(err)}` });
    }
  };

  const retryPaneSubAgent = async (agentId: string) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, { status: "pending", currentAction: "正在重试..." });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: targetSessionId, agent_id: agentId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "retry", content: "已发送重试请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "failed", currentAction: "重试失败" });
      addSubAgentEvent(agentId, { type: "error", content: `重试失败: ${String(err)}` });
    }
  };

  const resolvePaneSubAgentConfirm = async (agentId: string, approved: boolean) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    if (!sub?.pendingConfirm) return;
    const targetSessionId = (sub.pendingConfirm.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, {
      status: approved ? "running" : "cancelled",
      currentAction: approved ? "确认通过，继续执行" : "确认拒绝，执行终止",
      pendingConfirm: undefined,
    });
    addSubAgentEvent(agentId, {
      type: "confirm_response",
      content: approved ? "用户确认通过" : "用户确认拒绝",
    });
    try {
      await fetch(`${apiBase}/api/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: targetSessionId,
          request_id: sub.pendingConfirm.requestId,
          approved,
          agent_id: agentId,
        }),
      });
    } catch {
      // confirm POST failure is non-fatal for UI
    }
  };

  async function resolveGroupInlineConfirm(confirm: PendingConfirm, approved: boolean) {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const targetSessionId = (confirm.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    setPaneMessages(
      pane.id,
      visibleMessages.map((msg) => {
        if (msg.inlineConfirm?.requestId !== confirm.requestId) return msg;
        return { ...msg, inlineConfirm: undefined };
      })
    );
    addPaneMessage(
      pane.id,
      "tool",
      `${confirm.agentId}：${approved ? "确认通过，继续执行" : "确认拒绝，执行终止"}`,
      confirm.agentId,
      chatProvider,
      chatModel
    );
    try {
      await fetch(`${apiBase}/api/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: targetSessionId,
          request_id: confirm.requestId,
          approved,
          agent_id: confirm.agentId,
        }),
      });
    } catch {
      // confirm POST failure is non-fatal for UI
    }
  }

  const paneTint = (() => {
    if (!pane.avatarId) return undefined;
    if (pane.avatarId.startsWith("group:")) {
      const rawId = pane.avatarId.slice(6);
      const idx = groups.findIndex((g) => g.id === rawId);
      if (idx >= 0) {
        // reuse GROUP_TINT colors in same order as groupColorByIndex
        const GROUP_TINT_LIST = [
          "rgba(99,102,241,0.07)",   // indigo
          "rgba(20,184,166,0.07)",   // teal
          "rgba(236,72,153,0.07)",   // pink
          "rgba(132,204,22,0.07)",   // lime
          "rgba(239,68,68,0.07)",    // red
          "rgba(59,130,246,0.07)",   // blue
          "rgba(234,179,8,0.07)",    // yellow
          "rgba(168,85,247,0.07)",   // purple
        ];
        return GROUP_TINT_LIST[idx % GROUP_TINT_LIST.length];
      }
    }
    return avatarTintBg(pane.avatarId);
  })();

  return (
    <div
      ref={paneRef}
      className={`agx-chatpane flex h-full min-w-0 flex-1 ${focusMode ? "agx-chatpane--focus" : ""}`}
      style={!focusMode && paneTint ? { backgroundColor: paneTint } : undefined}
      onMouseDown={onFocus}
    >
      <div
        className={`agx-chatpane-main-column flex h-full min-w-0 flex-1 flex-col ${
          focusComposerOnly ? "agx-chatpane-main-column--focus-empty" : ""
        }`}
        style={{ minWidth: 280 }}
      >
        <div className="agx-pane-toolbar flex h-10 shrink-0 items-center justify-between px-4">
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden ${
              paneSortableListeners ? "cursor-grab touch-none active:cursor-grabbing" : ""
            }`}
            {...(paneSortableListeners ?? {})}
            title={paneSortableListeners ? "拖拽以调整窗格顺序" : undefined}
          >
            {paneSortableListeners ? (
              <GripVertical
                className="h-4 w-4 shrink-0 text-text-faint opacity-50 hover:opacity-90"
                strokeWidth={1.8}
                aria-hidden
              />
            ) : null}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 truncate text-sm font-medium text-text-strong">
                {paneAvatarMeta.name}
                {shouldShowFeishuBadge && (
                  <FeishuBadge variant="topbar" />
                )}
                {shouldShowWechatBadge && (
                  <span
                    className="inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium leading-tight"
                    style={{ backgroundColor: "rgba(37,211,102,0.15)", color: "#25D366" }}
                  >
                    微信
                  </span>
                )}
              </div>
              {visibleMessages.length > 0 || pane.contextInherited ? (
                <div className="flex items-center gap-1.5 truncate text-[10px] text-text-faint">
                  {visibleMessages.length > 0 && (
                    <span className="rounded bg-surface-card px-1 text-text-subtle">
                      {visibleMessages.length} 条
                    </span>
                  )}
                  {pane.contextInherited && (
                    <span className="rounded bg-emerald-500/20 px-1 text-emerald-400">已继承</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            {isGroupPane && (
              <button
                className={`agx-topbar-btn !px-[5px] ${pane.membersPanelOpen ? "agx-topbar-btn--active" : ""}`}
                onClick={() => cycleSidePanel(pane.id, "members")}
                title="切换群成员面板"
              >
                <Users className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            )}
            <button
              className={`agx-topbar-btn !px-[5px] ${workspacePanelOpen ? "agx-topbar-btn--active" : ""}`}
              onClick={() => cycleSidePanel(pane.id, "workspace")}
              title="切换工作区面板"
            >
              <FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            {paneSubAgents.length > 0 ? (
              <button
                className={`agx-topbar-btn !px-[5px] ${pane.spawnsColumnOpen ? "agx-topbar-btn--active" : ""}`}
                onClick={() => {
                  if (pane.spawnsColumnOpen) {
                    dismissSpawnsColumn(
                      pane.id,
                      paneSubAgents.map((s) => s.id)
                    );
                  } else {
                    setSpawnsColumnOpen(pane.id, true);
                  }
                }}
                title={pane.spawnsColumnOpen ? "收起 Spawns 列" : "打开 Spawns 列"}
              >
                <Bot className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            ) : null}
            <button
              className={`agx-topbar-btn !px-[5px] ${pane.historyOpen ? "agx-topbar-btn--active" : ""}`}
              onClick={() => togglePaneHistory(pane.id)}
              title="切换历史面板"
            >
              <History className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            <button
              className="agx-topbar-btn !px-[5px] hover:text-status-error"
              onClick={closePaneAndCleanupEmptySession}
              title="关闭窗格"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div
          ref={listRef}
          className="agx-pane-message-list relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3"
        >
          {focusComposerOnly ? null : !pane.sessionId && (isGroupPane || isAutomationTaskPane) ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-text-faint">
              <span className="animate-pulse">正在初始化会话...</span>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => void initSession(false)}
              >
                重试
              </button>
            </div>
          ) : (!pane.sessionId && !isGroupPane && !isAutomationTaskPane) ||
            (pane.sessionId && visibleMessages.length === 0) ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center text-xs">
              <img
                src={machiEmptyState}
                alt="Machi Empty State"
                className="w-[13.2rem] max-w-[42vw] select-none opacity-[0.85] theme-invert-logo"
                draggable={false}
              />
              <div className="space-y-1.5 select-none">
                <div className="text-[15px] font-medium text-text-primary tracking-wide">
                  Machi
                </div>
                <div className="text-text-faint tracking-wider uppercase text-[11px]">
                  Orchestrated by Machi · Executed by AgenticX
                </div>
              </div>
              {isAutomationTaskPane && automationTaskErrorHint ? (
                <div className="max-w-md rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-rose-200/95">
                  <div className="mb-1 font-medium text-rose-300">上次定时执行失败</div>
                  {automationTaskErrorHint}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mx-auto min-w-0 w-full max-w-4xl space-y-2">
              {renderedMessages}
            </div>
          )}
          <Toast
            placement="inline-bottom-center"
            variant="warning"
            open={attachToastOpen}
            message={VISION_UNSUPPORTED_TOAST}
            onClose={() => setAttachToastOpen(false)}
            timeoutMs={3200}
          />
        </div>

        {/* 收藏 Toast：位于消息列表与输入框之间，水平居中 */}
        {favoriteToastOpen && (
          <div className="pointer-events-none flex justify-center px-4 pb-1 pt-1">
            <div className="rounded-lg border border-border bg-surface-card/95 px-3 py-2 text-xs text-text-primary shadow-lg backdrop-blur-sm">
              {favoriteToastMsg}
            </div>
          </div>
        )}

        {/* 外层 px 与列表 agx-pane-message-list 一致，内层 max-w-4xl 单独一层，避免「padding 吃进 max-width」导致输入框比气泡窄一截 */}
        <div className="shrink-0 px-4 pt-2.5 pb-4">
          <div className="agx-pane-composer-shell mx-auto min-w-0 w-full max-w-4xl">
          {selectedSubAgent ? (
            <div className="mb-1 inline-flex items-center gap-2 rounded border border-border bg-surface-card px-2 py-0.5 text-xs text-text-muted">
              对话目标: {selectedSubAgent}
              <button
                className="rounded px-1 hover:bg-surface-hover"
                onClick={() => setSelectedSubAgent(null)}
              >
                切回 Meta
              </button>
            </div>
          ) : null}
          {quoteTarget ? (
            <div className="mb-1 flex items-center gap-2 rounded border border-border bg-surface-card px-2 py-1 text-xs text-text-muted">
              <span className="truncate">
                引用 {quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}:{" "}
                {quoteTarget.body.slice(0, 80)}
              </span>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={() => setQuoteTarget(null)}>取消</button>
            </div>
          ) : null}
          {selectedMessageIds.size > 0 ? (
            <div className="mb-1 flex items-center gap-2 rounded border border-border bg-surface-card px-2 py-1 text-xs text-text-muted">
              <span>已多选 {selectedMessageIds.size} 条</span>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={forwardSelectedMessages}>转发</button>
              <button
                className="rounded px-1 hover:bg-surface-hover"
                onClick={async () => {
                  const merged = selectedMessages
                    .map((message) => {
                      const name = message.role === "user" ? "我" : message.avatarName || message.agentId || "AI";
                      const time = message.timestamp
                        ? new Date(message.timestamp).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "";
                      return `[${name}]${time ? ` ${time}` : ""}\n${messagePlainTextForClipboard(message)}`;
                    })
                    .join("\n\n");
                  try {
                    await navigator.clipboard.writeText(merged);
                  } catch {
                    // ignore clipboard failures
                  }
                }}
              >
                复制
              </button>
              <button className="rounded px-1 hover:bg-surface-hover text-rose-300" onClick={() => void deleteSelectedMessages()}>
                删除
              </button>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={() => setSelectedMessageIds(new Set())}>取消</button>
            </div>
          ) : null}
          <div className="agx-pane-composer-body agx-theme-focus-ring relative rounded-2xl border border-border bg-surface-card transition-all duration-300 ease-out">
            {visibleAttachmentEntries.length > 0 ? (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {visibleAttachmentEntries.map(([key, file]) => (
                  <AttachmentChip key={key} file={file} onRemove={() => removeAttachment(key)} />
                ))}
              </div>
            ) : null}
            <div className="relative">
              <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-2">
                {composerExpanded ? (
                  <span className="text-xs text-text-faint">↩ 键可用于换行</span>
                ) : null}
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-xl text-text-faint/55 outline-none transition hover:bg-surface-hover hover:text-text-strong focus:outline-none focus-visible:bg-surface-hover focus-visible:text-text-strong"
                  aria-label={composerExpanded ? "收起输入区" : "展开输入区"}
                  title={composerExpanded ? "收起输入区（Enter 发送）" : "展开输入区（Enter 换行）"}
                  onClick={() => setComposerExpanded((prev) => !prev)}
                >
                  {composerExpanded ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                      <path d="M9 5H5v4M15 5h4v4M5 15v4h4M19 15v4h-4" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                      <path d="M15 5h4v4M9 5H5v4M5 15v4h4M19 15v4h-4" />
                    </svg>
                  )}
                </button>
              </div>
              <div
                ref={composerRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                const value = extractComposerText();
                setInput(value);
                updateAtStateFromText(value);
              }}
              onCompositionStart={() => {
                imeComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                window.setTimeout(() => {
                  imeComposingRef.current = false;
                }, 0);
              }}
              onBlur={() => {
                imeComposingRef.current = false;
              }}
              onPaste={(e) => {
                const dt = e.clipboardData;
                const raw = extractClipboardImageFiles(dt);
                const plainText = clipboardPlainTextForPaste(dt);

                if (raw.length > 0) {
                  if (isKnownNonVisionChatModel(chatProvider, chatModel)) {
                    e.preventDefault();
                    setAttachToastOpen(true);
                    return;
                  }
                  e.preventDefault();
                  const files = withClipboardImageNames(raw);
                  if (plainText) {
                    document.execCommand("insertText", false, plainText);
                    const value = extractComposerText();
                    setInput(value);
                    updateAtStateFromText(value);
                  }
                  for (const file of files) {
                    const key = `${file.name}:${file.size}:${file.lastModified}`;
                    parseLocalFile(file, key);
                  }
                  return;
                }

                // 无图片：禁止默认 HTML 粘贴，只插入纯文本，避免黑底/字体等富文本样式。
                if (!plainText.trim()) return;
                e.preventDefault();
                document.execCommand("insertText", false, plainText);
                const value = extractComposerText();
                setInput(value);
                updateAtStateFromText(value);
              }}
              onKeyDown={(e) => {
                const isImeComposing =
                  e.nativeEvent.isComposing ||
                  imeComposingRef.current ||
                  e.key === "Process" ||
                  e.keyCode === 229;
                if (isImeComposing) return;
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
                  e.preventDefault();
                  void createNewTopic(true);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  if (atOpen && atCandidates.length > 0) {
                    e.preventDefault();
                    const first = atCandidates[0];
                    setAtOpen(false);
                    setAtQuery("");
                    if (first.kind === "avatar") {
                      const mention = `@${first.label} `;
                      const base = extractComposerText();
                      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                      setComposerText(next);
                      return;
                    }
                    if (first.kind === "taskspace") {
                      const mention = `@${first.label} `;
                      const base = extractComposerText();
                      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                      setComposerText(next);
                      void addTaskspaceAliasReference(first.taskspaceId, first.alias, first.path);
                    } else {
                      const mention = `@${first.label} `;
                      const base = extractComposerText();
                      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                      setComposerText(next, { tokenNames: [first.label] });
                      void addContextFile(first.taskspaceId, first.path, { referenceToken: true });
                    }
                    return;
                  }
                  if (composerExpanded) {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      void sendChat(extractComposerText());
                    }
                    return;
                  }
                  e.preventDefault();
                  void sendChat(extractComposerText());
                }
              }}
              className={`agx-pane-composer-input block w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-0 pt-4 text-[15px] leading-relaxed text-text-primary outline-none ${
                // 收起时右侧留白需覆盖「展开输入」角标（absolute right-3 + w-8），pr-4 会导致首行末字与按钮重叠
                composerExpanded ? "max-h-[62vh] min-h-[260px] pr-40" : "max-h-[220px] min-h-[72px] pr-14"
              }`}
            />
            {input.trim().length === 0 ? (
              <div className="agx-pane-composer-placeholder pointer-events-none absolute left-4 top-4 text-[15px] text-text-faint">
                {focusMode ? "开始任务..." : "发消息..."}
              </div>
            ) : null}
            </div>
            <div className="agx-pane-composer-actions flex min-w-0 items-center justify-between gap-1 px-2.5 pb-2.5 pt-1">
              <div className="flex shrink-0 items-center gap-0.5">
                {focusMode ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                    onClick={exitFocusMode}
                    title="展开回主界面 (⇧⌘F)"
                    aria-label="展开回主界面"
                  >
                    <Expand className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </button>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files) return;
                    let showedVisionToast = false;
                    for (const file of Array.from(files)) {
                      if (isImageFile(file) && isKnownNonVisionChatModel(chatProvider, chatModel)) {
                        if (!showedVisionToast) {
                          setAttachToastOpen(true);
                          showedVisionToast = true;
                        }
                        continue;
                      }
                      const key = `${file.name}:${file.size}:${file.lastModified}`;
                      parseLocalFile(file, key);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                  title="上传附件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <NewTopicSplitControl onNewTopic={createNewTopic} />
                <SkillPickerButton
                  apiBase={apiBase}
                  apiToken={apiToken}
                  onSelect={(skill) => {
                    const el = composerRef.current;
                    if (!el) return;
                    const skillToken = createSkillRefToken(skill.name);
                    const space = document.createTextNode(" ");
                    // Insert at current caret or append to end
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
                      const range = sel.getRangeAt(0);
                      range.deleteContents();
                      range.insertNode(space);
                      range.insertNode(skillToken);
                      range.setStartAfter(space);
                      range.setEndAfter(space);
                      sel.removeAllRanges();
                      sel.addRange(range);
                    } else {
                      el.appendChild(skillToken);
                      el.appendChild(space);
                      focusComposerEnd();
                    }
                    // Sync input state
                    setInput(extractComposerText());
                  }}
                />
                <div className="flex items-center">
                  <PaneKnowledgeRetrievalModeSwitch apiToken={apiToken} apiBase={apiBase} />
                </div>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text-muted"
                  title="更多"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden
                  >
                    <rect x="3" y="3" width="8" height="8" rx="1.5" />
                    <rect x="13" y="3" width="8" height="8" rx="1.5" />
                    <rect x="3" y="13" width="8" height="8" rx="1.5" />
                    <rect x="13" y="13" width="8" height="8" rx="1.5" />
                  </svg>
                </button>
              </div>
              {/* ── Team mode action bar (routing="team" only) ─────────── */}
              <div className="flex shrink-0 items-center gap-1.5">
                {isGroupPane && activeGroup?.routing === "team" && (
                  <div className="flex items-center gap-1 mr-1">
                    <button
                      className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-text-faint transition hover:bg-indigo-500/10 hover:text-indigo-400"
                      title="插入任务到队列"
                      onClick={() => {
                        const taskDesc = extractComposerText().trim();
                        if (taskDesc) {
                          void sendGroupTeamAction("add_task", { task_description: taskDesc });
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span className="hidden sm:inline">插入任务</span>
                    </button>
                    {isStreamingCurrentSession ? (
                      <button
                        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-amber-400 transition hover:bg-amber-500/10"
                        title="暂停团队任务"
                        onClick={() => void sendGroupTeamAction("pause")}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                        <span className="hidden sm:inline">暂停</span>
                      </button>
                    ) : null}
                  </div>
                )}
                <PaneModelPicker paneId={pane.id} />
                <ActionCircleButton
                  hasInput={!!pane.sessionId && (!!input.trim() || readyAttachments.length > 0)}
                  streaming={canInterruptCurrentSession || isRunGuardCurrentSession}
                  recording={recording}
                  onSend={() => {
                    void sendChat(extractComposerText());
                  }}
                  onMic={onMicClick}
                  onStop={stopCurrentRun}
                />
              </div>
            </div>
          </div>
          {atOpen ? (
            <div className="mt-1 max-h-28 overflow-y-auto rounded border border-border bg-surface-panel p-1 backdrop-blur-xl">
              {atCandidates.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-text-faint">
                  未找到匹配对象{atQuery ? `: ${atQuery}` : ""}
                </div>
              ) : (
                atCandidates.map((item) => (
                  <button
                    key={
                      item.kind === "avatar"
                        ? `avatar:${item.avatarId}`
                        : `${item.kind}:${item.taskspaceId}:${item.path}`
                    }
                    className="block w-full rounded px-2 py-1 text-left text-[11px] text-text-muted hover:bg-surface-hover"
                    onClick={() => {
                      setAtOpen(false);
                      setAtQuery("");
                      if (item.kind === "avatar") {
                        const mention = `@${item.label} `;
                        const base = extractComposerText();
                        const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                        setComposerText(next);
                        return;
                      }
                      if (item.kind === "taskspace") {
                        const mention = `@${item.label} `;
                        const base = extractComposerText();
                        const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                        setComposerText(next);
                        void addTaskspaceAliasReference(item.taskspaceId, item.alias, item.path);
                      } else {
                        const mention = `@${item.label} `;
                        const base = extractComposerText();
                        const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) => `${text.startsWith(" ") ? " " : ""}${mention}`);
                        setComposerText(next, { tokenNames: [item.label] });
                        void addContextFile(item.taskspaceId, item.path, { referenceToken: true });
                      }
                    }}
                  >
                    {item.kind === "avatar"
                      ? `👤 ${item.label}${item.role ? ` · ${item.role}` : ""}`
                      : item.kind === "taskspace"
                      ? `📁 ${item.label} → ${item.path}`
                      : item.path}
                  </button>
                ))
              )}
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {isGroupPane && pane.membersPanelOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整面板宽度"
          >
            <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90" style={{ borderColor: "var(--ui-accent-divider-hover)" }} />
          </div>
          <GroupMembersSidePanel
            groupId={groupChatId}
            avatarList={avatars}
            metaLeaderLabel={metaLeaderDisplayName}
            onClose={() => cycleSidePanel(pane.id, "members")}
          />
        </div>
      ) : null}
      {workspacePanelOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整工作区面板宽度"
          >
            <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90" style={{ borderColor: "var(--ui-accent-divider-hover)" }} />
          </div>
          <WorkspacePanel
            paneId={pane.id}
            sessionId={pane.sessionId}
            activeTaskspaceId={pane.activeTaskspaceId}
            onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
            autoRefreshKey={taskspaceAutoRefreshKey}
            onClose={() => cycleSidePanel(pane.id, "workspace")}
            tintColor={paneTint}
            onPickFileForReference={(path) => {
              if (!pane.activeTaskspaceId) return;
              void addContextFile(pane.activeTaskspaceId, path, { referenceToken: true });
              const fileName = path.split(/[\\/]/).pop() || path;
              const mention = `@${fileName}`;
              const base = extractComposerText();
              const trimmed = base.trimEnd();
              const sep = !trimmed || /\s$/.test(base) ? "" : " ";
              const next = `${base}${sep}${mention} `;
              setComposerText(next, { tokenNames: [fileName] });
            }}
          />
        </div>
      ) : null}
      {pane.spawnsColumnOpen ? (
        <SpawnsColumn
          width={spawnsWidth}
          sessionId={pane.sessionId || undefined}
          subAgents={paneSubAgents}
          selectedSubAgent={selectedSubAgent}
          onResizeStart={startResizeSpawns}
          onClose={() => dismissSpawnsColumn(pane.id, paneSubAgents.map((s) => s.id))}
          onCancel={(agentId) => void cancelPaneSubAgent(agentId)}
          onRetry={(agentId) => void retryPaneSubAgent(agentId)}
          onChat={(agentId) => {
            const sub = paneSubAgents.find((item) => item.id === agentId);
            const isDelegation = agentId.startsWith("dlg-") || !!(sub?.events?.some((evt) => evt.type.startsWith("delegation")));
            if (isDelegation) {
              void openDelegatedAvatarSession(agentId);
              return;
            }
            setSelectedSubAgent(agentId);
          }}
          onSelect={(agentId) => setSelectedSubAgent(agentId)}
          onConfirmResolve={(agentId, approved) => void resolvePaneSubAgentConfirm(agentId, approved)}
          tintColor={paneTint}
        />
      ) : null}
      {pane.historyOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: historyWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeHistory}
            title="拖拽调整历史面板宽度"
          >
            <div className="mx-auto h-full w-px transition" style={{ background: "var(--ui-accent-divider)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90" style={{ borderColor: "var(--ui-accent-divider-hover)" }} />
          </div>
          <HistoryPanelBoundary key={`hpb-${pane.id}-${pane.historyOpen}`}>
            <SessionHistoryPanel pane={pane} onClose={() => togglePaneHistory(pane.id)} tintColor={paneTint} />
          </HistoryPanelBoundary>
        </div>
      ) : null}
      <ForwardPicker
        open={forwardPickerOpen}
        currentSessionId={pane.sessionId}
        currentAvatarId={pane.avatarId}
        avatars={avatars}
        groups={groups}
        onClose={() => {
          setForwardPickerOpen(false);
          setPendingForwardMessages([]);
        }}
        onConfirm={async (targetPayload, followUpNote) => {
          await executeForward(targetPayload, followUpNote);
          setSelectedMessageIds(new Set());
        }}
      />
    </div>
  );
}
