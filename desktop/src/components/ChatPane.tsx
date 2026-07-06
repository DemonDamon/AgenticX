import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import type { ErrorInfo, ReactNode, MouseEvent as ReactMouseEvent, CSSProperties } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  Database,
  GitBranch,
  GripVertical,
  LayoutList,
  Quote,
  Search,
  Share2,
  Forward,
  Sparkles,
  Radar,
  SquarePen,
  Wrench,
  Users,
  FolderOpen,
  PhoneCall,
  Bot,
  Boxes,
  History,
  X,
  PanelRightClose,
  ArrowRight,
  Loader2,
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
import {
  appendDictationText,
  cancelDictation,
  startDictation,
  type SttPhase,
} from "../voice/stt";
import { useVoicePushToTalk } from "../hooks/useVoicePushToTalk";
import { VoicePttOverlay } from "./VoicePttOverlay";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import { MemoryGraphPanel } from "./memory/MemoryGraphPanel";
import { StickyTaskBar } from "./StickyTaskBar";
import { WorkspacePanel } from "./WorkspacePanel";
import type { WorkspacePreviewOpenRequest, WorkspacePreviewQuotePayload } from "./workspace/workspace-preview-types";
import { SpawnsColumn } from "./SpawnsColumn";
import { SubAgentRunDrawer } from "./subagent";
import { MessageRenderer, renderToolMessageExtras } from "./messages/MessageRenderer";
import type { SkillPatchPreviewPayload } from "./messages/skill-manage-preview";
import { groupConsecutiveToolMessages, shouldHoldToolGroupProgress, type GroupedChatRow } from "./messages/group-tool-messages";
import {
  isEphemeralStopErrorText,
  isInterruptedAssistantPlaceholder,
} from "../utils/noisy-chat-messages";
import { HOOK_BLOCK_RE } from "../utils/hook-block-message";
import { expandMessagesToTopLevelRows } from "./messages/react-blocks";
import { isSubAgentLiveStatus, shouldHideStreamOverlay, shouldShowMidTurnStreamActivity } from "../utils/stream-overlay-policy";
import { flushSubAgentLiveOutput } from "../utils/subagent-live-output";
import { resolveSubAgentOutputPaths } from "../utils/subagent-output-files";
import { TurnToolGroupCard } from "./messages/TurnToolGroupCard";
import { WorkingIndicator } from "./messages/WorkingIndicator";
import { ChatImAvatar, ImBubble } from "./messages/ImBubble";
import { MessageTimestamp } from "./messages/MessageTimestamp";
import {
  ASSISTANT_ACTION_ICON_ROW_CLASS,
  ASSISTANT_ACTION_RHYTHM_END_CLASS,
  ASSISTANT_BODY_TAIL_CLASS,
  ASSISTANT_FOLLOWUP_CHIP_CLASS,
  ASSISTANT_FOLLOWUP_LIST_CLASS,
  getAssistantActionStyle,
} from "./messages/im-layout";
import { TerminalLine } from "./messages/TerminalLine";
import { ProviderIcon } from "./ProviderIcon";
import { CleanBlock } from "./messages/CleanBlock";
import { MessageQueuePanel } from "./messages/MessageQueuePanel";
import { StallRecoveryCard } from "./messages/StallRecoveryCard";
import { ForwardPicker, type ForwardConfirmPayload } from "./ForwardPicker";
import { HoverTip } from "./ds/HoverTip";
import { SkillPuzzleIcon, skillPuzzleIconInnerHtml } from "./icons/SkillPuzzleIcon";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  composerRefIconInnerHtml,
  resolveComposerRefIconKind,
} from "./icons/ComposerRefIcon";
import { Toast } from "./ds/Toast";
import { extractClipboardImageFiles, withClipboardImageNames } from "../utils/clipboard-images";
import { clipboardPlainTextForPaste } from "../utils/clipboard-plain-text";
import { isKnownNonVisionChatModel } from "../utils/model-vision";
import {
  canStopCurrentRun,
  isDoubleEnterWithinWindow,
  isStreamRunActiveForQueue,
  resolveQueueSessionKey,
  shouldEnqueueOnResend,
  shouldInterruptOnResend,
  shouldShowSessionWorkInProgress,
  shouldShowStopButton,
  type SessionExecutionState,
} from "../utils/streaming-stop-policy";
import { TURN_INTERRUPTED_TOAST, isTurnInterruptionNoticeMessage } from "../utils/turn-interruption-notice";
import {
  CHANNEL_C_GRACE_MS,
  stallDetectSilenceMs,
  isFutileResume,
  lastTurnHasCompletedAssistantReply,
  resolveSessionHealth,
  resolveSilenceTier,
  resolveSilenceTierLabel,
  sessionMessagesHydrated,
  shouldAllowStallAutoNudge,
  shouldResetStallDetectorsOnSessionSwitch,
  shouldSuppressStallDetection,
  shouldTriggerIncompleteEndStall,
  STALL_MODEL_FALLBACKS,
} from "../utils/task-stall-policy";
import {
  budgetExceededInfoFromPayload,
  findBudgetExceededInMessages,
  type BudgetExceededInfo,
} from "../utils/budget-exceeded";
import { buildBudgetResumeDraft } from "../utils/budget-resume-draft";
import {
  getCachedGlobalKbRetrievalMode,
  getKbRetrievalModeForPane,
  migratePaneKbRetrievalModeToSession,
  resolveDisplayKbRetrievalMode,
  resolveEffectiveKbRetrievalMode,
  setCachedGlobalKbRetrievalMode,
  setKbRetrievalModeForPane,
  type KbRetrievalMode,
} from "../utils/kb-retrieval-mode";
import {
  continueSessionUrl,
  inferContinueReason,
  type ContinueReason,
  type ContinueSource,
} from "../utils/session-continue";
import { mergeSessionMessagesTail } from "../utils/session-message-merge";
import { injectLiveSubAgentClusterAnchors } from "../utils/subagent-cluster-inline";
import { buildSubAgentFromRunRecord } from "../utils/subagent-hydrate";
import { fetchRunActivityPage, fetchRunDetail } from "./subagent/run-drawer-api";
import type { SubAgentRunRecord } from "./subagent/badge-vm";
import {
  enrichDiskMessagesWithInMemoryReferences,
  referencesDifferBetweenTails,
} from "../utils/session-reference-reconcile";
import { resolveReferencesForAssistant } from "../utils/turn-reference-context";
import { reattachSessionStreamUrl, parseSseFrame } from "../utils/session-reattach";
import {
  attachmentsFromSessionRow,
  mapLoadedSessionMessage,
  type LoadedSessionMessage,
} from "../utils/session-message-map";
import {
  findReferenceAttachmentMeta,
  isReferenceMentionBoundary,
  isWorkspaceReferenceAttachment,
  parseLineRangeFromReferenceLabel,
} from "../utils/reference-attachment";
import { isViewImageInjectMessage, viewImageInjectRowFromSession } from "../utils/view-image-inject";
import { resolveSessionTailForSwitch, invalidateSessionTail } from "../utils/session-tail-cache";
import { visibleMessagesForSession } from "../utils/message-ownership";
import {
  shouldDropDuplicateUserSend,
  shouldSuppressDuplicatePendingUserEcho,
  type SendDedupeEntry,
} from "../utils/send-dedupe";
import { resolveSendSessionId } from "../utils/send-lock";
import { StreamCommitRegistry } from "../utils/stream-commit-registry";
import { favoriteStorageMessageId } from "../utils/favorite-selection";
import { createResizeRafScheduler } from "../utils/resize-raf";
import { avatarTintBg } from "../utils/avatar-color";
import { formatModelOptionLabel } from "../utils/model-display";
import { collectSelectableModelOptions, coerceSelectableModel, isModelSelectable } from "../utils/model-options";
import { isAutomationPaneAvatarId } from "../utils/automation-pane";
import {
  ccBridgeSendToolProgressLabel,
  parseCcBridgeModeFromPayload,
  type CcBridgeSessionModeHint,
} from "../utils/cc-bridge-ui";
import type { AutomationTask } from "./automation/types";
import { parseReasoningContent } from "./messages/reasoning-parser";
import {
  getCachedReasoningDuration,
  measureReasoningSeconds,
  setCachedReasoningDuration,
} from "./messages/reasoning-duration-cache";
import { messagePlainTextForClipboard } from "../utils/markdown-copy-format";
import { buildMessagesPdfHtml } from "../utils/export-pdf-html";
import { buildCompactionNoticeText } from "../utils/context-notice";
import { usePaneSortableHandle } from "./pane-sortable-context";
import { FeishuBadge } from "./FeishuBadge";
import machiEmptyState from "../assets/machi-logo-transparent.png";
import { APP_DISPLAY_NAME, APP_TAGLINE, META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { isMetaLeaderIdentity, resolveMetaDisplayName } from "../utils/display-name";
import { createKbApi } from "./settings/knowledge/api";
import {
  clearPaneAwaitingFreshSession,
  clearPaneLazyInheritParent,
  clearPanePendingSessionMode,
  isPaneAwaitingFreshSession,
  markPaneAwaitingFreshSession,
  peekPaneLazyInheritParent,
  peekPanePendingSessionMode,
  setPaneLazyInheritParent,
  setPanePendingSessionMode,
  type PaneSessionMode,
} from "../utils/pane-fresh-session";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";
import { readScopedLocalStorage, writeScopedLocalStorage } from "../utils/backend-scope";
import {
  GLOBAL_SEARCH_REFERENCE_FILE,
  GLOBAL_SEARCH_WORKSPACE_ADDED,
  type GlobalSearchReferenceFileDetail,
} from "./global-search/global-search-events";
import {
  buildFileMentionAppend,
  buildComposerRefPathLookup,
  fileNameFromPath,
  formatReferenceChipLabel,
  formatReferencePathHint,
  lookupComposerRefPath,
  resolveReferenceSourcePath,
} from "../utils/chat-file-mention";
import { absoluteTaskspacePath } from "../utils/workspace-file-path";
import {
  composerAcceptsDragTypes,
  decodeNearWorkspaceDragEntry,
  NEAR_WORKSPACE_DRAG_MIME,
  type NearWorkspaceDragEntry,
} from "../utils/workspace-drag";
import {
  accumulateReferenceTurn,
  applyFinalReferencePayload,
  referenceExtrasFromTurn,
} from "../utils/search-reference-sse";
import { mergeSearchedQueries } from "../types/search-references";
import type { SearchReference } from "../types/search-references";
import {
  buildClarificationMessageExtras,
  findRunningClarificationToolMessage,
} from "../utils/clarification-inline";
import { parseClarificationDecisions } from "../utils/clarification-notice";

const SEARCH_REFERENCE_TOOLS = new Set(["web_search", "knowledge_search"]);

const SESSION_UNATTENDED_STORAGE_KEY = "agx-session-unattended-v1";

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
  return resolveMetaDisplayName(raw.toLowerCase() === "meta" ? null : raw);
}

function resolveGroupChatSender(
  message: Pick<Message, "role" | "avatarName" | "avatarUrl" | "agentId">,
  opts: {
    groupMembers: Avatar[];
    metaAvatarUrl: string;
    userLabel: string;
    userAvatarUrl: string;
  }
): { name: string; url?: string; avatarId?: string } {
  if (message.role === "user") {
    return {
      name: opts.userLabel.trim() || "用户",
      url: opts.userAvatarUrl.trim() || undefined,
    };
  }
  const agentId = String(message.agentId ?? "").trim();
  const rawName = String(message.avatarName ?? "").trim();
  if (isMetaLeaderIdentity(agentId, rawName)) {
    return {
      name: resolveMetaDisplayName(null),
      url: opts.metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL,
      avatarId: "meta",
    };
  }
  const url = String(message.avatarUrl ?? "").trim() || undefined;
  const member = agentId ? opts.groupMembers.find((a) => a.id === agentId) : undefined;
  if (member) {
    return {
      name: member.name || rawName || agentId,
      url: url || member.avatarUrl || undefined,
      avatarId: member.id,
    };
  }
  const name =
    rawName && rawName !== "分身" ? rawName : agentId || resolveMetaDisplayName(null);
  return { name, url, avatarId: agentId || undefined };
}

function shellSingleQuote(input: string): string {
  return `'${input.replace(/'/g, `'\"'\"'`)}'`;
}

const EMPTY_QUEUE: QueuedMessage[] = [];
const KB_RETRIEVAL_MODE_OPTIONS: { value: "auto" | "always"; label: string }[] = [
  { value: "auto", label: "智能检索" },
  { value: "always", label: "始终检索" },
];

/** 多分窗下仅看窗口宽度不可靠：按单窗格可视宽度切换到「侧栏抽屉」模式（对齐左侧主导航 overlay，不并排挤压会话区）。 */
const CHATPANE_SIDE_OVERLAY_BREAK = 760;

/** 程序化展开工作区：窄窗格时与其它侧栏互斥，避免并排挤压。 */
function openWorkspaceSidebarForPane(
  paneId: string,
  paneOuterWidthPx: number,
  openSidePanel: (paneId: string, tab: "workspace" | "members") => void,
) {
  const compact =
    paneOuterWidthPx > 0 && paneOuterWidthPx < CHATPANE_SIDE_OVERLAY_BREAK;
  if (!compact) {
    openSidePanel(paneId, "workspace");
    return;
  }
  useAppStore.setState((s) => ({
    panes: s.panes.map((row) =>
      row.id !== paneId
        ? row
        : {
            ...row,
            taskspacePanelOpen: true,
            sidePanelTab: "workspace",
            historyOpen: false,
            memoryGraphOpen: false,
            membersPanelOpen: false,
            spawnsColumnOpen: false,
          },
    ),
  }));
}

const FALLBACK_PANE: ChatPaneState = {
  id: "fallback-pane",
  avatarId: null,
  avatarName: META_AGENT_DISPLAY_NAME,
  sessionId: "",
  modelProvider: "",
  modelName: "",
  messages: [],
  historyOpen: false,
  memoryGraphOpen: false,
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
  loadingMessages: false,
  oldestLoadedIndex: 0,
  hasOlderMessages: false,
  loadingOlderMessages: false,
  runDrawerOpen: false,
  runDrawerRunId: null,
};

/** Compose-style primary action (豆包式「撰写」语义) + 下拉切换「全新对话」/「继承上下文」，默认前者。 */
function NewTopicSplitControl({
  onNewTopic,
}: {
  onNewTopic: (inherit: boolean, sessionMode?: PaneSessionMode) => void;
}) {
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
            onClick={() => onNewTopic(inheritMode, inheritMode ? "daily_office" : "daily_office")}
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
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong";

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
                      <SkillPuzzleIcon className="h-3 w-3" />
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
          <SkillPuzzleIcon className="h-[15px] w-[15px]" />
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

/** Viewport-safe fixed positioning for pane bottom model pill dropdown (portal). */
const PANE_MODEL_PICKER_MARGIN = 8;
const PANE_MODEL_PICKER_GAP = 4;
const PANE_MODEL_PICKER_MIN_MAX_HEIGHT = 64;
const PANE_MODEL_PICKER_PANEL_WIDTH = 280;

function paneModelPickerPanelStyle(anchor: DOMRect): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const panelWidth = Math.min(PANE_MODEL_PICKER_PANEL_WIDTH, vw - PANE_MODEL_PICKER_MARGIN * 2);

  let left = anchor.left;
  if (left + panelWidth > vw - PANE_MODEL_PICKER_MARGIN) {
    left = vw - PANE_MODEL_PICKER_MARGIN - panelWidth;
  }
  if (left < PANE_MODEL_PICKER_MARGIN) {
    left = PANE_MODEL_PICKER_MARGIN;
  }

  const spaceAbove = anchor.top - PANE_MODEL_PICKER_MARGIN - PANE_MODEL_PICKER_GAP;
  const spaceBelow = vh - anchor.bottom - PANE_MODEL_PICKER_MARGIN - PANE_MODEL_PICKER_GAP;
  const preferAbove = spaceAbove >= 120 || spaceAbove >= spaceBelow;

  if (preferAbove) {
    const maxHeight = Math.max(PANE_MODEL_PICKER_MIN_MAX_HEIGHT, Math.floor(spaceAbove));
    return {
      left,
      width: panelWidth,
      maxHeight,
      bottom: vh - anchor.top + PANE_MODEL_PICKER_GAP,
      top: "auto",
      right: "auto",
    };
  }

  const maxHeight = Math.max(PANE_MODEL_PICKER_MIN_MAX_HEIGHT, Math.floor(spaceBelow));
  return {
    left,
    width: panelWidth,
    maxHeight,
    top: anchor.bottom + PANE_MODEL_PICKER_GAP,
    bottom: "auto",
    right: "auto",
  };
}

/** Viewport-safe fixed positioning for the 历史对话 anchored popover (workbuddy-style, not a persistent side column). */
const HISTORY_POPOVER_MARGIN = 8;
const HISTORY_POPOVER_GAP = 6;
const HISTORY_POPOVER_WIDTH = 360;
const HISTORY_POPOVER_MIN_MAX_HEIGHT = 240;
const HISTORY_POPOVER_MAX_HEIGHT_CAP = 560;

function historyPanelPopoverStyle(anchor: DOMRect): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const panelWidth = Math.min(HISTORY_POPOVER_WIDTH, vw - HISTORY_POPOVER_MARGIN * 2);

  // History button sits at the top-right of the pane toolbar; align the popover's
  // right edge with the button's right edge so it opens toward the pane, not off-screen.
  let left = anchor.right - panelWidth;
  if (left + panelWidth > vw - HISTORY_POPOVER_MARGIN) {
    left = vw - HISTORY_POPOVER_MARGIN - panelWidth;
  }
  if (left < HISTORY_POPOVER_MARGIN) {
    left = HISTORY_POPOVER_MARGIN;
  }

  const spaceAbove = anchor.top - HISTORY_POPOVER_MARGIN - HISTORY_POPOVER_GAP;
  const spaceBelow = vh - anchor.bottom - HISTORY_POPOVER_MARGIN - HISTORY_POPOVER_GAP;
  const preferAbove = spaceAbove >= HISTORY_POPOVER_MIN_MAX_HEIGHT && spaceAbove > spaceBelow;

  // 用 maxHeight（而非确定 height）让浮层按内容自然撑高、内容较少时不留空白；容器本身是
  // flex 列（display:flex + flexDirection:column），标题/搜索区 shrink-0 固定不动，
  // 只有内部会话列表区（flex-1 min-h-0 overflow-y-auto）随内容超限时滚动——flex 的
  // 弹性分配机制在"容器高度来自 max-height clamp"时依然是确定值，不依赖百分比高度解析，
  // 因此不会出现"限高但滚动条不出现"的问题。
  if (preferAbove) {
    const maxHeight = Math.min(
      HISTORY_POPOVER_MAX_HEIGHT_CAP,
      Math.max(HISTORY_POPOVER_MIN_MAX_HEIGHT, Math.floor(spaceAbove))
    );
    return {
      left,
      width: panelWidth,
      maxHeight,
      display: "flex",
      flexDirection: "column",
      bottom: vh - anchor.top + HISTORY_POPOVER_GAP,
      top: "auto",
      right: "auto",
    };
  }

  const maxHeight = Math.min(
    HISTORY_POPOVER_MAX_HEIGHT_CAP,
    Math.max(HISTORY_POPOVER_MIN_MAX_HEIGHT, Math.floor(spaceBelow))
  );
  return {
    left,
    width: panelWidth,
    maxHeight,
    display: "flex",
    flexDirection: "column",
    top: anchor.bottom + HISTORY_POPOVER_GAP,
    bottom: "auto",
    right: "auto",
  };
}

function PaneModelPicker({ paneId }: { paneId: string }) {
  const settings = useAppStore((s) => s.settings);
  const setPaneModel = useAppStore((s) => s.setPaneModel);
  const paneModel = useAppStore((s) => s.panes.find((pane) => pane.id === paneId));
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

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

  const options = useMemo(
    () => collectSelectableModelOptions(settings.providers),
    [settings.providers],
  );

  const currentProvider = (paneModel?.modelProvider || "").trim();
  const currentModel = (paneModel?.modelName || "").trim();
  const currentLabel = useMemo(() => {
    if (!currentModel) return "未选模型";
    if (!currentProvider) return currentModel;
    if (!isModelSelectable(currentProvider, currentModel, settings.providers)) {
      return "未选模型";
    }
    const entry = settings.providers[currentProvider];
    return formatModelOptionLabel(currentProvider, currentModel, entry);
  }, [currentModel, currentProvider, settings.providers]);

  const syncPanelPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPanelStyle(paneModelPickerPanelStyle(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncPanelPosition();
    const onReflow = () => syncPanelPosition();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, syncPanelPosition, options.length]);

  return (
    <div className="relative min-w-0 max-w-full" ref={anchorRef}>
      <button
        type="button"
        className="flex h-8 min-h-8 max-w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] font-normal leading-relaxed text-[color:var(--chat-im-assistant-text)] transition hover:bg-surface-hover"
        onClick={() => setOpen((v) => !v)}
        title={currentLabel}
      >
        <ProviderIcon provider={currentProvider} className="h-[13px] w-[13px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{currentLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div
              className="fixed z-40 overflow-y-auto rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
              style={panelStyle}
            >
              {options.length === 0 ? (
                <div className="px-3 py-3 text-center text-[13px] font-normal leading-relaxed text-[color:var(--chat-im-assistant-text)]">
                  请先在设置中配置模型
                </div>
              ) : (
                options.map((opt) => {
                  const isActive = opt.provider === currentProvider && opt.model === currentModel;
                  return (
                    <button
                      key={`${opt.provider}:${opt.model}`}
                      type="button"
                      className={`group flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 pr-3 text-left text-[13px] font-normal leading-relaxed text-[color:var(--chat-im-assistant-text)] transition-colors ${
                        isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                      }`}
                      title={opt.label}
                      onClick={() => handleSelect(opt.provider, opt.model)}
                    >
                      <span className="flex flex-1 items-center gap-2">
                        <ProviderIcon provider={opt.provider} className="h-[13px] w-[13px] shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      </span>
                      <span className="flex w-4 shrink-0 justify-end">
                        {isActive && <Check className="h-[13px] w-[13px] text-[color:var(--chat-im-assistant-text)]" strokeWidth={2} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function PaneKnowledgeRetrievalModeSwitch({
  apiToken,
  apiBase,
  sessionId,
  paneId,
  globalDefaultMode,
  onNewSessionDefaultChange,
}: {
  apiToken: string;
  apiBase: string;
  sessionId: string;
  paneId: string;
  globalDefaultMode: KbRetrievalMode;
  onNewSessionDefaultChange?: (mode: KbRetrievalMode) => void;
}) {
  const resolveApiBase = useCallback(async () => {
    const base = String(apiBase ?? "").trim();
    if (base) return base.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [apiBase]);
  const api = useMemo(() => createKbApi(apiToken, resolveApiBase), [apiToken, resolveApiBase]);
  const [mode, setMode] = useState<KbRetrievalMode>(() =>
    resolveDisplayKbRetrievalMode(sessionId, paneId, globalDefaultMode),
  );
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const refreshGenRef = useRef(0);

  // Sync toolbar icon immediately when session/pane/global default changes —
  // never wait for async readConfig (avoids 2–3s flash of the previous session mode).
  useLayoutEffect(() => {
    setMode(resolveDisplayKbRetrievalMode(sessionId, paneId, globalDefaultMode));
  }, [sessionId, paneId, globalDefaultMode]);

  const refresh = useCallback(async () => {
    const sid = String(sessionId || "").trim();
    const pid = String(paneId || "").trim();
    const gen = ++refreshGenRef.current;
    try {
      const body = await api.readConfig();
      if (gen !== refreshGenRef.current) return;
      const resolvedDefault =
        body.config.retrieval?.mode === "always" ? "always" : "auto";
      setCachedGlobalKbRetrievalMode(resolvedDefault);
      onNewSessionDefaultChange?.(resolvedDefault);
      setMode(resolveDisplayKbRetrievalMode(sid, pid, resolvedDefault));
    } catch {
      setMode(resolveDisplayKbRetrievalMode(sid, pid, globalDefaultMode));
    }
  }, [api, globalDefaultMode, onNewSessionDefaultChange, paneId, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveMode = useCallback(
    async (nextMode: KbRetrievalMode) => {
      if (saving) return;
      const sid = String(sessionId || "").trim();
      const pid = String(paneId || "").trim();
      if (!pid && !sid) return;
      const previous = mode;
      // Invalidate any in-flight refresh so global config cannot overwrite
      // the choice the user just made.
      refreshGenRef.current += 1;
      setMode(nextMode);
      setSaving(true);
      try {
        // Bind the choice to this session (or lazy pane pending slot before first send).
        setKbRetrievalModeForPane(sid, pid, nextMode);
      } catch {
        setMode(previous);
      } finally {
        setSaving(false);
      }
    },
    [mode, paneId, saving, sessionId],
  );

  return (
    <div className="relative">
      <HoverTip label={`知识库检索模式：${KB_RETRIEVAL_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? "智能检索"}`}>
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
          disabled={saving}
          onClick={() => setOpen((v) => !v)}
          aria-label="知识库检索模式"
        >
          {mode === "auto" ? (
            <Sparkles className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
          ) : (
            <Radar className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
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
  transcribing?: boolean;
  onSend: () => void;
  onMic: () => void;
  onStop: () => void;
};

function ActionCircleButton({
  hasInput,
  streaming,
  recording,
  transcribing = false,
  onSend,
  onMic,
  onStop,
}: ActionCircleButtonProps) {
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
    filled = true;
  } else if (hasInput) {
    onClick = onSend;
    title = "发送";
    icon = <SendIcon />;
    filled = true;
  } else if (transcribing) {
    onClick = onMic;
    title = "识别中";
    icon = (
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    );
    filled = false;
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
        filled ? "" : "text-text-muted hover:text-text-strong"
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
  const pathHint =
    isReferenceToken && file.sourcePath ? formatReferencePathHint(file.sourcePath) : "";
  return (
    <div
      className={`group relative inline-flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
        isReferenceToken
          ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
          : "border-border bg-surface-card hover:bg-surface-hover"
      }`}
      style={{ maxWidth: "320px" }}
      title={file.sourcePath ? resolveReferenceSourcePath(file.name, file.sourcePath) : undefined}
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
          <div className="truncate text-xs text-sky-200/80 mt-0.5">
            {pathHint ? `@ ${pathHint}` : "@ 文件引用"}
          </div>
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
  onOpenClarification?: (
    requestId: string,
    prompt: string,
    options: string[],
    allowFreeText: boolean,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<{ answerText: string; selectedOptions: string[] } | null>;
  /** Direct inline submit for the clarification card (non-blocking) */
  onSubmitClarification?: (
    requestId: string,
    answer: { answerText: string; selectedOptions: string[] },
    sessionId?: string,
    agentId?: string
  ) => Promise<boolean> | boolean;
};

function ModelBadge({ provider, model }: { provider?: string; model?: string }) {
  const providers = useAppStore((s) => s.settings.providers);
  if (!model) return null;
  const entry = provider ? providers[provider] : undefined;
  const label = provider ? formatModelOptionLabel(provider, model, entry) : model;
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

function formatToolResultMessage(toolNameRaw: unknown, resultRaw: unknown, providers?: Record<string, import("../utils/provider-display").ProviderDisplayEntry>): { content: string; silent: boolean } {
  const toolName = String(toolNameRaw ?? "tool");
  const resultText = String(resultRaw ?? "");
  if (toolName === "check_resources") {
    return { content: "", silent: true };
  }
  if (toolName === "show_widget") {
    return { content: resultText, silent: false };
  }
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
      const providerEntry = provider && providers ? providers[provider] : undefined;
      const modelLabel = provider && model
        ? ` · ${formatModelOptionLabel(provider, model, providerEntry)}`
        : "";
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
  // Hook-blocked tool calls should be treated as errors, not done
  if (HOOK_BLOCK_RE.test(t)) return "error";
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
const RUN_DRAWER_WIDTH_STORAGE_KEY = "agenticx:run-drawer-width";
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
  /** @工作区别名：输入框 @提及文案与 chip 用短名，附件标题仍用 `name`（如 @dir:…） */
  composerRefLabel?: string;
  lineRange?: { start: number; end: number };
  spreadsheetRef?: { sheet: string; a1: string };
  snippetRef?: string;
  snippetContent?: string;
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

/** Office/PDF documents the frontend cannot parse inline; backend skills (liteparse/docx) handle them via absolute path. */
function isReferenceableDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".pdf"].some((ext) => lower.endsWith(ext));
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

function buildContextFileKeyFromAttachment(
  file: Pick<MessageAttachment, "sourcePath" | "name" | "lineRange" | "spreadsheetRef" | "snippetRef">
): string {
  const base = String(file.sourcePath || file.name || "").trim();
  if (!base) return "";
  const line = file.lineRange;
  if (line && Number.isFinite(line.start) && Number.isFinite(line.end)) {
    const start = Math.max(1, Math.floor(line.start));
    const end = Math.max(start, Math.floor(line.end));
    return `${base}:${start}-${end}`;
  }
  const sheet = file.spreadsheetRef?.sheet?.trim();
  const a1 = file.spreadsheetRef?.a1?.trim();
  if (sheet && a1) {
    return `${base}#${sheet}!${a1}`;
  }
  const snippetRef = String(file.snippetRef || "").trim();
  if (snippetRef) {
    return `${base}:${snippetRef}`;
  }
  return base;
}

function canonicalMentionFromAttachment(
  file: Pick<MessageAttachment, "sourcePath" | "name" | "lineRange" | "spreadsheetRef" | "snippetRef">
): string {
  const key = buildContextFileKeyFromAttachment(file);
  return key ? `@${key}` : "";
}

function rewriteUserReferenceMentions(text: string, attachments: MessageAttachment[]): string {
  const records = attachments
    .map((att) => {
      const label = String(att.composerRefLabel || att.name || "").trim();
      const canonical = canonicalMentionFromAttachment(att);
      return { label, canonical };
    })
    .filter((row) => row.label.length > 0 && row.canonical.length > 0)
    .sort((a, b) => b.label.length - a.label.length);
  if (!records.length) return text;
  let cursor = 0;
  let out = "";
  while (cursor < text.length) {
    const at = text.indexOf("@", cursor);
    if (at < 0) {
      out += text.slice(cursor);
      break;
    }
    out += text.slice(cursor, at);
    const rest = text.slice(at + 1);
    const matched = records.find((row) => {
      if (!rest.startsWith(row.label)) return false;
      const after = rest.slice(row.label.length);
      return isReferenceMentionBoundary(after);
    });
    if (!matched) {
      out += "@";
      cursor = at + 1;
      continue;
    }
    out += matched.canonical;
    cursor = at + 1 + matched.label.length;
  }
  return out;
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

export function ChatPane({ paneId, focused, onFocus, onOpenConfirm, onOpenClarification, onSubmitClarification }: Props) {
  const pane = useAppStore((s) => s.panes.find((item) => item.id === paneId) ?? FALLBACK_PANE);
  const paneSortableListeners = usePaneSortableHandle();
  const panes = useAppStore((s) => s.panes);
  const metaLeaderDisplayName = useMemo(() => {
    const mp = panes.find((p) => p.avatarId === null);
    return resolveMetaDisplayName(mp?.avatarName);
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
  const togglePaneMemoryGraph = useAppStore((s) => s.togglePaneMemoryGraph);
  const cycleSidePanel = useAppStore((s) => s.cycleSidePanel);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const openSidePanel = useAppStore((s) => s.openSidePanel);
  const openDeliveryPanel = useAppStore((s) => s.openDeliveryPanel);
  const addPaneTerminalTab = useAppStore((s) => s.addPaneTerminalTab);
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);
  const addPaneMessage = useAppStore((s) => s.addPaneMessage);
  const updatePaneMessageByToolCallId = useAppStore((s) => s.updatePaneMessageByToolCallId);
  const clearPaneMessages = useAppStore((s) => s.clearPaneMessages);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneSessionMode = useAppStore((s) => s.setPaneSessionMode);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const prependPaneMessages = useAppStore((s) => s.prependPaneMessages);
  const setPaneMessagePaging = useAppStore((s) => s.setPaneMessagePaging);
  const setPaneLoadingMessages = useAppStore((s) => s.setPaneLoadingMessages);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneContextInherited = useAppStore((s) => s.setPaneContextInherited);
  const toolRoundCount = useMemo(
    () => (pane.messages ?? []).filter((m) => m.role === "tool" && (m.toolName ?? "").trim()).length,
    [pane.messages]
  );
  const toolRoundBudget = 60;
  const queuedMessages = useAppStore((s) => s.pendingMessages[paneId] ?? EMPTY_QUEUE);
  const enqueuePaneMessage = useAppStore((s) => s.enqueuePaneMessage);
  const takePendingMessage = useAppStore((s) => s.takePendingMessage);
  const removePendingMessage = useAppStore((s) => s.removePendingMessage);
  const editPendingMessage = useAppStore((s) => s.editPendingMessage);
  const setSpawnsColumnOpen = useAppStore((s) => s.setSpawnsColumnOpen);
  const dismissSpawnsColumn = useAppStore((s) => s.dismissSpawnsColumn);
  const closeRunDrawer = useAppStore((s) => s.closeRunDrawer);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const kbGlobalDefaultInit = getCachedGlobalKbRetrievalMode() ?? "auto";
  const kbNewSessionDefaultRef = useRef<KbRetrievalMode>(kbGlobalDefaultInit);
  const [kbGlobalDefaultMode, setKbGlobalDefaultMode] =
    useState<KbRetrievalMode>(kbGlobalDefaultInit);
  const onKbNewSessionDefaultChange = useCallback((mode: KbRetrievalMode) => {
    kbNewSessionDefaultRef.current = mode;
    setKbGlobalDefaultMode(mode);
    setCachedGlobalKbRetrievalMode(mode);
  }, []);

  useEffect(() => {
    if (!apiToken) return;
    const resolveBase = async () => {
      const base = String(apiBase ?? "").trim();
      if (base) return base.replace(/\/+$/, "");
      const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
      return raw.replace(/\/+$/, "");
    };
    const kbApi = createKbApi(apiToken, resolveBase);
    let cancelled = false;
    void (async () => {
      try {
        const body = await kbApi.readConfig();
        if (cancelled) return;
        const mode = body.config.retrieval?.mode === "always" ? "always" : "auto";
        kbNewSessionDefaultRef.current = mode;
        setKbGlobalDefaultMode(mode);
        setCachedGlobalKbRetrievalMode(mode);
      } catch {
        // keep cached / auto
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiToken]);
  const storeActiveProvider = useAppStore((s) => s.activeProvider);
  const storeActiveModel = useAppStore((s) => s.activeModel);
  const settings = useAppStore((s) => s.settings);
  const setPaneModel = useAppStore((s) => s.setPaneModel);
  const reconcilePaneModels = useAppStore((s) => s.reconcilePaneModels);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);
  const { chatProvider, chatModel } = useMemo(() => {
    const pp = (pane?.modelProvider ?? "").trim();
    const pm = (pane?.modelName ?? "").trim();
    const rawProvider = pp || storeActiveProvider;
    const rawModel = pm || storeActiveModel;
    const coerced = coerceSelectableModel(
      settings.providers,
      rawProvider,
      rawModel,
      rawProvider,
    );
    if (!coerced) return { chatProvider: "", chatModel: "" };
    return { chatProvider: coerced.provider, chatModel: coerced.model };
  }, [pane?.modelProvider, pane?.modelName, storeActiveProvider, storeActiveModel, settings.providers]);

  useEffect(() => {
    const pp = (pane?.modelProvider ?? "").trim();
    const pm = (pane?.modelName ?? "").trim();
    if (!pp || !pm) return;
    if (isModelSelectable(pp, pm, settings.providers)) return;
    reconcilePaneModels();
  }, [pane?.modelProvider, pane?.modelName, settings.providers, reconcilePaneModels]);
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
  const userBubbleLabel = useMemo(() => userNickname.trim() || "我", [userNickname]);
  const groupChatUserLabel = useMemo(() => userNickname.trim() || "用户", [userNickname]);
  const isGroupPane = Boolean(pane?.avatarId?.startsWith("group:"));
  /** 元智能体窗格：顶栏已展示当前模型，气泡内不再重复展示模型徽章 */
  const isMachiMetaPane = pane.avatarId === null;
  const isAutomationTaskPane = isAutomationPaneAvatarId(pane?.avatarId);
  /** 单聊分身：对话区不展示「厂商/模型」徽章；群聊保留；定时任务不展示（任务本身已绑定模型，避免干扰） */
  const isDedicatedAvatarPane =
    Boolean(pane?.avatarId) && !isGroupPane && !isAutomationTaskPane;
  const showInlineAssistantModelBadge =
    !isMachiMetaPane && !isDedicatedAvatarPane && !isAutomationTaskPane;
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
  const resolveGroupSender = useCallback(
    (message: Pick<Message, "role" | "avatarName" | "avatarUrl" | "agentId">) =>
      resolveGroupChatSender(message, {
        groupMembers,
        metaAvatarUrl: metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL,
        userLabel: groupChatUserLabel,
        userAvatarUrl: userAvatarUrl || "",
      }),
    [groupMembers, groupChatUserLabel, metaAvatarUrl, userAvatarUrl]
  );
  const workspacePanelOpen = !!pane?.taskspacePanelOpen;
  const [pendingWorkspacePreviewRequest, setPendingWorkspacePreviewRequest] =
    useState<WorkspacePreviewOpenRequest | null>(null);

  const paneAvatarMeta = useMemo(() => {
    const aid = pane?.avatarId;
    if (!aid) {
      // avatarId 为空即为 Near 窗格；勿依赖 avatarName===「Near」才给 meta 头像（飞书绑定曾错误写入「分身」）
      const paneName = (pane?.avatarName ?? "").trim();
      const name = resolveMetaDisplayName(paneName);
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
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceInputHint, setVoiceInputHint] = useState("");
  const dictationSessionRef = useRef<{ stop: () => void; cancel: () => void } | null>(null);
  const [streamedAssistantText, setStreamedAssistantText] = useState("");
  const [streamReferences, setStreamReferences] = useState<SearchReference[]>([]);
  const [streamSearchedQueries, setStreamSearchedQueries] = useState<string[]>([]);
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [runGuardSessionId, setRunGuardSessionId] = useState("");
  const [streamingModel, setStreamingModel] = useState<{ provider: string; model: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionAbortControllersRef = useRef<Record<string, AbortController>>({});
  const sessionStreamStateRef = useRef<
    Record<string, { active: boolean; text: string; provider: string; model: string }>
  >({});
  const retryInFlightRef = useRef<Record<string, boolean>>({});
  /** Live-reattach (FR-4): per-session abort controllers for read-only reattach streams. */
  const reattachControllersRef = useRef<Record<string, AbortController>>({});
  const liveReattachEnabledRef = useRef(false);
  /** RAF mirror for the currently displayed session's stream overlay only. */
  const streamTextRef = useRef("");
  const streamCommitRegistryRef = useRef(new StreamCommitRegistry());
  const [stallState, setStallState] = useState<"none" | "stall" | "exhausted">("none");
  // Distinguish a stall caused by an actively-running-but-silent turn ("silent")
  // from one where the turn already ENDED without producing a visible reply
  // ("incomplete", e.g. think-only / degenerate). Drives non-misleading copy so
  // an ended-incomplete turn is never shown as "处理中 · 静默 Ns / 长时间无响应".
  const [stallReason, setStallReason] = useState<"silent" | "incomplete">("silent");
  const [stoppingSessionId, setStoppingSessionId] = useState("");
  const [exhaustedRounds, setExhaustedRounds] = useState<{ rounds: number; maxRounds: number } | null>(null);
  const [sessionExecutionState, setSessionExecutionState] = useState<SessionExecutionState>("idle");
  /** Per-session previous execution_state — keyed by sid so a running session's
   * "running" never leaks onto a sibling and triggers a false「后台任务已完成」. */
  const prevExecutionStateBySidRef = useRef<Record<string, SessionExecutionState>>({});
  const [stallTick, setStallTick] = useState(0);
  const [bgCompleteToast, setBgCompleteToast] = useState(false);
  const [stallHintToast, setStallHintToast] = useState("");
  const [stallRejectReason, setStallRejectReason] = useState("");
  const [resumeInFlight, setResumeInFlight] = useState(false);
  const resumeInFlightRef = useRef<Record<string, boolean>>({});
  const resumeInFlightTimerRef = useRef<number | null>(null);
  /** Mirrors stallState so SSE handlers can tell whether a recovery card is visible. */
  const stallStateRef = useRef<"none" | "stall" | "exhausted">("none");
  const [autoNudgeCount, setAutoNudgeCount] = useState(0);
  const autoNudgeTriggeredRef = useRef<Record<string, number>>({});
  const autoNudgeBucketRef = useRef<Record<string, number>>({});
  /** User clicked stop — do not re-show stall card until the next send/continue. */
  const userStoppedSessionRef = useRef<Record<string, boolean>>({});
  const stopInFlightRef = useRef<Record<string, boolean>>({});
  const [lastToolProgress, setLastToolProgress] = useState<{ name: string; sec: number } | null>(null);
  const [contextLoopStats, setContextLoopStats] = useState<{
    round: number;
    tool_result_tokens_session: number;
    archived_tool_calls: number;
  } | null>(null);
  const [stallRuntimeConfig, setStallRuntimeConfig] = useState({
    stall_detect_silence_seconds: 90,
    stall_auto_nudge_enabled: false,
    stall_auto_nudge_after_seconds: 120,
    stall_auto_nudge_max_per_session: 2,
  });
  const [unattendedGlobalEnabled, setUnattendedGlobalEnabled] = useState(false);
  const [unattendedMaxContinuations, setUnattendedMaxContinuations] = useState(20);
  const [unattendedStallContinueAfterSeconds, setUnattendedStallContinueAfterSeconds] = useState(120);
  const [unattendedContinueCount, setUnattendedContinueCount] = useState(0);
  const unattendedContinueTriggeredRef = useRef<Record<string, number>>({});
  const unattendedContinueBucketRef = useRef<Record<string, number>>({});
  // Tracks the id of the trailing "无人值守已停止" marker we've already reacted to
  // per session, so the auto-disable effect does not fight a later manual re-enable.
  const unattendedAutoStopAckRef = useRef<Record<string, string>>({});
  const [sessionUnattended, setSessionUnattended] = useState(false);
  const [budgetExceededInfo, setBudgetExceededInfo] = useState<BudgetExceededInfo | null>(null);
  const lastSseEventAtRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  /** Per-session SSE progress timestamps — survive pane display switches. */
  const sessionProgressAtRef = useRef<Record<string, number>>({});
  const sessionEnteredAtRef = useRef<Record<string, number>>({});
  /** Last session id whose transient stall detectors were baselined; used to
   * reset the silence clock / stallState only on a real displayed-session
   * switch (not on every effect re-run). */
  const lastStallBaselineSessionRef = useRef<string>("");
  const deferredSessionMessagesRef = useRef<Record<string, Array<Parameters<typeof addPaneMessage>>>>({});
  const lastComposerEnterAtRef = useRef(0);
  const streamRafRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollPinnedRef = useRef(true);
  const loadingOlderMessagesRef = useRef(false);
  const sessionBootstrapRef = useRef("");
  const sessionBootstrapInflightRef = useRef("");
  const sessionBootstrapAttemptRef = useRef(0);
  const [sessionBootstrapRetryNonce, setSessionBootstrapRetryNonce] = useState(0);
  const lastUserSendDedupeRef = useRef<SendDedupeEntry | null>(null);
  const sendChatInFlightRef = useRef<{ paneId: string; sessionId: string } | null>(null);
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
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
  const composerRefPathsRef = useRef<Record<string, string>>({});
  const composerRefTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRefTipTargetRef = useRef<HTMLElement | null>(null);
  const [composerRefTip, setComposerRefTip] = useState<{ path: string; x: number; y: number } | null>(null);
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
  const [runDrawerWidth, setRunDrawerWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(RUN_DRAWER_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // ignore storage access failures
    }
    return 360;
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
  /** 历史对话按钮 ref + 打开时的锚点位置，用于渲染 workbuddy 风格的浮层（不复用 historyWidth，浮层宽度固定）。 */
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const [historyAnchorRect, setHistoryAnchorRect] = useState<DOMRect | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  // 会话是否有过真实的用户轮——用于抑制「空会话孤立中断占位」。旧数据里可能残留
  // 一条无用户消息的 turn_interrupted（continuation 误触发在新会话上），不应展示为
  // 「恢复执行」卡，须保持「新会话」中性态（对齐后端 append 守卫）。
  const paneHasUserMessage = useMemo(
    () =>
      (pane?.messages ?? []).some(
        (m) => m.role === "user" && String(m.content ?? "").trim().length > 0
      ),
    [pane?.messages]
  );
  const visibleMessages = useMemo(
    () =>
      // Cross-session ownership invariant: never render a row that belongs to a
      // different session, even if a stray write landed in this pane's array
      // during a session switch. Untagged (legacy / in-flight) rows still show.
      visibleMessagesForSession(pane?.messages ?? [], pane?.sessionId).filter((item) => {
        if (isGroupPane) return true;
        if (item.role === "assistant" && isThinkingPlaceholderText(item.content || "")) return false;
        if (isInterruptedAssistantPlaceholder(item)) return false;
        if (!paneHasUserMessage && isTurnInterruptionNoticeMessage(item)) return false;
        return !item.agentId || item.agentId === "meta";
      }),
    [isGroupPane, paneHasUserMessage, pane?.messages, pane?.sessionId]
  );
  // Render-only list: inline the sub-agent cluster card into the conversation
  // flow (like the clarification card). Kept separate from `visibleMessages` so
  // selection/counts/last-assistant logic never sees the synthetic anchor row.
  const renderMessages = useMemo(
    () => (isGroupPane ? visibleMessages : injectLiveSubAgentClusterAnchors(visibleMessages)),
    [isGroupPane, visibleMessages]
  );
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveToolMessages(renderMessages),
    [renderMessages]
  );
  const isStreamingCurrentSession =
    streaming &&
    !isGroupPane &&
    !!streamingSessionId &&
    streamingSessionId === (pane.sessionId || "").trim();
  const streamTextForCurrentSession = isStreamingCurrentSession ? (streamedAssistantText || "") : "";
  const streamAssistantMessage = useMemo((): Message => {
    const sid = (pane.sessionId || "").trim();
    return {
      id: "__stream__",
      role: "assistant",
      content: streamTextForCurrentSession,
      ownerSessionId: sid || undefined,
      references: streamReferences.length > 0 ? streamReferences : undefined,
      searchedQueries: streamSearchedQueries.length > 0 ? streamSearchedQueries : undefined,
      provider: streamingModel?.provider,
      model: streamingModel?.model,
    };
  }, [
    pane.sessionId,
    streamTextForCurrentSession,
    streamReferences,
    streamSearchedQueries,
    streamingModel?.provider,
    streamingModel?.model,
  ]);
  /** Hide __stream__ when it duplicates committed text or is an empty mid-turn tool-gap placeholder. */
  const hideStreamOverlayAsDuplicate = useMemo(
    () =>
      shouldHideStreamOverlay(
        isStreamingCurrentSession,
        streamTextForCurrentSession,
        visibleMessages,
      ),
    [isStreamingCurrentSession, streamTextForCurrentSession, visibleMessages],
  );
  const midTurnStreamActivity = shouldShowMidTurnStreamActivity(
    isStreamingCurrentSession,
    hideStreamOverlayAsDuplicate,
  );
  const useReActImLayout = !isGroupPane && chatStyle === "im";
  const visibleMessagesWithStream = useMemo(() => {
    if (useReActImLayout && isStreamingCurrentSession && !hideStreamOverlayAsDuplicate) {
      return [...renderMessages, streamAssistantMessage];
    }
    return renderMessages;
  }, [
    useReActImLayout,
    renderMessages,
    isStreamingCurrentSession,
    hideStreamOverlayAsDuplicate,
    streamAssistantMessage,
  ]);

  const topLevelRowsIm = useMemo(
    () => (useReActImLayout ? expandMessagesToTopLevelRows(visibleMessagesWithStream) : null),
    [useReActImLayout, visibleMessagesWithStream]
  );
  const flushJumpToBottomFab = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      setShowJumpToBottomFab(false);
      return;
    }
    autoScrollPinnedRef.current = isNearBottom(el);
    const overflow = el.scrollHeight > el.clientHeight + 4;
    setShowJumpToBottomFab(overflow && !isNearBottom(el));
  }, []);

  /** 灵巧模式退出后主界面 ChatPane remount，`flushJumpToBottomFab` 会在 scrollTop=0 时误判 unpinned；此处强制滚底一次。 */
  const focusExitScrollTarget = useAppStore((s) =>
    s.focusExitScrollBottomPaneId === paneId ? paneId : null
  );
  useLayoutEffect(() => {
    if (!focusExitScrollTarget) return;
    autoScrollPinnedRef.current = true;
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    useAppStore.getState().clearFocusExitScrollBottomPaneId();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        autoScrollPinnedRef.current = true;
        const inner = listRef.current;
        if (inner) {
          inner.scrollTop = inner.scrollHeight;
        }
        flushJumpToBottomFab();
      });
    });
  }, [focusExitScrollTarget, flushJumpToBottomFab]);

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
  const anchoredSubAgentRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of pane.messages ?? []) {
      const anchor = msg.subAgentCluster;
      if (!anchor) continue;
      for (const runId of anchor.runIds) {
        const rid = String(runId ?? "").trim();
        if (rid) ids.add(rid);
      }
    }
    return Array.from(ids);
  }, [pane.messages]);
  const drawerLiveSubAgent = useMemo(() => {
    const rid = String(pane.runDrawerRunId ?? "").trim();
    if (!rid) return undefined;
    return paneSubAgents.find((s) => s.id === rid);
  }, [pane.runDrawerRunId, paneSubAgents]);
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

  // 集群卡改为内联在对话流展示（对齐 Kimi Work / 澄清卡片语义），Spawns 列不再
  // 随派生自动弹出——仅作为可选的成员控制/明细面板，由工具栏按钮手动开启；这里
  // 只在没有子智能体时收起已开的列，保持整洁。
  useEffect(() => {
    if (paneSubAgents.length === 0 && pane.spawnsColumnOpen) {
      setSpawnsColumnOpen(pane.id, false);
    }
  }, [pane.id, pane.spawnsColumnOpen, paneSubAgents.length, setSpawnsColumnOpen]);
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
      // Never overwrite in-memory state while a foreground SSE stream is live —
      // that stream is the single source of truth and disk lags behind.
      if (sessionStreamStateRef.current[currentSid]?.active) return;
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
            if (!content && !rowAtts?.length && !viewImageInjectRowFromSession(item)) continue;
            const attSig =
              rowAtts?.length && rowAtts[0]?.dataUrl
                ? rowAtts[0].dataUrl.slice(0, 72)
                : "";
            const key = `${role}::${content.slice(0, 300)}::${attSig}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(mapLoadedSessionMessage(item as LoadedSessionMessage, `dlgpoll-${currentSid}`, idx, currentSid));
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
      // Re-read messages length from the store after the async awaits above —
      // the closure snapshot can be stale if addPaneMessage fired in the interim,
      // causing a spurious poll() that duplicates the optimistic user row.
      const freshMsgCount =
        useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages?.length ?? 0;
      if (!hasDelegation && !needsExternalPoll && freshMsgCount > 0) return;
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
    const onScrollOrResize = () => flushJumpToBottomFab();
    flushJumpToBottomFab();
    el.addEventListener("scroll", onScrollOrResize, { passive: true });
    const ro = new ResizeObserver(onScrollOrResize);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScrollOrResize);
      ro.disconnect();
    };
  }, [paneId, flushJumpToBottomFab]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current && autoScrollPinnedRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
      flushJumpToBottomFab();
    });
  }, [visibleMessages, streamedAssistantText, flushJumpToBottomFab]);

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
      dictationSessionRef.current?.cancel();
      dictationSessionRef.current = null;
      cancelDictation();
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

  /** Studio taskspace APIs require an existing session_id; lazy new-topic clears pane.sessionId until first send.
   * For read-only browsing (e.g. `@` mentions, file preview), fall back to the most recently
   * remembered session for this avatar so the user can still browse the same content the
   * WorkspacePanel keeps showing while awaiting a fresh session. */
  const resolveTaskspaceApiSessionId = (): string => {
    const sid = (pane.sessionId || "").trim();
    if (sid) return sid;
    if (!isGroupPane && !isAutomationTaskPane) {
      const lazy = String(peekPaneLazyInheritParent(pane.id) ?? "").trim();
      if (lazy) return lazy;
      const remembered = String(getRememberedSessionForAvatar(pane.avatarId) ?? "").trim();
      if (remembered) return remembered;
    }
    return "";
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

    const apiSessionId = resolveTaskspaceApiSessionId();
    if (!apiSessionId) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const wsResp = await window.agenticxDesktop.listTaskspaces(apiSessionId);
    if (!wsResp.ok || !Array.isArray(wsResp.workspaces) || wsResp.workspaces.length === 0) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    const activeId = pane.activeTaskspaceId && wsResp.workspaces.some((item) => item.id === pane.activeTaskspaceId)
      ? pane.activeTaskspaceId
      : wsResp.workspaces[0].id;
    if (!pane.activeTaskspaceId) setActiveTaskspace(pane.id, activeId);
    const rootResp = await window.agenticxDesktop.listTaskspaceFiles({
      sessionId: apiSessionId,
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
              sessionId: apiSessionId,
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

      openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
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
      setActiveTaskspace,
      openSidePanel,
      addPaneTerminalTab,
      paneWidth,
    ]
  );

  const triggerCcBridgeTailTerminal = useCallback(
    async (sessionId: string) => {
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
      openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);

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
    [pane.id, pane.sessionId, pane.activeTaskspaceId, apiBase, apiToken, openSidePanel, addPaneTerminalTab, paneWidth]
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

  useEffect(() => {
    const root = composerRef.current;
    if (!root) return;

    const clearComposerRefTipTimer = () => {
      if (composerRefTipTimerRef.current != null) {
        clearTimeout(composerRefTipTimerRef.current);
        composerRefTipTimerRef.current = null;
      }
    };

    const resolveComposerRefTipPath = (target: HTMLElement): string => {
      const fromAttr = target.getAttribute("data-source-path")?.trim();
      if (fromAttr) return fromAttr;
      const refName = target.getAttribute("data-ref-name")?.trim() || "";
      if (!refName) return "";
      const fromLookup = lookupComposerRefPath(composerRefPathsRef.current, refName);
      if (fromLookup) return fromLookup;
      const meta = findReferenceAttachmentMeta(
        refName,
        Object.entries(contextFiles).map(([key, file]) => ({
          ...file,
          sourcePath: file.sourcePath || key,
        }))
      );
      return resolveReferenceSourcePath(refName, meta?.sourcePath);
    };

    const showComposerRefTip = (target: HTMLElement) => {
      const path = resolveComposerRefTipPath(target);
      if (!path) return;
      target.setAttribute("data-source-path", path);
      target.title = path;
      composerRefTipTargetRef.current = target;
      const rect = target.getBoundingClientRect();
      setComposerRefTip({ path, x: rect.left + rect.width / 2, y: rect.top });
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.(
        '[data-ref-token="1"]'
      ) as HTMLElement | null;
      if (!target || !root.contains(target)) return;
      if (composerRefTipTargetRef.current === target && composerRefTipTimerRef.current != null) {
        return;
      }
      clearComposerRefTipTimer();
      composerRefTipTargetRef.current = target;
      composerRefTipTimerRef.current = setTimeout(() => showComposerRefTip(target), 280);
    };

    const onMouseOut = (event: MouseEvent) => {
      const from = (event.target as HTMLElement | null)?.closest?.(
        '[data-ref-token="1"]'
      ) as HTMLElement | null;
      if (!from) return;
      const to = (event.relatedTarget as HTMLElement | null)?.closest?.(
        '[data-ref-token="1"]'
      ) as HTMLElement | null;
      if (to && from === to) return;
      clearComposerRefTipTimer();
      composerRefTipTargetRef.current = null;
      setComposerRefTip(null);
    };

    root.addEventListener("mouseover", onMouseOver);
    root.addEventListener("mouseout", onMouseOut);
    return () => {
      root.removeEventListener("mouseover", onMouseOver);
      root.removeEventListener("mouseout", onMouseOut);
      clearComposerRefTipTimer();
      composerRefTipTargetRef.current = null;
      setComposerRefTip(null);
    };
  }, [composerExpanded, contextFiles, input, pane.id]);

  const patchComposerRefTokenPaths = useCallback(() => {
    const root = composerRef.current;
    if (!root) return;
    const lookup = buildComposerRefPathLookup(
      Object.entries(contextFiles).map(([key, file]) => ({
        key,
        name: file.name,
        sourcePath: file.sourcePath,
        composerRefLabel: file.composerRefLabel,
      })),
      composerRefPathsRef.current
    );
    composerRefPathsRef.current = lookup;
    root.querySelectorAll<HTMLElement>('[data-ref-token="1"]').forEach((node) => {
      const refName = String(node.getAttribute("data-ref-name") || "").trim();
      if (!refName) return;
      const sp = lookupComposerRefPath(lookup, refName);
      if (!sp) return;
      node.setAttribute("data-source-path", sp);
      node.title = sp;
    });
  }, [contextFiles]);

  useEffect(() => {
    patchComposerRefTokenPaths();
  }, [patchComposerRefTokenPaths, input, contextFiles]);

  const resolveRefMetaForLabel = useCallback(
    (label: string) => {
      const rows = Object.entries(contextFiles).map(([key, file]) => ({
        ...file,
        sourcePath: file.sourcePath || key,
      }));
      return findReferenceAttachmentMeta(label, rows);
    },
    [contextFiles]
  );

  const createFileRefToken = useCallback(
    (name: string, explicitSourcePath?: string) => {
      const meta = resolveRefMetaForLabel(name);
      const resolvedPath = resolveReferenceSourcePath(
        name,
        explicitSourcePath ||
          lookupComposerRefPath(composerRefPathsRef.current, name) ||
          meta?.sourcePath
      );
      const kind = resolveComposerRefIconKind(name, meta);
      const token = document.createElement("span");
      token.setAttribute("contenteditable", "false");
      token.setAttribute("data-ref-token", "1");
      token.setAttribute("data-ref-name", name);
      token.className = COMPOSER_INLINE_CHIP_CLASS;
      if (resolvedPath) {
        token.setAttribute("data-source-path", resolvedPath);
        token.title = resolvedPath;
        composerRefPathsRef.current[name] = resolvedPath;
      }
      const icon = document.createElement("span");
      icon.innerHTML = composerRefIconInnerHtml(kind, 13);
      token.appendChild(icon);
      const label = document.createElement("span");
      label.className = "min-w-0 truncate";
      const lineRange = meta?.lineRange ?? parseLineRangeFromReferenceLabel(name);
      label.textContent = formatReferenceChipLabel(name, resolvedPath, lineRange);
      token.appendChild(label);
      return token;
    },
    [resolveRefMetaForLabel]
  );

  const createSkillRefToken = useCallback((name: string) => {
    const token = document.createElement("span");
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-skill-token", "1");
    token.setAttribute("data-skill-name", name);
    token.className = COMPOSER_INLINE_CHIP_CLASS;
    const icon = document.createElement("span");
    icon.innerHTML = skillPuzzleIconInnerHtml(13);
    token.appendChild(icon);
    const label = document.createElement("span");
    label.className = "min-w-0 truncate";
    label.textContent = name;
    token.appendChild(label);
    return token;
  }, []);

  const setComposerText = useCallback(
    (value: string, options?: { tokenNames?: string[]; refSourcePaths?: Record<string, string> }) => {
      const el = composerRef.current;
      if (!el) {
        setInput(value);
        updateAtStateFromText(value);
        return;
      }
      composerRefPathsRef.current = buildComposerRefPathLookup(
        Object.entries(contextFiles).map(([key, file]) => ({
          key,
          name: file.name,
          sourcePath: file.sourcePath,
          composerRefLabel: file.composerRefLabel,
        })),
        { ...composerRefPathsRef.current, ...(options?.refSourcePaths ?? {}) }
      );
      const tokenNames = new Set<string>();
      for (const [, file] of Object.entries(contextFiles)) {
        if (file.referenceToken && file.name) tokenNames.add(file.name);
        if (file.composerRefLabel) tokenNames.add(file.composerRefLabel);
        if (file.sourcePath) tokenNames.add(file.sourcePath);
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
        // 与 extractComposerText 序列化一致：重建 skill 胶囊，避免仅重建 @file 时把 skill 降级成纯文本
        if (rest.startsWith("skill://")) {
          const afterPrefix = rest.slice("skill://".length);
          const skillMatch = afterPrefix.match(/^([^\s@,，。！？\n]+)/);
          if (skillMatch) {
            const slug = skillMatch[1];
            if (textBuffer) {
              el.appendChild(document.createTextNode(textBuffer));
              textBuffer = "";
            }
            el.appendChild(createSkillRefToken(slug));
            cursor += 1 + "skill://".length + slug.length;
            continue;
          }
        }
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
        el.appendChild(createFileRefToken(matched, lookupComposerRefPath(composerRefPathsRef.current, matched)));
        cursor += matched.length + 1;
      }
      if (textBuffer) {
        el.appendChild(document.createTextNode(textBuffer));
      }
      setInput(value);
      updateAtStateFromText(value);
      focusComposerEnd();
    },
    [contextFiles, createFileRefToken, createSkillRefToken, focusComposerEnd, updateAtStateFromText]
  );

  const addContextFile = async (
    taskspaceId: string,
    relPath: string,
    options?: { referenceToken?: boolean; composerRefLabel?: string }
  ): Promise<string | null> => {
    const apiSessionId = resolveTaskspaceApiSessionId();
    if (!apiSessionId || !relPath) return null;
    const fileResp = await window.agenticxDesktop.readTaskspaceFile({
      sessionId: apiSessionId,
      taskspaceId,
      path: relPath,
    });
    if (!fileResp.ok || typeof fileResp.content !== "string") return null;
    const key = String(fileResp.absolute_path || relPath);
    const content = (fileResp.content ?? "").slice(0, TEXT_ATTACHMENT_LIMIT);
    const composerRefLabel =
      String(options?.composerRefLabel || "").trim() ||
      key.split(/[\\/]/).pop() ||
      key;
    setContextFiles((prev) => ({
      ...prev,
      [key]: {
        name: key.split(/[\\/]/).pop() || key,
        size: content.length,
        mimeType: "text/plain",
        status: "ready",
        content,
        sourcePath: key,
        composerRefLabel: options?.referenceToken ? composerRefLabel : undefined,
        referenceToken: !!options?.referenceToken,
      },
    }));
    return key;
  };

  const addTaskspaceAliasReference = async (
    taskspaceId: string,
    alias: string,
    absolutePath: string,
    startRelPath = "."
  ) => {
    const apiSessionId = resolveTaskspaceApiSessionId();
    if (!apiSessionId) return;
    const queue: string[] = [startRelPath || "."];
    const visited = new Set<string>();
    const lines: string[] = [];
    let fileCount = 0;
    const maxFiles = 160;
    while (queue.length > 0 && fileCount < maxFiles) {
      const current = queue.shift() || ".";
      if (visited.has(current)) continue;
      visited.add(current);
      const listResp = await window.agenticxDesktop.listTaskspaceFiles({
        sessionId: apiSessionId,
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
        composerRefLabel: alias,
        referenceToken: true,
      },
    }));
  };

  const insertAtAutocompleteFileReference = useCallback(
    async (taskspaceId: string, relPath: string, label: string) => {
      const cleanLabel = String(label || relPath.split(/[\\/]/).pop() || "").trim();
      if (!taskspaceId || !relPath || !cleanLabel) return;
      const absKey = await addContextFile(taskspaceId, relPath, {
        referenceToken: true,
        composerRefLabel: cleanLabel,
      });
      const mention = `@${cleanLabel} `;
      const base = extractComposerText();
      const next = base.replace(/(?:^|\s)@[^\s@]*$/, (text) =>
        `${text.startsWith(" ") ? " " : ""}${mention}`
      );
      setComposerText(next, {
        tokenNames: [cleanLabel],
        ...(absKey ? { refSourcePaths: { [cleanLabel]: absKey } } : {}),
      });
      focusComposerEnd();
    },
    [addContextFile, extractComposerText, focusComposerEnd, setComposerText]
  );

  const insertWorkspaceFileReference = useCallback(
    async (taskspaceId: string, relPath: string) => {
      if (!taskspaceId || !relPath) return;
      const absKey = await addContextFile(taskspaceId, relPath, { referenceToken: true });
      const fileName = relPath.split(/[\\/]/).pop() || relPath;
      const { next, tokenNames } = buildFileMentionAppend(extractComposerText(), fileName);
      setComposerText(next, {
        tokenNames,
        ...(absKey ? { refSourcePaths: { [fileName]: absKey } } : {}),
      });
      focusComposerEnd();
    },
    [addContextFile, extractComposerText, focusComposerEnd, setComposerText]
  );

  const insertWorkspaceDirectoryReference = useCallback(
    async (taskspaceId: string, relPath: string, label: string) => {
      const apiSessionId = resolveTaskspaceApiSessionId();
      if (!apiSessionId || !taskspaceId) return;
      const cleanLabel = String(label || relPath.split(/[\\/]/).pop() || "folder").trim();
      const wsResp = await window.agenticxDesktop.listTaskspaces(apiSessionId);
      const ts = wsResp.workspaces?.find((item) => item.id === taskspaceId);
      if (!ts?.path) return;
      const abs = relPath === "." ? ts.path : absoluteTaskspacePath(ts.path, relPath);
      await addTaskspaceAliasReference(taskspaceId, cleanLabel, abs, relPath || ".");
      const { next, tokenNames } = buildFileMentionAppend(extractComposerText(), cleanLabel);
      setComposerText(next, { tokenNames });
      focusComposerEnd();
    },
    [addTaskspaceAliasReference, extractComposerText, focusComposerEnd, setComposerText]
  );

  const insertWorkspaceSnippetReference = useCallback(
    (payload: WorkspacePreviewQuotePayload) => {
      const abs = String(payload.absolutePath || "").trim();
      if (!abs) return;
      const makeSnippetRef = (snippet: string) => {
        let h = 2166136261;
        for (let i = 0; i < snippet.length; i += 1) {
          h ^= snippet.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return `snippet-${(h >>> 0).toString(16).padStart(8, "0")}`;
      };
      if (payload.kind === "text-range") {
        const content = String(payload.snippet || "").trimEnd();
        if (!content.trim()) return;
        const hasLineRange =
          Number.isFinite(payload.startLine) && Number.isFinite(payload.endLine);
        const startLine = hasLineRange ? Math.max(1, Math.floor(payload.startLine!)) : undefined;
        const endLine =
          hasLineRange && startLine !== undefined
            ? Math.max(startLine, Math.floor(payload.endLine!))
            : undefined;
        const snippetRef = !hasLineRange ? makeSnippetRef(content) : undefined;
        const key =
          hasLineRange && startLine !== undefined && endLine !== undefined
            ? `${abs}:${startLine}-${endLine}`
            : `${abs}:${snippetRef}`;
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: key,
            size: content.length,
            mimeType: "text/plain",
            status: "ready",
            content,
            sourcePath: abs,
            referenceToken: true,
            composerRefLabel: payload.label,
            ...(startLine !== undefined && endLine !== undefined
              ? { lineRange: { start: startLine, end: endLine } }
              : {}),
            ...(snippetRef ? { snippetRef } : {}),
            snippetContent: content,
          },
        }));
        const { next, tokenNames } = buildFileMentionAppend(extractComposerText(), payload.label, {
          mentionText: payload.label,
        });
        setComposerText(next, {
          tokenNames,
          refSourcePaths: { [payload.label]: abs },
        });
        focusComposerEnd();
        return;
      }
      const content = String(payload.snippet || "").trimEnd();
      if (!content.trim()) return;
      const key = `${abs}#${payload.sheet}!${payload.a1}`;
      setContextFiles((prev) => ({
        ...prev,
        [key]: {
          name: key,
          size: content.length,
          mimeType: "text/plain",
          status: "ready",
          content,
          sourcePath: abs,
          referenceToken: true,
          composerRefLabel: payload.label,
          spreadsheetRef: { sheet: payload.sheet, a1: payload.a1 },
          snippetContent: content,
        },
      }));
      const { next, tokenNames } = buildFileMentionAppend(extractComposerText(), payload.label, {
        mentionText: payload.label,
      });
      setComposerText(next, {
        tokenNames,
        refSourcePaths: { [payload.label]: abs },
      });
      focusComposerEnd();
    },
    [extractComposerText, focusComposerEnd, setComposerText]
  );

  const handleWorkspaceDragEntry = useCallback(
    async (entry: NearWorkspaceDragEntry) => {
      if (entry.type === "file") {
        await insertWorkspaceFileReference(entry.taskspaceId, entry.relPath);
      } else {
        await insertWorkspaceDirectoryReference(entry.taskspaceId, entry.relPath, entry.label);
      }
    },
    [insertWorkspaceDirectoryReference, insertWorkspaceFileReference]
  );

  const openWorkspaceFilePreview = useCallback(
    (request: WorkspacePreviewOpenRequest | string) => {
      const normalized: WorkspacePreviewOpenRequest =
        typeof request === "string"
          ? { absolutePath: request.trim() }
          : {
              absolutePath: String(request.absolutePath || "").trim(),
              ...(request.lineRange ? { lineRange: request.lineRange } : {}),
            };
      if (!normalized.absolutePath) return;
      if (!pane.taskspacePanelOpen) {
        openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
      }
      setPendingWorkspacePreviewRequest(normalized);
    },
    [pane.id, pane.taskspacePanelOpen, paneWidth, openSidePanel],
  );

  const openFileReferencePreview = useCallback(
    (request: WorkspacePreviewOpenRequest) => {
      openWorkspaceFilePreview(request);
    },
    [openWorkspaceFilePreview],
  );

  const revealFileInTaskspace = useCallback(async (absPath: string) => {
    openWorkspaceFilePreview(absPath);
  }, [openWorkspaceFilePreview]);

  const copyMessage = useCallback(async (message: Message) => {
    const raw = messagePlainTextForClipboard(message);
    const textToCopy =
      message.role === "user"
        ? rewriteUserReferenceMentions(raw, (message.attachments ?? []).filter((item) => isWorkspaceReferenceAttachment(item)))
        : raw;
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

  const exportSelectedMessagesToPdf = useCallback(async () => {
    if (selectedMessages.length === 0) return;
    try {
      const now = Date.now();
      const html = buildMessagesPdfHtml({
        messages: selectedMessages,
        sessionTitle: paneAvatarMeta.name || pane?.avatarName || "对话记录",
        exportedAt: now,
        userBubbleLabel,
      });
      const stamp = new Date(now)
        .toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        .replace(":", "-");
      const sessionSlug = (paneAvatarMeta.name || pane?.avatarName || "对话")
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 32);
      const res = await window.agenticxDesktop.exportMessagesPdf({
        html,
        defaultFileName: `Machi对话_${sessionSlug}_${stamp}.pdf`,
      });
      if (res.canceled) return;
      if (res.ok && res.path) {
        setStallHintToast(`已保存到 ${res.path}`);
      } else {
        setStallHintToast(`导出失败：${res.error || "未知错误"}`);
      }
    } catch (e) {
      setStallHintToast(`导出失败：${String(e).slice(0, 120)}`);
    }
  }, [pane?.avatarName, paneAvatarMeta.name, selectedMessages, userBubbleLabel]);

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

  const reloadSessionFromDisk = useCallback(
    async (sid: string) => {
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(sid);
        if (result.ok && Array.isArray(result.messages)) {
          const mapped = result.messages.map((item, midx) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, sid, midx)
          );
          setPaneMessages(pane.id, mapped);
        }
      } catch (err) {
        console.error("[ChatPane] reload session from disk failed:", err);
      }
    },
    [pane.id, setPaneMessages]
  );

  /**
   * FR-B self-heal: when re-entering a displayed session whose foreground SSE is
   * not active, the in-memory messages may have diverged from disk — either a
   * retry truncation that never got the new reply merged back, or a turn that
   * completed in the background while the user was on another session (the
   * re-entry path only reconciled `running` sessions, so an already-`idle`
   * session showed a stale/empty "已中断" state until restart). Disk is
   * authoritative for completed turns (it already persists suggested_questions /
   * references), so a clean full replace mirrors the restart behavior without
   * losing enrichments. No-op when in-memory already matches disk.
   */
  const reconcileDisplayedSessionFromDisk = useCallback(
    async (sid: string): Promise<void> => {
      if (!sid) return;
      if (sessionStreamStateRef.current[sid]?.active) return;
      try {
        const livePane = useAppStore.getState().panes.find((p) => p.id === pane.id);
        if (livePane?.loadingMessages) return;
        if (
          livePane?.hasOlderMessages ||
          (livePane?.oldestLoadedIndex ?? 0) > 0
        ) {
          return;
        }
        const currentMsgs = livePane?.messages ?? [];
        if (lastTurnHasCompletedAssistantReply(currentMsgs)) return;
        const result = await window.agenticxDesktop.loadSessionMessages(sid);
        if (!result.ok || !Array.isArray(result.messages)) return;
        const latestSid = String(
          useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
        ).trim();
        if (latestSid !== sid) return;
        if (sessionStreamStateRef.current[sid]?.active) return;
        const current =
          useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? [];
        const mapped = result.messages.map((item, midx) =>
          mapLoadedSessionMessage(item as LoadedSessionMessage, sid, midx)
        );
        const enriched = enrichDiskMessagesWithInMemoryReferences(current, mapped);
        const differs =
          enriched.length !== current.length ||
          String(enriched[enriched.length - 1]?.content ?? "") !==
            String(current[current.length - 1]?.content ?? "") ||
          referencesDifferBetweenTails(current, enriched);
        if (differs) setPaneMessages(pane.id, enriched);
      } catch {
        /* best effort */
      }
    },
    [pane.id, setPaneMessages]
  );

  const loadOlderSessionMessages = useCallback(async (): Promise<void> => {
    const sid = String(pane.sessionId ?? "").trim();
    if (!sid) return;
    if (loadingOlderMessagesRef.current) return;
    const livePane = useAppStore.getState().panes.find((p) => p.id === pane.id);
    if (!livePane?.hasOlderMessages || livePane.loadingOlderMessages) return;
    const beforeIndex = livePane.oldestLoadedIndex ?? 0;
    if (beforeIndex <= 0) return;

    loadingOlderMessagesRef.current = true;
    setPaneMessagePaging(pane.id, { loadingOlderMessages: true });
    const el = listRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    try {
      const page = await window.agenticxDesktop.loadSessionMessagesPage(sid, {
        beforeIndex,
        limit: 20,
      });
      const latestSid = String(
        useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
      ).trim();
      if (latestSid !== sid) return;
      if (!page.ok || !Array.isArray(page.messages)) {
        setPaneMessagePaging(pane.id, { loadingOlderMessages: false });
        return;
      }
      if (page.messages.length === 0) {
        setPaneMessagePaging(pane.id, {
          hasOlderMessages: Boolean(page.has_older),
          loadingOlderMessages: false,
        });
        return;
      }
      const startIndex = page.start_index ?? 0;
      const mapped = page.messages.map((item, index) =>
        mapLoadedSessionMessage(item as LoadedSessionMessage, sid, startIndex + index, sid)
      );
      prependPaneMessages(pane.id, mapped);
      setPaneMessagePaging(pane.id, {
        oldestLoadedIndex: startIndex,
        hasOlderMessages: Boolean(page.has_older),
        loadingOlderMessages: false,
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const inner = listRef.current;
          if (inner) {
            inner.scrollTop += inner.scrollHeight - prevScrollHeight;
          }
        });
      });
    } catch {
      setPaneMessagePaging(pane.id, { loadingOlderMessages: false });
    } finally {
      loadingOlderMessagesRef.current = false;
    }
  }, [pane.id, pane.sessionId, prependPaneMessages, setPaneMessagePaging]);

  const tryLoadOlderIfNeeded = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const livePane = useAppStore.getState().panes.find((p) => p.id === pane.id);
    if (!livePane?.hasOlderMessages || livePane.loadingOlderMessages || loadingOlderMessagesRef.current) {
      return;
    }
    const atTop = el.scrollTop <= 64;
    const fitsViewport = el.scrollHeight <= el.clientHeight + 8;
    if (atTop || fitsViewport) {
      void loadOlderSessionMessages();
    }
  }, [pane.id, loadOlderSessionMessages]);

  useEffect(() => {
    loadingOlderMessagesRef.current = false;
    sessionBootstrapRef.current = "";
    sessionBootstrapInflightRef.current = "";
    sessionBootstrapAttemptRef.current = 0;
    // 切换会话时收起落盘 drawer：其 runId 属于上一会话，跨会话残留会导致
    // "run not found"（用户点当前会话集群卡成员时再按需打开）。
    if (useAppStore.getState().panes.find((p) => p.id === pane.id)?.runDrawerOpen) {
      closeRunDrawer(pane.id);
    }
  }, [pane.id, pane.sessionId, closeRunDrawer]);

  /** App restore / direct bind / switch-back: ensure the pane shows this session's
   *  complete persisted history. We must NOT trust stray rows already sitting in the
   *  pane — a switch-back can leave either stale owner-mismatched rows (the render
   *  layer filters them to a blank screen) or a partial deferred-stream flush that is
   *  missing the user turn and earlier history. Both previously tripped a
   *  `messages.length > 0` shortcut that skipped the disk load and left the
   *  conversation permanently blank/partial with no self-heal. */
  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) return;
    const live = useAppStore.getState().panes.find((p) => p.id === pane.id);
    if (!live) return;
    // Actively streaming this session: live + reattach rows are authoritative;
    // never overwrite them mid-stream. Mark bootstrapped so the post-stream
    // effect re-run does not trigger a redundant disk reload.
    const streamActiveForSid = Boolean(sessionStreamStateRef.current[sid]?.active);
    if (streamActiveForSid) {
      if ((live.messages ?? []).length > 0) sessionBootstrapRef.current = sid;
      return;
    }
    // One-shot guard: once this session has been bootstrapped (either by a
    // successful disk load here or by splash/restore hydration), never run the
    // disk load again. This prevents the bootstrap from firing a second disk
    // read after the user sends their first message (which changes
    // pane.messages.length) and producing a duplicate optimistic user row.
    if (sessionBootstrapRef.current === sid) return;
    const ownedCount = visibleMessagesForSession(live.messages ?? [], sid).length;
    // Splash / App restore may hydrate messages before this effect runs — mark
    // bootstrapped without a redundant disk roundtrip.
    if (ownedCount > 0) {
      sessionBootstrapRef.current = sid;
      return;
    }
    if (sessionBootstrapInflightRef.current === sid) return;
    sessionBootstrapInflightRef.current = sid;
    let cancelled = false;
    const paneStillOnSid = () =>
      String(
        useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
      ).trim() === sid;
    void (async () => {
      setPaneLoadingMessages(pane.id, true);
      try {
        const entry = await resolveSessionTailForSwitch(sid);
        if (cancelled || !paneStillOnSid()) return;
        if (entry && entry.messages.length > 0) {
          setPaneMessages(pane.id, entry.messages);
          setPaneMessagePaging(pane.id, {
            oldestLoadedIndex: entry.startIndex,
            hasOlderMessages: entry.hasOlder,
            loadingOlderMessages: false,
          });
          sessionBootstrapRef.current = sid;
          return;
        }
        // Tail page empty/unavailable — fall back to a full load so a transient
        // pagination miss never leaves the pane blank (mirrors history panel).
        const full = await window.agenticxDesktop.loadSessionMessages(sid);
        if (cancelled || !paneStillOnSid()) return;
        if (full.ok && Array.isArray(full.messages) && full.messages.length > 0) {
          const mapped = full.messages.map((item, index) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, sid, index, sid)
          );
          setPaneMessages(pane.id, mapped);
          setPaneMessagePaging(pane.id, {
            oldestLoadedIndex: 0,
            hasOlderMessages: false,
            loadingOlderMessages: false,
          });
          sessionBootstrapRef.current = sid;
        }
      } catch {
        /* schedule retry below */
      } finally {
        if (sessionBootstrapInflightRef.current === sid) {
          sessionBootstrapInflightRef.current = "";
        }
        if (!cancelled && paneStillOnSid()) {
          const hydrated =
            visibleMessagesForSession(
              useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? [],
              sid
            ).length > 0;
          if (!hydrated && sessionBootstrapAttemptRef.current < 4) {
            sessionBootstrapAttemptRef.current += 1;
            window.setTimeout(() => {
              const stillSid =
                String(
                  useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
                ).trim() === sid;
              if (!stillSid) return;
              setSessionBootstrapRetryNonce((n) => n + 1);
            }, 800 * sessionBootstrapAttemptRef.current);
          }
        }
        if (!cancelled) setPaneLoadingMessages(pane.id, false);
      }
    })();
    return () => {
      cancelled = true;
      if (sessionBootstrapInflightRef.current === sid) {
        sessionBootstrapInflightRef.current = "";
        setPaneLoadingMessages(pane.id, false);
      }
    };
  }, [
    pane.id,
    pane.sessionId,
    streamingSessionId,
    sessionBootstrapRetryNonce,
    setPaneLoadingMessages,
    setPaneMessagePaging,
    setPaneMessages,
  ]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScrollUpLoad = () => tryLoadOlderIfNeeded();
    el.addEventListener("scroll", onScrollUpLoad, { passive: true });
    requestAnimationFrame(() => tryLoadOlderIfNeeded());
    return () => {
      el.removeEventListener("scroll", onScrollUpLoad);
    };
  }, [tryLoadOlderIfNeeded]);

  useEffect(() => {
    if (!pane.hasOlderMessages) return;
    requestAnimationFrame(() => tryLoadOlderIfNeeded());
  }, [pane.messages?.length, pane.hasOlderMessages, tryLoadOlderIfNeeded]);

  const truncateSessionAtUserMessage = useCallback(
    async (
      sid: string,
      userContent: string,
      mode: "after" | "including",
      userOccurrence: number,
      expectRemoved: boolean
    ): Promise<boolean> => {
      try {
        const resp = await fetch(`${apiBase}/api/session/messages/truncate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
          body: JSON.stringify({
            session_id: sid,
            user_content: userContent,
            mode,
            user_occurrence: userOccurrence,
          }),
        });
        const data = (await resp.json()) as {
          ok?: boolean;
          removed_chat?: number;
          removed_agent?: number;
          matched_chat?: boolean;
          matched_agent?: boolean;
        };
        if (!resp.ok || !data.ok) return false;
        const removedChat = typeof data.removed_chat === "number" ? data.removed_chat : 0;
        const removedAgent = typeof data.removed_agent === "number" ? data.removed_agent : 0;
        const matched = Boolean(data.matched_chat || data.matched_agent);
        if (expectRemoved && removedChat === 0 && removedAgent === 0 && !matched) {
          return false;
        }
        return true;
      } catch (err) {
        console.error("[ChatPane] truncate session failed:", err);
        return false;
      }
    },
    [apiBase, apiToken]
  );

  const countUserOccurrenceThrough = useCallback((msgs: Message[], throughIdx: number, content: string) => {
    let count = 0;
    for (let i = 0; i <= throughIdx; i += 1) {
      const row = msgs[i];
      if (!row || row.role !== "user") continue;
      if (row.content === content) count += 1;
    }
    return count;
  }, []);

  const hasTrailingTurnMessages = useCallback((msgs: Message[], userIdx: number) => {
    return userIdx < msgs.length - 1;
  }, []);

  const editUserMessage = useCallback(
    async (msg: Message, newContent: string) => {
      if (msg.role !== "user") return;
      const sid = (pane.sessionId || "").trim();
      if (!sid || !apiBase) return;
      const msgs = pane.messages ?? [];
      const idx = msgs.findIndex((m) => m.id === msg.id);
      if (idx < 0) return;
      const userOccurrence = countUserOccurrenceThrough(msgs, idx, msg.content);
      const expectRemoved = idx < msgs.length - 1 || msg.content !== newContent.trim();
      // Remove the edited user turn and everything after it (both UI history and
      // model context) before resending the new content as a fresh turn.
      const ok = await truncateSessionAtUserMessage(
        sid,
        msg.content,
        "including",
        userOccurrence,
        expectRemoved
      );
      if (!ok) {
        await reloadSessionFromDisk(sid);
        return;
      }
      setPaneMessages(pane.id, msgs.slice(0, idx));
      await sendChatRef.current(newContent, {
        lockedSessionId: sid,
        retryAttachments: msg.attachments ?? [],
      });
    },
    [
      apiBase,
      pane.id,
      pane.messages,
      pane.sessionId,
      reloadSessionFromDisk,
      setPaneMessages,
      truncateSessionAtUserMessage,
    ]
  );

  // Group chats also have a real streaming run in flight; only the
  // assistant-text overlay is gated by !isGroupPane (group chats render
  // per-member typing bubbles instead). The stop button + queued follow-ups
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

  const sessionWorkInProgress = useMemo(() => {
    const sid = (pane.sessionId || "").trim();
    return shouldShowSessionWorkInProgress({
      isStreamingCurrentSession,
      executionState: sessionExecutionState,
      stallState,
      sessionUnattended,
      unattendedGlobalEnabled,
      userStopped: sid ? Boolean(userStoppedSessionRef.current[sid]) : false,
      messages: pane.messages ?? [],
      isGroupPane,
    });
  }, [
    isGroupPane,
    isStreamingCurrentSession,
    pane.messages,
    pane.sessionId,
    sessionExecutionState,
    sessionUnattended,
    stallState,
    stallTick,
    unattendedGlobalEnabled,
  ]);

  const showStopButton = shouldShowStopButton({
    streaming,
    streamingSessionId,
    currentSessionId: pane.sessionId || "",
    executionState: sessionExecutionState,
    runGuardSessionId,
    hasDelegation,
    isGroupPane,
    sessionWorkInProgress,
  });

  const stallModelOptions = useMemo(
    () => collectSelectableModelOptions(settings.providers),
    [settings.providers],
  );

  const currentModelLabel = useMemo(() => {
    if (!chatModel) return "未选模型";
    if (!chatProvider) return chatModel;
    if (!isModelSelectable(chatProvider, chatModel, settings.providers)) return "未选模型";
    const entry = settings.providers[chatProvider];
    return formatModelOptionLabel(chatProvider, chatModel, entry);
  }, [chatModel, chatProvider, settings.providers]);

  const silentSeconds = useMemo(() => {
    void stallTick;
    const sid = (pane.sessionId || "").trim();
    const sessionT = sid ? sessionProgressAtRef.current[sid] ?? 0 : 0;
    const t = Math.max(lastProgressAtRef.current, sessionT);
    if (!t) return 0;
    return Math.floor((Date.now() - t) / 1000);
  }, [stallTick, stallState, sessionExecutionState, pane.sessionId]);

  const stallThresholdSeconds = stallRuntimeConfig.stall_detect_silence_seconds;
  const silenceTier = useMemo(
    () => resolveSilenceTier(silentSeconds, stallThresholdSeconds),
    [silentSeconds, stallThresholdSeconds],
  );
  const sessionHealth = useMemo(
    () =>
      resolveSessionHealth(
        silentSeconds,
        stallThresholdSeconds,
        sessionExecutionState,
        stallState,
      ),
    [silentSeconds, stallThresholdSeconds, sessionExecutionState, stallState],
  );

  const taskLiveness = useMemo((): "active" | "stalled" | "idle" => {
    // "exhausted" = stall auto-nudge used up; show as stalled (not active) so that
    // StickyTaskBar can render the "stuck" state and promotePending can eventually fire.
    if (stallState === "stall" || stallState === "exhausted") return "stalled";
    if (sessionWorkInProgress) return "active";
    if (sessionExecutionState === "running") return "active";
    return "idle";
  }, [sessionWorkInProgress, stallState, sessionExecutionState]);

  const sessionBusy = taskLiveness !== "idle" || stallState !== "none";

  useEffect(() => {
    stallStateRef.current = stallState;
  }, [stallState]);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === "assistant") return visibleMessages[i].id;
    }
    return null;
  }, [visibleMessages]);

  // Whether the latest interrupted turn is already complete — used to hide
  // the 恢复执行 button on a turn_interrupted row (futile-resume guard).
  const isFutileResumeFlag = useMemo(
    () => isFutileResume(pane.messages ?? []),
    [pane.messages],
  );

  const clearResumeInFlight = useCallback((sid: string) => {
    if (resumeInFlightTimerRef.current != null) {
      window.clearTimeout(resumeInFlightTimerRef.current);
      resumeInFlightTimerRef.current = null;
    }
    delete resumeInFlightRef.current[sid];
    if ((pane.sessionId || "").trim() === sid) {
      setResumeInFlight(false);
    }
  }, [pane.sessionId]);

  const beginResumeInFlight = useCallback(
    (sid: string) => {
      resumeInFlightRef.current[sid] = true;
      setResumeInFlight(true);
      if (resumeInFlightTimerRef.current != null) {
        window.clearTimeout(resumeInFlightTimerRef.current);
      }
      resumeInFlightTimerRef.current = window.setTimeout(() => {
        clearResumeInFlight(sid);
      }, 8000);
    },
    [clearResumeInFlight]
  );

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

  const recordProgressActivity = useCallback((sessionKey?: string) => {
    const now = Date.now();
    const key = String(sessionKey || pane.sessionId || "").trim();
    if (key) sessionProgressAtRef.current[key] = now;
    const currentSid = (pane.sessionId || "").trim();
    if (!key || key === currentSid) {
      lastProgressAtRef.current = now;
      lastSseEventAtRef.current = now;
      setStallState((prev) => (prev === "stall" ? "none" : prev));
    }
  }, [pane.sessionId]);

  /** 任一 SSE 帧视为仍有响应：刷新计时并在曾误判 stall 时立即收起提示 */
  const recordSseActivity = useCallback(
    (sessionKey?: string) => {
      const key = String(sessionKey || pane.sessionId || "").trim();
      recordProgressActivity(key);
      if (key && resumeInFlightRef.current[key]) {
        clearResumeInFlight(key);
      }
    },
    [clearResumeInFlight, pane.sessionId, recordProgressActivity],
  );

  useEffect(() => {
    void window.agenticxDesktop.loadRuntimeConfig().then((r) => {
      if (!r?.ok) return;
      const cfg = r as {
        stall_detect_silence_seconds?: number;
        stall_auto_nudge_enabled?: boolean;
        stall_auto_nudge_after_seconds?: number;
        stall_auto_nudge_max_per_session?: number;
        unattended_enabled?: boolean;
        unattended_max_continuations_per_session?: number;
        unattended_stall_continue_after_seconds?: number;
        live_reattach_enabled?: boolean;
      };
      liveReattachEnabledRef.current = Boolean(cfg.live_reattach_enabled);
      const detectSec = Math.max(
        30,
        Math.min(300, Number(cfg.stall_detect_silence_seconds ?? 90) || 90),
      );
      setStallRuntimeConfig({
        stall_detect_silence_seconds: detectSec,
        stall_auto_nudge_enabled: Boolean(cfg.stall_auto_nudge_enabled),
        stall_auto_nudge_after_seconds: Math.max(
          60,
          Math.min(300, Number(cfg.stall_auto_nudge_after_seconds ?? 120) || 120)
        ),
        stall_auto_nudge_max_per_session: Math.max(
          1,
          Math.min(5, Number(cfg.stall_auto_nudge_max_per_session ?? 2) || 2)
        ),
      });
      setUnattendedGlobalEnabled(Boolean(cfg.unattended_enabled));
      setUnattendedMaxContinuations(
        Math.max(1, Math.min(100, Number(cfg.unattended_max_continuations_per_session ?? 20) || 20))
      );
      setUnattendedStallContinueAfterSeconds(
        Math.max(
          30,
          Math.min(600, Number(cfg.unattended_stall_continue_after_seconds ?? 120) || 120),
        ),
      );
    });
  }, []);

  /**
   * Returns the id of a trailing "无人值守已停止" marker — i.e. an auto-stop
   * notice that is the most recent unattended event with no later user message.
   * Used to detect that the supervisor has turned unattended off so the desktop
   * stops re-enabling it. Returns null when no such trailing marker exists.
   */
  const detectTrailingUnattendedStop = useCallback(
    (msgs: Message[]): string | null => {
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i];
        if (m.role === "user") return null;
        if (
          m.role === "tool" &&
          typeof m.content === "string" &&
          m.content.includes("无人值守已停止")
        ) {
          return String(m.id ?? `idx-${i}`);
        }
      }
      return null;
    },
    []
  );

  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) {
      setSessionUnattended(false);
      return;
    }
    try {
      const raw = readScopedLocalStorage(SESSION_UNATTENDED_STORAGE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      const enabled = Boolean(map[sid]);
      // If the session was already auto-stopped by the supervisor, do not push
      // it back on — that caused the reopen → re-stop loop with repeated ⛔.
      const stopId = detectTrailingUnattendedStop(pane.messages ?? []);
      const autoStopped = stopId !== null && unattendedAutoStopAckRef.current[sid] !== stopId;
      if (enabled && autoStopped) {
        setSessionUnattended(false);
        return;
      }
      setSessionUnattended(enabled);
      if (enabled && apiBase) {
        void fetch(`${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(sid)}/unattended`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
          body: JSON.stringify({ enabled: true }),
        }).catch(() => {
          /* best-effort sync after restart */
        });
      }
    } catch {
      setSessionUnattended(false);
    }
  }, [apiBase, apiToken, pane.sessionId, pane.messages, detectTrailingUnattendedStop]);

  // When the supervisor auto-stops unattended (trailing ⛔ marker), reflect that
  // by clearing the local toggle and syncing the backend off, so it stays off.
  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) return;
    const stopId = detectTrailingUnattendedStop(pane.messages ?? []);
    if (!stopId) return;
    if (unattendedAutoStopAckRef.current[sid] === stopId) return;
    unattendedAutoStopAckRef.current[sid] = stopId;
    let cleared = false;
    try {
      const raw = readScopedLocalStorage(SESSION_UNATTENDED_STORAGE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      if (map[sid]) {
        delete map[sid];
        writeScopedLocalStorage(SESSION_UNATTENDED_STORAGE_KEY, JSON.stringify(map));
        cleared = true;
      }
    } catch {
      /* best effort */
    }
    setSessionUnattended(false);
    if (cleared && apiBase) {
      void fetch(`${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(sid)}/unattended`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ enabled: false }),
      }).catch(() => {
        /* best effort */
      });
    }
  }, [apiBase, apiToken, pane.sessionId, pane.messages, detectTrailingUnattendedStop]);

  const toggleSessionUnattended = useCallback(async () => {
    const sid = (pane.sessionId || "").trim();
    if (!sid || !apiBase) return;
    const next = !sessionUnattended;
    try {
      await fetch(`${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(sid)}/unattended`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ enabled: next }),
      });
      const raw = readScopedLocalStorage(SESSION_UNATTENDED_STORAGE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      if (next) {
        map[sid] = true;
        // Manual re-enable acknowledges any existing trailing stop marker so the
        // auto-disable effect does not immediately turn it back off.
        const stopId = detectTrailingUnattendedStop(pane.messages ?? []);
        if (stopId) unattendedAutoStopAckRef.current[sid] = stopId;
      } else {
        delete map[sid];
      }
      writeScopedLocalStorage(SESSION_UNATTENDED_STORAGE_KEY, JSON.stringify(map));
      setSessionUnattended(next);
    } catch {
      setStallHintToast("无人值守开关保存失败");
    }
  }, [apiBase, apiToken, pane.sessionId, pane.messages, sessionUnattended, detectTrailingUnattendedStop]);

  /** Returns true only when disk merge actually added/changed rows (used to gate progress timer). */
  const mergeTailFromDisk = useCallback(
    async (sid: string): Promise<boolean> => {
      // A foreground SSE stream is the single source of truth while it runs;
      // disk lags and uses a positional id scheme incompatible with the live
      // `uid()` rows, so merging mid-stream re-introduces the just-truncated
      // old reply (the retry "拼接"). Let the stream own the in-memory state.
      if (sessionStreamStateRef.current[sid]?.active) return false;
      try {
        const msgs = await window.agenticxDesktop.loadSessionMessages(sid);
        if (!msgs.ok || !Array.isArray(msgs.messages)) return false;
        // The displayed session may have changed while the disk load was in
        // flight (e.g. a background timer for session B resolves after the user
        // switched the pane to session A). Never merge B's disk tail into A's
        // pane — that truncates/corrupts the in-memory messages until restart.
        // Mirrors the same guard in the delegation poll path above.
        const latestSid = String(
          useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? ""
        ).trim();
        if (latestSid !== sid) return false;
        const current = useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? [];
        const merged = mergeSessionMessagesTail(
          current,
          msgs.messages as LoadedSessionMessage[],
          sid
        );
        const changed =
          merged.length !== current.length ||
          String(merged[merged.length - 1]?.content ?? "") !==
            String(current[current.length - 1]?.content ?? "");
        if (changed) {
          setPaneMessages(pane.id, merged);
          recordProgressActivity();
        }
        return changed;
      } catch {
        /* best effort */
        return false;
      }
    },
    [pane.id, recordProgressActivity, setPaneMessages]
  );

  /**
   * FR-4 live reattach: when re-entering a still-running session with no active
   * foreground SSE, subscribe to the read-only reattach endpoint to resume
   * token-level streaming in real time. Structured content (tool cards, refs,
   * group progress) is reconciled from disk when the stream ends. Falls back to
   * disk polling on any error or when the feature flag is off.
   */
  const reattachLiveStream = useCallback(
    async (sid: string): Promise<void> => {
      if (!sid || !apiBase) return;
      if (reattachControllersRef.current[sid]) return; // already reattached
      if (sessionStreamStateRef.current[sid]?.active) return; // foreground stream owns it
      const ctrl = new AbortController();
      reattachControllersRef.current[sid] = ctrl;
      const prior = sessionStreamStateRef.current[sid];
      let liveText = prior?.text ?? "";
      sessionStreamStateRef.current[sid] = {
        active: true,
        text: liveText,
        provider: prior?.provider ?? "",
        model: prior?.model ?? "",
      };
      const isCurrent = () => (pane.sessionId || "").trim() === sid;
      if (isCurrent()) syncStreamingUiForCurrentSession();
      let lastSeq = 0;
      try {
        const resp = await fetch(reattachSessionStreamUrl(apiBase, sid, lastSeq), {
          headers: { "x-agx-desktop-token": apiToken },
          signal: ctrl.signal,
        });
        const reader = resp.ok ? resp.body?.getReader() : undefined;
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const { eventId, payload } = parseSseFrame(frame);
            if (eventId != null) lastSeq = eventId;
            if (!payload || typeof payload !== "object") continue;
            const p = payload as { type?: string; data?: { text?: string; agent_id?: string } };
            recordSseActivity(sid);
            if (p.type === "token" && (p.data?.agent_id ?? "meta") === "meta") {
              const t = String(p.data?.text ?? "").replace(/⏳\s*/g, "");
              if (!t) continue;
              liveText += t;
              const st = sessionStreamStateRef.current[sid];
              if (st) st.text = liveText;
              if (isCurrent()) setStreamedAssistantText(liveText);
            }
            // done/final/replay_gap: reconciled from disk in finally.
          }
        }
      } catch {
        /* aborted or network error — disk merge below reconciles state */
      } finally {
        delete reattachControllersRef.current[sid];
        const st = sessionStreamStateRef.current[sid];
        if (st) st.active = false;
        if (isCurrent()) {
          setStreamedAssistantText("");
          syncStreamingUiForCurrentSession();
        }
        await mergeTailFromDisk(sid);
      }
    },
    [apiBase, apiToken, pane.sessionId, recordSseActivity, mergeTailFromDisk, syncStreamingUiForCurrentSession]
  );

  useEffect(() => {
    let cancelled = false;
    const enteredAt = Date.now();
    const sid = (pane.sessionId || "").trim();
    const switchKey = sid || `__awaiting_fresh__:${pane.id}`;

    if (shouldResetStallDetectorsOnSessionSwitch(lastStallBaselineSessionRef.current, switchKey)) {
      lastStallBaselineSessionRef.current = switchKey;
      if (sid) prevExecutionStateBySidRef.current[sid] = "idle";
      setStallState("none");
      setStallRejectReason("");
      setStallTick((t) => t + 1);
      setSessionExecutionState("idle");
      setLastToolProgress(null);
      setContextLoopStats(null);

      if (sid) {
        const streamActive = Boolean(sessionStreamStateRef.current[sid]?.active);
        const priorProgress = sessionProgressAtRef.current[sid] ?? 0;
        if (priorProgress > 0) {
          lastProgressAtRef.current = priorProgress;
          lastSseEventAtRef.current = priorProgress;
        } else {
          lastProgressAtRef.current = enteredAt;
          lastSseEventAtRef.current = enteredAt;
        }
        if (streamActive) {
          setRunGuardSessionId(sid);
        }
      } else {
        lastProgressAtRef.current = enteredAt;
        lastSseEventAtRef.current = enteredAt;
      }
    }

    syncStreamingUiForCurrentSession();

    if (!sid) {
      return () => {
        cancelled = true;
      };
    }

    sessionEnteredAtRef.current[sid] = enteredAt;
    setAutoNudgeCount(autoNudgeTriggeredRef.current[sid] ?? 0);
    const priorUnattended = (pane.messages ?? []).filter(
      (m) =>
        m.role === "tool" &&
        typeof m.content === "string" &&
        (m.content.includes("无人值守续跑") || m.content.includes("自动续跑提醒")),
    ).length;
    unattendedContinueTriggeredRef.current[sid] = priorUnattended;
    setUnattendedContinueCount(priorUnattended);
    void window.agenticxDesktop.listSessions(pane.avatarId ?? undefined).then((r) => {
      if (cancelled) return;
      if (!r.ok) return;
      const row = (r.sessions ?? []).find((s) => s.session_id === sid);
      const st = (row?.execution_state ?? "idle") as SessionExecutionState;
      setSessionExecutionState(st);
      prevExecutionStateBySidRef.current[sid] = st;
      if (st === "running") {
        setRunGuardSessionId(sid);
        if (sessionStreamStateRef.current[sid]?.active) {
          syncStreamingUiForCurrentSession();
        } else {
          void mergeTailFromDisk(sid);
          if (liveReattachEnabledRef.current) void reattachLiveStream(sid);
        }
      } else if (!sessionStreamStateRef.current[sid]?.active) {
        void reconcileDisplayedSessionFromDisk(sid);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    mergeTailFromDisk,
    reattachLiveStream,
    reconcileDisplayedSessionFromDisk,
    pane.id,
    pane.sessionId,
    pane.avatarId,
    syncStreamingUiForCurrentSession,
  ]);

  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) return;
    let cancelled = false;
    let timer: number | undefined;

    const syncBackgroundRun = async () => {
      if (cancelled) return;
      const sseActive = Boolean(sessionStreamStateRef.current[sid]?.active);
      if (sseActive) return;
      try {
        const r = await window.agenticxDesktop.listSessions(pane.avatarId ?? undefined);
        if (cancelled || !r.ok) return;
        const row = (r.sessions ?? []).find((s) => s.session_id === sid);
        const execState = (row?.execution_state ?? "idle") as SessionExecutionState;
        if (execState !== "running") return;
        setRunGuardSessionId(sid);
        if (liveReattachEnabledRef.current) {
          // Live reattach takes over: marks the stream active (gating future
          // ticks) and resumes token-level streaming until the run ends.
          void reattachLiveStream(sid);
          return;
        }
        // mergeTailFromDisk only refreshes the progress timer when it actually
        // appends new rows; do NOT unconditionally record activity here, or a
        // backend that has silently hung would never trip the stall card.
        await mergeTailFromDisk(sid);
      } catch {
        /* best effort */
      }
    };

    void syncBackgroundRun();
    timer = window.setInterval(() => void syncBackgroundRun(), 2000);
    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      // Abort any live reattach stream for this session when leaving / switching.
      const ctrl = reattachControllersRef.current[sid];
      if (ctrl) {
        ctrl.abort();
        delete reattachControllersRef.current[sid];
      }
    };
  }, [mergeTailFromDisk, reattachLiveStream, pane.avatarId, pane.sessionId]);

  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    const found = findBudgetExceededInMessages(pane.messages ?? []);
    if (found) {
      setBudgetExceededInfo({ ...found, sessionId: sid || found.sessionId });
    } else {
      setBudgetExceededInfo(null);
    }
  }, [pane.messages, pane.sessionId]);

  useEffect(() => {
    if ((pane.messages ?? []).length > 0) {
      recordProgressActivity();
    }
  }, [pane.messages?.length, recordProgressActivity]);

  const stopCurrentRun = useCallback(async () => {
    const sid = (streamingSessionId || pane.sessionId || "").trim();
    if (!sid) return;
    if (stopInFlightRef.current[sid]) return;

    stopInFlightRef.current[sid] = true;
    setStoppingSessionId(sid);
    userStoppedSessionRef.current[sid] = true;
    setRunGuardSessionId(sid);
    setStallState("none");

    const st = sessionStreamStateRef.current[sid];
    if (st) {
      st.text = "⏹ 正在中断...";
      st.active = false;
      sessionStreamStateRef.current[sid] = st;
    }
    abortRef.current?.abort();
    if ((pane.sessionId || "").trim() === sid) {
      setStreamedAssistantText("⏹ 正在中断...");
      setStreaming(false);
      setStreamingSessionId("");
    }

    try {
      const r = await window.agenticxDesktop.interruptSession?.(sid);
      if (r?.ok) {
        setSessionExecutionState("interrupted");
        setStallState("none");
        // Stop must clear the optimistic "running" hint immediately so the
        // history sidebar spinner disappears at once instead of waiting for the
        // 1.5s list poll (which can lag behind a bloated session list query).
        useAppStore.getState().clearSessionHistoryHint(sid);
      } else {
        userStoppedSessionRef.current[sid] = false;
        setRunGuardSessionId("");
        addPaneMessage(
          pane.id,
          "tool",
          `⚠️ 中断失败：${r?.error ?? "未知错误"}`,
          "meta"
        );
      }
    } catch (err) {
      userStoppedSessionRef.current[sid] = false;
      setRunGuardSessionId("");
      addPaneMessage(pane.id, "tool", `⚠️ 中断失败：${String(err)}`, "meta");
    } finally {
      stopInFlightRef.current[sid] = false;
      setStoppingSessionId((current) => (current === sid ? "" : current));
    }
  }, [addPaneMessage, pane.id, pane.sessionId, streamingSessionId]);

  const interruptForResume = useCallback(
    async (sid: string) => {
      const prevAbort = sessionAbortControllersRef.current[sid];
      if (prevAbort) {
        try {
          prevAbort.abort();
        } catch {
          /* already aborted */
        }
        delete sessionAbortControllersRef.current[sid];
      }
      const st = sessionStreamStateRef.current[sid];
      if (st) {
        st.active = false;
        st.text = "";
        sessionStreamStateRef.current[sid] = st;
      }
      if ((pane.sessionId || "").trim() === sid) {
        syncStreamingUiForCurrentSession();
      }
      try {
        await window.agenticxDesktop.interruptSession?.(sid);
      } catch {
        /* best effort */
      }
    },
    [pane.sessionId, syncStreamingUiForCurrentSession]
  );

  const retryUserMessage = useCallback(
    async (msg: Message) => {
      if (msg.role !== "user") return;
      const sid = (pane.sessionId || "").trim();
      if (!sid || !apiBase) return;
      if (retryInFlightRef.current[sid]) return;
      retryInFlightRef.current[sid] = true;
      try {
        await interruptForResume(sid);
        await new Promise((resolve) => window.setTimeout(resolve, 60));

        const msgs = pane.messages ?? [];
        const idx = msgs.findIndex((m) => m.id === msg.id);
        if (idx < 0) return;
        const userOccurrence = countUserOccurrenceThrough(msgs, idx, msg.content);
        const expectRemoved = hasTrailingTurnMessages(msgs, idx);
        const ok = await truncateSessionAtUserMessage(
          sid,
          msg.content,
          "after",
          userOccurrence,
          expectRemoved
        );
        if (!ok) {
          addPaneMessage(
            pane.id,
            "tool",
            "⚠️ 重试失败：无法裁剪会话历史，请稍后再试。",
            "meta"
          );
          await reloadSessionFromDisk(sid);
          return;
        }
        setPaneMessages(pane.id, msgs.slice(0, idx + 1));
        await sendChatRef.current(msg.content, {
          lockedSessionId: sid,
          retryAttachments: msg.attachments ?? [],
          suppressUserEcho: true,
          skipUserHistory: true,
          forceSend: true,
        });
      } catch (err) {
        console.error("[ChatPane] retry user message failed:", err);
        addPaneMessage(pane.id, "tool", `⚠️ 重试失败：${String(err)}`, "meta");
      } finally {
        retryInFlightRef.current[sid] = false;
      }
    },
    [
      addPaneMessage,
      apiBase,
      countUserOccurrenceThrough,
      hasTrailingTurnMessages,
      interruptForResume,
      pane.id,
      pane.messages,
      pane.sessionId,
      reloadSessionFromDisk,
      setPaneMessages,
      truncateSessionAtUserMessage,
    ]
  );

  const takeoverSession = useCallback(async () => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) return;
    userStoppedSessionRef.current[sid] = true;
    await stopCurrentRun();
    window.setTimeout(() => composerRef.current?.focus(), 50);
  }, [pane.sessionId, stopCurrentRun]);

  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) return;
    let cancelled = false;

    const evaluate = async () => {
      if (stallState === "exhausted") return;
      const sseActive = Boolean(sessionStreamStateRef.current[sid]?.active);
      const sessionProgress = sessionProgressAtRef.current[sid] ?? 0;
      const lastProgress = Math.max(lastProgressAtRef.current, sessionProgress);
      const now = Date.now();
      const silentMs = lastProgress > 0 ? now - lastProgress : 0;

      let execState: SessionExecutionState = sessionExecutionState;
      try {
        const r = await window.agenticxDesktop.listSessions(pane.avatarId ?? undefined);
        if (cancelled || !r.ok) return;
        const row = (r.sessions ?? []).find((s) => s.session_id === sid);
        if (row?.execution_state) {
          execState = row.execution_state as SessionExecutionState;
          const prev = prevExecutionStateBySidRef.current[sid] ?? "idle";
          if (prev === "running" && execState === "idle" && runGuardSessionId !== sid) {
            setBgCompleteToast(true);
            addPaneMessage(pane.id, "tool", "后台任务已完成", "meta");
            await mergeTailFromDisk(sid);
            // Re-check after the await: the user may have switched away while the
            // tail merged — never write this session's exec state onto a sibling.
            if (cancelled) return;
          }
          prevExecutionStateBySidRef.current[sid] = execState;
          setSessionExecutionState(execState);
          if (execState === "idle" && runGuardSessionId === sid) {
            setRunGuardSessionId("");
          }
        }
      } catch {
        /* ignore */
      }

      const livePane = useAppStore.getState().panes.find((p) => p.id === pane.id);
      const msgs = livePane?.messages ?? [];
      // Channel C must not fire on the empty window between a session switch
      // (which clears messages: []) and the async re-load completing — otherwise
      // a completed session shows a false「已停滞/已中断」, especially when another
      // running session is slowing the single backend event loop.
      const messagesHydrated = sessionMessagesHydrated({
        loadingMessages: livePane?.loadingMessages,
        messageCount: msgs.length,
      });
      const enteredAt = sessionEnteredAtRef.current[sid] ?? now;
      const graceMs = now - enteredAt;

      const userStopped = Boolean(userStoppedSessionRef.current[sid]);
      if (shouldSuppressStallDetection(runGuardSessionId, sid, userStopped)) {
        setStallState("none");
        if (execState === "interrupted" || execState === "idle") {
          setRunGuardSessionId("");
        }
        return;
      }

      if (isFutileResume(msgs)) {
        setStallState("none");
        setStallRejectReason("");
        return;
      }

      const stallSilenceMs = stallDetectSilenceMs(stallRuntimeConfig.stall_detect_silence_seconds);
      const channelA = sseActive && lastProgress > 0 && silentMs >= stallSilenceMs;
      const channelB =
        !sseActive &&
        execState === "running" &&
        lastProgress > 0 &&
        silentMs >= stallSilenceMs;
      const channelC =
        graceMs >= CHANNEL_C_GRACE_MS &&
        shouldTriggerIncompleteEndStall(execState, sseActive, msgs, graceMs, messagesHydrated);

      if (channelA || channelB || channelC) {
        // channelC = idle session whose last turn produced no visible reply
        // (ended-incomplete); channelA/B = a running turn gone silent.
        setStallReason(channelA || channelB ? "silent" : "incomplete");
        setStallState("stall");
        return;
      }

      if (stallState === "stall") {
        const recovered =
          execState === "idle" && lastTurnHasCompletedAssistantReply(msgs);
        const progressOk = silentMs < stallSilenceMs;
        if (recovered || (progressOk && (sseActive || execState !== "running"))) {
          setStallState("none");
        }
      }
    };

    void evaluate();
    const shouldPollFast =
      sessionExecutionState === "running" ||
      stallState === "stall" ||
      stallState === "exhausted" ||
      runGuardSessionId === sid;
    const intervalMs = shouldPollFast ? 2000 : 8000;
    const timer = window.setInterval(() => {
      setStallTick((t) => t + 1);
      void evaluate();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    addPaneMessage,
    mergeTailFromDisk,
    pane.avatarId,
    pane.id,
    pane.sessionId,
    runGuardSessionId,
    sessionExecutionState,
    stallRuntimeConfig.stall_detect_silence_seconds,
    stallState,
  ]);

  useEffect(() => {
    if (!stallRuntimeConfig.stall_auto_nudge_enabled) return;
    const sid = (pane.sessionId || "").trim();
    const sseActive = Boolean(sessionStreamStateRef.current[sid]?.active);
    const runInFlight =
      runGuardSessionId === sid || Boolean(sessionAbortControllersRef.current[sid]);
    if (
      !shouldAllowStallAutoNudge(stallState, sessionExecutionState, Boolean(budgetExceededInfo), {
        sseActive,
        runInFlight,
      })
    ) {
      return;
    }
    if (!sid) return;
    if (silentSeconds < stallRuntimeConfig.stall_auto_nudge_after_seconds) return;
    const count = autoNudgeTriggeredRef.current[sid] ?? 0;
    if (count >= stallRuntimeConfig.stall_auto_nudge_max_per_session) return;
    const bucket = Math.floor(
      silentSeconds / Math.max(1, stallRuntimeConfig.stall_auto_nudge_after_seconds)
    );
    if ((autoNudgeBucketRef.current[sid] ?? -1) >= bucket) return;
    autoNudgeBucketRef.current[sid] = bucket;
    autoNudgeTriggeredRef.current[sid] = count + 1;
    setAutoNudgeCount(count + 1);
    const reason: ContinueReason =
      sessionExecutionState === "interrupted"
        ? "interrupted"
        : stallState === "exhausted"
          ? "exhausted"
          : "stall";
    void sendChatRef.current("", {
      lockedSessionId: sid,
      continuation: { reason, source: "desktop_auto_nudge" },
    });
  }, [
    pane.id,
    pane.sessionId,
    runGuardSessionId,
    sessionExecutionState,
    silentSeconds,
    stallRuntimeConfig,
    stallState,
    budgetExceededInfo,
  ]);

  useEffect(() => {
    if (!sessionUnattended || !unattendedGlobalEnabled) return;
    if (Boolean(budgetExceededInfo)) return;
    const sid = (pane.sessionId || "").trim();
    const sseActive = Boolean(sessionStreamStateRef.current[sid]?.active);
    const runInFlight =
      runGuardSessionId === sid || Boolean(sessionAbortControllersRef.current[sid]);
    if (
      !shouldAllowStallAutoNudge(stallState, sessionExecutionState, false, {
        sseActive,
        runInFlight,
      })
    ) {
      return;
    }
    if (!sid) return;
    if (silentSeconds < unattendedStallContinueAfterSeconds) return;
    const count = unattendedContinueTriggeredRef.current[sid] ?? 0;
    if (count >= unattendedMaxContinuations) return;
    const bucket = Math.floor(
      silentSeconds / Math.max(1, unattendedStallContinueAfterSeconds),
    );
    if ((unattendedContinueBucketRef.current[sid] ?? -1) >= bucket) return;
    unattendedContinueBucketRef.current[sid] = bucket;
    unattendedContinueTriggeredRef.current[sid] = count + 1;
    setUnattendedContinueCount(count + 1);
    const reason: ContinueReason =
      sessionExecutionState === "interrupted"
        ? "interrupted"
        : stallState === "exhausted"
          ? "exhausted"
          : "stall";
    void sendChatRef.current("", {
      lockedSessionId: sid,
      continuation: { reason, source: "supervisor" },
    });
  }, [
    budgetExceededInfo,
    pane.sessionId,
    sessionExecutionState,
    sessionUnattended,
    silentSeconds,
    stallState,
    unattendedGlobalEnabled,
    unattendedMaxContinuations,
    unattendedStallContinueAfterSeconds,
  ]);

  useEffect(() => {
    if (!bgCompleteToast) return;
    const t = window.setTimeout(() => setBgCompleteToast(false), 3000);
    return () => window.clearTimeout(t);
  }, [bgCompleteToast]);

  useEffect(() => {
    if (!stallHintToast) return;
    const t = window.setTimeout(() => setStallHintToast(""), 2800);
    return () => window.clearTimeout(t);
  }, [stallHintToast]);

  const resumeCurrentTask = useCallback(async () => {
    const sid = (pane.sessionId || "").trim();
    if (!sid || resumeInFlightRef.current[sid]) return;

    // Guard: skip futile resumes. When the last turn_interrupted follows a
    // complete assistant reply and all todos are done, resuming only makes
    // the model re-announce "task done" and re-verify outputs — a loop.
    const guardMsgs =
      useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ??
      pane.messages ??
      [];
    if (isFutileResume(guardMsgs)) {
      addPaneMessage(pane.id, "tool", "✅ 任务已全部完成，无需恢复执行。", "meta", undefined, undefined, undefined, {
        metadata: { kind: "futile_resume_guard" },
      });
      setStallState("none");
      setStallRejectReason("");
      return;
    }

    beginResumeInFlight(sid);
    delete userStoppedSessionRef.current[sid];
    let state: SessionExecutionState = sessionExecutionState;
    try {
      const r = await window.agenticxDesktop.listSessions(pane.avatarId ?? undefined);
      if (r.ok) {
        const row = (r.sessions ?? []).find((s) => s.session_id === sid);
        state = (row?.execution_state ?? "idle") as SessionExecutionState;
        setSessionExecutionState(state);
      }
    } catch {
      /* ignore */
    }

    await interruptForResume(sid);

    // Keep the stall/exhausted card mounted (now in "恢复中…" state) until the
    // continuation succeeds (continuation_notice / first SSE frame) or is
    // rejected. Clearing stallState here would unmount the card and hide the
    // inline reject reason, regressing FR-4.
    setStallRejectReason("");
    const reason = inferContinueReason({
      stallState,
      executionState: state === "running" ? "interrupted" : state,
    });
    void sendChatRef.current("", {
      lockedSessionId: sid,
      continuation: { reason, source: "desktop_manual" },
    });
  }, [addPaneMessage, beginResumeInFlight, interruptForResume, pane.avatarId, pane.id, pane.messages, pane.sessionId, sessionExecutionState, stallState]);

  const resumeWithModel = useCallback(
    async (provider: string, model: string) => {
      setPaneModel(pane.id, provider, model);
      void window.agenticxDesktop.saveConfig({ activeProvider: provider, activeModel: model });
      const sid = (pane.sessionId || "").trim();
      if (sid) {
        void window.agenticxDesktop.setSessionModel({ sessionId: sid, provider, model });
      }
      await resumeCurrentTask();
    },
    [pane.id, pane.sessionId, resumeCurrentTask, setPaneModel]
  );

  const sendFollowupChip = useCallback(
    (text: string, ctx?: { ownerSessionId?: string }) => {
      const t = String(text || "").trim();
      if (!t) return;
      const paneSid = (pane.sessionId || "").trim();
      const ownerSid = String(ctx?.ownerSessionId ?? paneSid).trim();
      if (!ownerSid) return;
      if (paneSid && ownerSid !== paneSid) {
        console.warn(
          "[ChatPane] followup ignored — chip owner %s but pane shows %s",
          ownerSid,
          paneSid,
        );
        return;
      }
      void sendChatRef.current(t, { lockedSessionId: ownerSid });
    },
    [pane.sessionId],
  );

  const sendQueuedMessageNow = useCallback(
    (msgId: string) => {
      const item = takePendingMessage(paneId, msgId);
      if (!item) return;
      const lockedSessionId = String(item.sessionId ?? "").trim() || (
        useAppStore.getState().panes.find((p) => p.id === paneId)?.sessionId || ""
      ).trim();
      void sendChatRef.current(item.text, {
        lockedSessionId: lockedSessionId || undefined,
        retryAttachments: item.attachments,
        forceSend: true,
      });
    },
    [paneId, takePendingMessage]
  );

  const applySkillPatchPreview = useCallback(
    (message: Message, payload: SkillPatchPreviewPayload, targetIndex: number | null) => {
      const args = (message.toolArgs ?? {}) as Record<string, unknown>;
      const skillName = String(args.name ?? "").trim();
      const oldString = String(args.old_string ?? "");
      const newString = String(args.new_string ?? "");
      const beforeContext = String(args.before_context ?? "");
      const afterContext = String(args.after_context ?? "");
      const replaceAll = Boolean(args.replace_all);
      const patchToken = String(payload.patch_token ?? "").trim();
      const sid = String(message.ownerSessionId ?? pane.sessionId ?? "").trim();
      if (!sid || !skillName || !oldString) return;
      const applyArgs: Record<string, unknown> = {
        action: "patch",
        name: skillName,
        mode: "apply",
        old_string: oldString,
        new_string: newString,
      };
      if (patchToken) applyArgs.patch_token = patchToken;
      if (beforeContext) applyArgs.before_context = beforeContext;
      if (afterContext) applyArgs.after_context = afterContext;
      if (replaceAll) applyArgs.replace_all = true;
      if (targetIndex !== null && Number.isFinite(targetIndex)) {
        applyArgs.target_index = targetIndex;
      }
      const instruction =
        [
          "请立即且仅执行一次工具调用，不要输出解释文字。",
          "tool_name: skill_manage",
          `arguments: ${JSON.stringify(applyArgs)}`,
          "执行完成后再返回结果。",
        ].join("\n");
      void sendChatRef.current(instruction, {
        lockedSessionId: sid,
        suppressUserEcho: true,
        skipUserHistory: true,
        forceSend: true,
      });
    },
    [pane.sessionId]
  );

  const openSubAgentDetailFromCluster = useCallback(
    async (runId: string) => {
      const rid = String(runId ?? "").trim();
      if (!rid) return;

      const live = paneSubAgents.find((item) => item.id === rid);
      if (live) {
        togglePaneSubAgentChat(rid);
        closeRunDrawer(pane.id);
        return;
      }

      const sid = String(pane.sessionId ?? "").trim();
      if (!sid || !apiBase || !apiToken) return;

      try {
        const [detailResp, activityResp] = await Promise.all([
          fetchRunDetail(apiBase, apiToken, sid, rid),
          fetchRunActivityPage(apiBase, apiToken, sid, rid, 0, 200),
        ]);
        if (!detailResp.ok || !detailResp.run) return;

        const hydrated = buildSubAgentFromRunRecord(
          detailResp.run as SubAgentRunRecord,
          activityResp.entries ?? [],
          sid,
        );
        const store = useAppStore.getState();
        if (store.subAgents.some((item) => item.id === rid)) {
          store.updateSubAgent(rid, hydrated);
        } else {
          store.addSubAgent({
            id: rid,
            name: hydrated.name,
            role: hydrated.role,
            // 历史运行传空 task：避免 SubAgentCard 在历史态回显「详细指令」块
            task: "",
            provider: hydrated.provider,
            model: hydrated.model,
            sessionId: sid,
          });
          store.updateSubAgent(rid, {
            status: hydrated.status,
            currentAction: hydrated.currentAction,
            progress: hydrated.progress,
            resultSummary: hydrated.resultSummary,
            resultFile: hydrated.resultFile,
            outputFiles: hydrated.outputFiles,
            events: hydrated.events,
          });
        }

        closeRunDrawer(pane.id);
        // 任务仍在执行时禁止切入对话（与 togglePaneSubAgentChat 的拦截语义一致）；
        // 明细已写入 store，用户仍可在 Spawns 列看到实时状态，只是不能切到对话态。
        if (isSubAgentLiveStatus(hydrated.status)) {
          setStallHintToast("该智能体任务执行中，完成后才能进入对话");
          return;
        }
        if (!pane.spawnsColumnOpen) setSpawnsColumnOpen(pane.id, true);
        setSelectedSubAgent(rid);
      } catch {
        // Ignore — cluster card stays interactive; user can retry click.
      }
    },
    [
      apiBase,
      apiToken,
      closeRunDrawer,
      pane.id,
      pane.sessionId,
      pane.spawnsColumnOpen,
      paneSubAgents,
      setSelectedSubAgent,
      setSpawnsColumnOpen,
      setStallHintToast,
    ],
  );

  const togglePaneSubAgentChat = (agentId: string) => {
    if (selectedSubAgent === agentId) {
      setSelectedSubAgent(null);
      return;
    }
    const sub = paneSubAgents.find((item) => item.id === agentId);
    const isDelegation =
      agentId.startsWith("dlg-") ||
      !!(sub?.events?.some((evt) => evt.type.startsWith("delegation")));
    if (isDelegation) {
      void openDelegatedAvatarSession(agentId);
      return;
    }
    // 任务仍在执行（含等待确认/等待输入）时禁止切入对话：避免上下文被轻易打断；
    // 提醒用户等任务完成后再进入。不影响「关闭对话」（上方已提前 return）。
    if (sub && isSubAgentLiveStatus(sub.status)) {
      setStallHintToast("该智能体任务执行中，完成后才能进入对话");
      return;
    }
    // 选中一个成员即视为「手动开启」明细面板的动作（无论触发源是内联集群卡还是
    // Spawns 列自身），确保 Spawns 列可见，否则 selectedSubAgent 的明细卡无处渲染。
    if (!pane.spawnsColumnOpen) setSpawnsColumnOpen(pane.id, true);
    setSelectedSubAgent(agentId);
  };

  const renderedMessages = useMemo(() => {
    const reactActionStyle = getAssistantActionStyle({ inReActRow: true });
    const renderGroupedRow = (
      row: GroupedChatRow,
      rowIdx: number,
      opts: {
        reactWorkColumn?: boolean;
        reactFlat?: boolean;
        reactHideBadge?: boolean;
        reactShowActions?: boolean;
        omitSuggestedQuestions?: boolean;
        actionRhythmBodyTail?: boolean;
        holdToolGroupProgress?: boolean;
      }
    ) => {
      const reactCol = opts.reactWorkColumn ?? false;
      const reactFlat = opts.reactFlat ?? false;
      const reactHideBadge = opts.reactHideBadge ?? false;
      const reactShowActions = opts.reactShowActions ?? false;
      const omitSuggestedQuestions = opts.omitSuggestedQuestions ?? false;
      const actionRhythmBodyTail = opts.actionRhythmBodyTail ?? false;
      const holdToolGroupProgress = opts.holdToolGroupProgress ?? false;
      if (row.kind === "message") {
        const message = row.message;
        const canRetryThisUserMessage = message.role === "user" && !isStreamingCurrentSession;
        const isSelecting = selectedMessageIds.size > 0;
        const rowSelectable = isSelecting && !reactCol;
        const isSelected = selectedMessageIds.has(message.id);
        const groupSender = isGroupPane ? resolveGroupSender(message) : null;
        const imUserName = isGroupPane ? groupChatUserLabel : userBubbleLabel;
        const imAssistantName = groupSender?.name ?? paneAvatarMeta.name;
        const imAssistantAvatarUrl = groupSender?.url ?? paneAvatarMeta.url;
        return (
          <div
            key={message.id}
            className={`group/sel relative${actionRhythmBodyTail ? ` ${ASSISTANT_BODY_TAIL_CLASS}` : ""}`}
          >
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
                message.role === "assistant" && !reactHideBadge && showInlineAssistantModelBadge ? (
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
              onOpenFileReference={(request) => openFileReferencePreview(request)}
              onOpenSubAgentRun={openSubAgentDetailFromCluster}
              assistantName={imAssistantName}
              assistantAvatarUrl={imAssistantAvatarUrl}
              userName={imUserName}
              userAvatarUrl={userAvatarUrl || undefined}
              showSenderIdentity={isGroupPane}
              senderAvatarVariant="rounded-square"
              senderAvatarId={groupSender?.avatarId}
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
              actionRhythmBodyTail={actionRhythmBodyTail}
              budgetExceededActive={Boolean(budgetExceededInfo)}
              allMessages={pane.messages ?? []}
              sessionId={(pane.sessionId || "").trim() || undefined}
              onResumeInNewSession={() => resumeInNewSessionRef.current()}
              onOpenBudgetSettings={() => useAppStore.getState().openSettings("automation")}
              onResumeTask={() => void resumeCurrentTask()}
              resumeInFlight={resumeInFlight}
              isFutileResume={isFutileResumeFlag}
              sessionBusy={sessionBusy}
              isLastAssistantInPane={
                message.role === "assistant" && message.id === lastAssistantMessageId
              }
              streamStalled={message.id === "__stream__" && stallState === "stall"}
              streamStalledSeconds={message.id === "__stream__" ? silentSeconds : 0}
              onSkillManageApply={applySkillPatchPreview}
              onOpenClarification={onOpenClarification}
              onSubmitClarification={onSubmitClarification}
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
            holdProgress={holdToolGroupProgress}
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
            onSkillManageApply={applySkillPatchPreview}
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
            const lastToolGroupIdxInWork = groupedWork.reduce(
              (acc, row, index) => (row.kind === "tool_group" ? index : acc),
              -1,
            );
            const hasTools = groupedWork.some(
              (r) => r.kind === "tool_group" || (r.kind === "message" && r.message.role === "tool")
            );
            const hasStreamingRow = groupedWork.some(
              (r) => r.kind === "message" && r.message.role === "assistant" && r.message.id === "__stream__"
            );
            const hasViewImageInject = workMessages.some(isViewImageInjectMessage);
            const useUnifiedReActCard = hasTools || hasStreamingRow || hasViewImageInject;
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
              <div key={blockKey} className="agx-assistant-action-rhythm mb-6 flex flex-col gap-2.5">
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
                    (() => {
                      const actionTailReady =
                        !hasStreamingRow && !sessionWorkInProgress && workMessages.length > 0;
                      const rhythmEndIdx =
                        actionTailReady && groupedWork.length > 0
                          ? groupedWork.length - 1
                          : groupedWork.length;
                      const headRows = groupedWork.slice(0, rhythmEndIdx);
                      const tailRow =
                        rhythmEndIdx < groupedWork.length ? groupedWork[rhythmEndIdx] : null;

                      const renderReActBlockActionIcons = () => (
                        <div className={ASSISTANT_ACTION_ICON_ROW_CLASS} style={reactActionStyle}>
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
                                  <Forward size={13} />
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
                          <MessageTimestamp ts={lastAssistantInBlock?.timestamp} align="left" />
                        </div>
                      );

                      const renderReActBlockFollowups = () =>
                        peeledFollowupAssistant?.suggestedQuestions &&
                        peeledFollowupAssistant.suggestedQuestions.length > 0 ? (
                          <div className={ASSISTANT_FOLLOWUP_LIST_CLASS} style={reactActionStyle}>
                            {peeledFollowupAssistant.suggestedQuestions.slice(0, 3).map((q, qi) => (
                              <button
                                key={`${qi}-${q}`}
                                type="button"
                                className={ASSISTANT_FOLLOWUP_CHIP_CLASS}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() =>
                                  sendFollowupChip(q, {
                                    ownerSessionId: peeledFollowupAssistant?.ownerSessionId,
                                  })
                                }
                              >
                                <span>{q}</span>
                                <ArrowRight className="h-3 w-3 shrink-0 opacity-50 transition group-hover:opacity-80" />
                              </button>
                            ))}
                          </div>
                        ) : null;

                      const mapGroupedRow = (r: GroupedChatRow, i: number) => {
                        const omitSq = Boolean(
                          peeledFollowupAssistant &&
                            r.kind === "message" &&
                            r.message.role === "assistant" &&
                            r.message.id === peeledFollowupAssistant.id
                        );
                        const bodyTail = Boolean(
                          omitSq &&
                            actionTailReady &&
                            tailRow &&
                            r === tailRow
                        );
                        return renderGroupedRow(r, i, {
                          reactWorkColumn: true,
                          reactFlat: true,
                          reactHideBadge: i > 0,
                          omitSuggestedQuestions: omitSq,
                          actionRhythmBodyTail: bodyTail,
                          holdToolGroupProgress:
                            r.kind === "tool_group" &&
                            i === lastToolGroupIdxInWork &&
                            shouldHoldToolGroupProgress(
                              workMessages,
                              r.messages,
                              isStreamingCurrentSession
                            ),
                        });
                      };

                      return (
                        <div className="min-w-0 flex-1 overflow-hidden">
                          {headRows.map((r, i) => mapGroupedRow(r, i))}
                          {actionTailReady && tailRow ? (
                            <div className={ASSISTANT_ACTION_RHYTHM_END_CLASS}>
                              {mapGroupedRow(tailRow, rhythmEndIdx)}
                              {renderReActBlockActionIcons()}
                              {renderReActBlockFollowups()}
                            </div>
                          ) : actionTailReady ? (
                            <>
                              {renderReActBlockActionIcons()}
                              {renderReActBlockFollowups()}
                            </>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col gap-0">
                      {groupedWork.map((r, i) =>
                        renderGroupedRow(r, i, {
                          reactWorkColumn: true,
                          reactFlat: true,
                          reactShowActions: true,
                        }),
                      )}
                    </div>
                  )}
                </div>
                {finalAssistant
                  ? renderGroupedRow({ kind: "message", message: finalAssistant }, segIdx + 1000, {})
                  : null}
              </div>
            );
          })
        : groupedVisibleMessages.map((row, rowIdx) => {
            const lastToolGroupIdx = groupedVisibleMessages.reduce(
              (acc, groupedRow, index) => (groupedRow.kind === "tool_group" ? index : acc),
              -1,
            );
            return renderGroupedRow(row, rowIdx, {
              holdToolGroupProgress:
                row.kind === "tool_group" &&
                rowIdx === lastToolGroupIdx &&
                shouldHoldToolGroupProgress(pane.messages ?? [], row.messages, isStreamingCurrentSession),
            });
          });

    return (
    <>
      {mainRows}
      {Object.entries(groupTyping).map(([agentId, name]) => {
        const typingSender = resolveGroupSender({
          role: "assistant",
          avatarName: name,
          avatarUrl: undefined,
          agentId,
        });
        return (
          <ImBubble
            key={`typing-${agentId}`}
            message={{ id: `typing-${agentId}`, role: "assistant", content: "", avatarName: name, agentId }}
            assistantName={typingSender.name}
            assistantAvatarUrl={typingSender.url}
            showSenderIdentity={isGroupPane}
            senderAvatarVariant="rounded-square"
            senderAvatarId={typingSender.avatarId}
          />
        );
      })}
      {((sessionWorkInProgress && !isStreamingCurrentSession) || midTurnStreamActivity) &&
      !isGroupPane ? (
        <div className={useReActImLayout ? "-mt-2" : undefined}>
          <ImBubble
            key="typing-meta"
            message={{ id: "typing-meta", role: "assistant", content: "" }}
            assistantName={paneAvatarMeta.name}
            assistantAvatarUrl={paneAvatarMeta.url}
            assistantVisual={useReActImLayout ? "compact-inline" : "default"}
            noBubbleBorder={useReActImLayout}
            streamStalled={stallState === "stall"}
            streamStalledSeconds={silentSeconds}
          />
        </div>
      ) : null}
      {isStreamingCurrentSession && !hideStreamOverlayAsDuplicate && !useReActImLayout ? (
        chatStyle === "terminal" ? (
          <TerminalLine
            message={streamAssistantMessage}
            badge={
              showInlineAssistantModelBadge && streamingModel ? (
                <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
              ) : undefined
            }
          />
        ) : chatStyle === "clean" ? (
          <CleanBlock
            message={streamAssistantMessage}
            badge={
              showInlineAssistantModelBadge && streamingModel ? (
                <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
              ) : undefined
            }
          />
        ) : (
          <ImBubble
            message={streamAssistantMessage}
            resolvedReferences={resolveReferencesForAssistant(
              streamAssistantMessage,
              visibleMessagesWithStream,
            )}
            highlightTerms={pane.historySearchTerms}
            badge={
              showInlineAssistantModelBadge && streamingModel ? (
                <ModelBadge provider={streamingModel.provider} model={streamingModel.model} />
              ) : undefined
            }
            assistantName={paneAvatarMeta.name}
            assistantAvatarUrl={paneAvatarMeta.url}
            streamStalled={stallState === "stall"}
            streamStalledSeconds={silentSeconds}
          />
        )
      ) : null}
      {stallState === "stall" && (
        <StallRecoveryCard
          kind="stall"
          reason={stallReason}
          currentModelLabel={isAutomationTaskPane ? undefined : currentModelLabel}
          modelOptions={stallModelOptions}
          autoNudgeCount={autoNudgeCount}
          autoNudgeMax={stallRuntimeConfig.stall_auto_nudge_max_per_session}
          resumeInFlight={resumeInFlight}
          rejectReason={stallRejectReason}
          onResume={() => void resumeCurrentTask()}
          onResumeWithModel={(provider, model) => void resumeWithModel(provider, model)}
          onStop={() => void stopCurrentRun()}
          stopInFlight={stoppingSessionId === (pane.sessionId || "").trim()}
        />
      )}
      {stallState === "exhausted" && (
        <StallRecoveryCard
          kind="exhausted"
          rounds={exhaustedRounds?.rounds}
          maxRounds={exhaustedRounds?.maxRounds}
          currentModelLabel={isAutomationTaskPane ? undefined : currentModelLabel}
          modelOptions={stallModelOptions}
          resumeInFlight={resumeInFlight}
          rejectReason={stallRejectReason}
          onResume={() => void resumeCurrentTask()}
          onResumeWithModel={(provider, model) => void resumeWithModel(provider, model)}
          onStop={() => void stopCurrentRun()}
          stopInFlight={stoppingSessionId === (pane.sessionId || "").trim()}
          onOpenSettings={() => useAppStore.getState().openSettings()}
        />
      )}
    </>
    );
  }, [autoNudgeCount, budgetExceededInfo, chatStyle, copyMessage, copyReActBlock, currentModelLabel, exhaustedRounds, favoriteMessage, forwardOneMessage, groupChatUserLabel, groupTyping, groupedVisibleMessages, openSubAgentDetailFromCluster, hideStreamOverlayAsDuplicate, input, isGroupPane, isRunGuardCurrentSession, isStreamingCurrentSession, lastAssistantMessageId, midTurnStreamActivity, openFileReferencePreview, pane.historySearchTerms, pane.messages, pane.sessionId, paneAvatarMeta, paneId, readyAttachments.length, resolveGroupInlineConfirm, resolveGroupSender, resolveQuoteBody, resumeCurrentTask, resumeInFlight, resumeWithModel, revealFileInTaskspace, retryUserMessage, selectUpTo, selectedMessageIds, sendFollowupChip, sessionBusy, sessionWorkInProgress, setQuoteTarget, showInlineAssistantModelBadge, silentSeconds, stallModelOptions, stallRejectReason, stallRuntimeConfig.stall_auto_nudge_max_per_session, stallState, stopCurrentRun, streamTextForCurrentSession, streamingModel, toggleSelectBlock, toggleSelectMessage, topLevelRowsIm, userAvatarUrl, userBubbleLabel]);

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

    if (isReferenceableDocumentFile(file)) {
      const absolutePath = window.agenticxDesktop?.getPathForFile?.(file) || "";
      if (absolutePath) {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
            status: "ready",
            content: `[附件] ${file.name}`,
            sourcePath: absolutePath,
          },
        }));
        return;
      }
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

  useEffect(() => {
    if (!voiceInputHint) return;
    const t = window.setTimeout(() => setVoiceInputHint(""), 4200);
    return () => window.clearTimeout(t);
  }, [voiceInputHint]);

  const applyVoiceTranscript = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const next = appendDictationText(extractComposerText(), trimmed);
      setComposerText(next);
    },
    [extractComposerText, setComposerText]
  );

  const { pttActive, pttLiveText, cancelPtt } = useVoicePushToTalk({
    enabled: Boolean(pane.sessionId),
    composerEmpty: !input.trim(),
    apiBase,
    apiToken,
    language: "zh-CN",
    onCommit: applyVoiceTranscript,
    onError: (message) => setVoiceInputHint(message),
  });

  useEffect(() => () => cancelPtt(), [cancelPtt]);

  const onMicClick = () => {
    cancelPtt();
    if (recording || voiceTranscribing) {
      dictationSessionRef.current?.stop();
      dictationSessionRef.current = null;
      setRecording(false);
      setVoiceTranscribing(false);
      return;
    }
    setVoiceInputHint("");
    void startDictation(
      {
        onPhase: (phase: SttPhase) => {
          setRecording(phase === "recording");
          setVoiceTranscribing(phase === "transcribing");
        },
        onInterim: (interim) => {
          if (!interim.trim()) return;
          setVoiceInputHint(interim.trim());
        },
        onFinal: (text) => {
          dictationSessionRef.current = null;
          setRecording(false);
          setVoiceTranscribing(false);
          setVoiceInputHint("");
          applyVoiceTranscript(text);
        },
        onError: (message) => {
          setVoiceInputHint(message);
        },
      },
      {
        apiBase,
        apiToken,
        language: "zh",
      }
    ).then((session) => {
      dictationSessionRef.current = session;
    });
  };

  const sendChatRef = useRef<(
    text: string,
    options?: {
      retryAttachments?: MessageAttachment[];
      suppressUserEcho?: boolean;
      skipUserHistory?: boolean;
      forceSend?: boolean;
      lockedSessionId?: string;
      continuation?: { reason: ContinueReason; source: ContinueSource };
    }
  ) => Promise<void>>(
    async () => {}
  );
  const resumeInNewSessionRef = useRef<() => void>(() => {});

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
      forceSend?: boolean;
      lockedSessionId?: string;
      continuation?: { reason: ContinueReason; source: ContinueSource };
    }
  ) => {
    const continuation = options?.continuation;
    const isContinuation = !!continuation;
    const text = userText.trim();
    const messageText = isContinuation ? " " : text || ATTACHMENT_ONLY_USER_PROMPT;
    const retryAttachments = options?.retryAttachments;
    let suppressUserEcho = isContinuation || !!options?.suppressUserEcho;
    let skipUserHistory = isContinuation || !!options?.skipUserHistory;
    const readyEntries = attachmentEntries.filter(([, file]) => file.status === "ready");
    const composerAttachments: MessageAttachment[] = readyAttachments.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      dataUrl: file.dataUrl,
      sourcePath: file.sourcePath,
      referenceToken: file.referenceToken,
      composerRefLabel: file.composerRefLabel,
      lineRange: file.lineRange,
      spreadsheetRef: file.spreadsheetRef,
      snippetRef: file.snippetRef,
      snippetContent: file.snippetContent,
    }));
    const rawUserAttachments: MessageAttachment[] =
      retryAttachments && retryAttachments.length > 0
        ? retryAttachments.map((item) => ({ ...item }))
        : composerAttachments;
    // Do not drop reference/workspace attachments when the user asks a short follow-up without @文件名;
    // otherwise context_files never reaches the model and the file looks "invisible".
    const userAttachments: MessageAttachment[] = rawUserAttachments;
    const refAttachments = userAttachments.filter((item) => isWorkspaceReferenceAttachment(item));
    const outboundMessageText =
      refAttachments.length > 0
        ? rewriteUserReferenceMentions(messageText, refAttachments)
        : messageText;
    const hasReadyAttachments = userAttachments.length > 0;
    if (!isContinuation && !text && !hasReadyAttachments) return;
    if (!apiBase) return;

    const sendLockKey = pane.id;
    const targetSendSid = (options?.lockedSessionId || pane.sessionId || "").trim();
    const inFlightForPane =
      sendChatInFlightRef.current?.paneId === sendLockKey
        ? (sendChatInFlightRef.current.sessionId || "").trim()
        : "";
    const canQueueFollowUp =
      !isContinuation && !options?.suppressUserEcho && !options?.skipUserHistory;
    const awaitingFreshSession = isPaneAwaitingFreshSession(pane.id);

    const resolveStreamRunActive = (sessionKey: string) =>
      isStreamRunActiveForQueue({
        sessionId: sessionKey,
        streamStateActive: !!sessionStreamStateRef.current[sessionKey]?.active,
        sendInFlightForSession:
          !!inFlightForPane && inFlightForPane === sessionKey.trim(),
        executionState: sessionExecutionState,
        currentSessionId: pane.sessionId || "",
      });

    const tryEnqueueFollowUp = (sessionKey: string): boolean => {
      const sid = sessionKey.trim();
      if (!sid || !canQueueFollowUp) return false;
      if (
        !shouldEnqueueOnResend({
          isStreamRunActive: resolveStreamRunActive(sid),
          forceSend: options?.forceSend,
        })
      ) {
        return false;
      }
      enqueuePaneMessage(pane.id, {
        id: crypto.randomUUID(),
        text: messageText,
        sessionId: sid,
        attachments: userAttachments,
        contextFiles: [],
        timestamp: Date.now(),
      });
      setComposerText("");
      setQuoteTarget(null);
      setContextFiles({});
      return true;
    };

    const queueSessionKey = resolveQueueSessionKey({
      currentSessionId: targetSendSid,
      inFlightSessionId: inFlightForPane,
      awaitingFreshSession,
    });
    if (tryEnqueueFollowUp(queueSessionKey)) return;

    // 计算本次发送的目标 session（用于跨 session 并发判断）
    let holdSendLock = false;
    const releaseSendLock = () => {
      if (holdSendLock && sendChatInFlightRef.current?.paneId === sendLockKey) {
        sendChatInFlightRef.current = null;
      }
    };
    if (!options?.forceSend) {
      if (sendChatInFlightRef.current?.paneId === sendLockKey) {
        const inFlightSid = sendChatInFlightRef.current.sessionId;
        if (inFlightSid && targetSendSid && inFlightSid !== targetSendSid) {
          // 旧流属于不同 session（用户切换了历史会话后点击 chip）：
          // 不阻断新 session 的发送，也不抢占旧锁（旧流会在 finally 里自行释放）。
          // holdSendLock 保持 false，此次不持锁。
        } else if (isPaneAwaitingFreshSession(pane.id)) {
          // "全新对话" 是显式抢占旧会话：旧流若卡住，必须允许首条消息发送，
          // 否则会表现为输入可见但点击发送无反应。
          sendChatInFlightRef.current = null;
          sendChatInFlightRef.current = { paneId: sendLockKey, sessionId: targetSendSid };
          holdSendLock = true;
        } else if (tryEnqueueFollowUp(inFlightSid || targetSendSid)) {
          return;
        } else {
          console.warn("[ChatPane] dropped concurrent sendChat on pane", sendLockKey);
          return;
        }
      } else {
        sendChatInFlightRef.current = { paneId: sendLockKey, sessionId: targetSendSid };
        holdSendLock = true;
      }
    }

    const useLazySession = !isGroupPane && !isAutomationTaskPane;
    let requestSessionId = resolveSendSessionId(options?.lockedSessionId, pane.sessionId);
    // Dev-only invariant: every async/system send (continuation / retry / queued /
    // forward) MUST lock the session id captured at dispatch time. Reading the live
    // pane.sessionId for these paths is the root cause of cross-session leakage.
    const isSystemStyleSend =
      isContinuation || !!options?.suppressUserEcho || !!options?.skipUserHistory;
    if (
      import.meta.env?.DEV &&
      isSystemStyleSend &&
      !String(options?.lockedSessionId ?? "").trim()
    ) {
      console.warn(
        "[ChatPane] system-style send without lockedSessionId — potential cross-session leak source",
        { source: options?.continuation?.source },
      );
    }
    const clearStopSuppressForSession = (sessionKey: string) => {
      const key = sessionKey.trim();
      if (!key) return;
      delete userStoppedSessionRef.current[key];
      delete stopInFlightRef.current[key];
    };

    if (!requestSessionId) {
      if (!useLazySession) {
        releaseSendLock();
        return;
      }
      try {
        const avatarId =
          pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
        const inheritFrom = peekPaneLazyInheritParent(pane.id);
        const pendingMode = peekPanePendingSessionMode(pane.id) ?? pane.sessionMode ?? "daily_office";
        const created = await window.agenticxDesktop.createSession({
          avatar_id: avatarId,
          session_mode: pendingMode,
          ...(inheritFrom ? { inherit_from_session_id: inheritFrom } : {}),
          ...(chatProvider && chatModel ? { provider: chatProvider, model: chatModel } : {}),
        });
        if (!created.ok || !created.session_id) {
          addPaneMessage(
            pane.id,
            "tool",
            `⚠️ 无法创建会话：${created.error || "未知错误"}。请检查后端服务。`,
            "meta"
          );
          releaseSendLock();
          return;
        }
        requestSessionId = created.session_id;
        migratePaneKbRetrievalModeToSession(pane.id, requestSessionId);
        clearPaneLazyInheritParent(pane.id);
        clearPanePendingSessionMode(pane.id);
        setPaneSessionMode(pane.id, created.session_mode ?? pendingMode);
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
        setPaneSessionId(pane.id, requestSessionId, {
          provider: chatProvider || undefined,
          model: chatModel || undefined,
        });
        clearPaneAwaitingFreshSession(pane.id);
        useAppStore.getState().bumpSessionCatalogRevision();
        window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 450);
      } catch (err) {
        addPaneMessage(pane.id, "tool", `⚠️ 创建会话失败：${String(err)}`, "meta");
        releaseSendLock();
        return;
      }
    }
    const isStreamRunActive = resolveStreamRunActive(requestSessionId);

    if (
      shouldInterruptOnResend({
        isStreamRunActive,
        forceSend: options?.forceSend,
      })
    ) {
      // Force-send while streaming: abort the current run, then start the new round.
      // Partial assistant text is preserved by commitCurrentStreamIfNeeded in finally.
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

      // Brief wait for the aborted SSE finally block to commit any partial
      // assistant text via commitCurrentStreamIfNeeded. Then close the prior
      // turn with an "(已中断)" placeholder if no assistant turn was written —
      // otherwise the next request would feed the model two unanswered user
      // questions and it would answer both.
      await new Promise((r) => setTimeout(r, 60));
      const tailMsgs = (useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? [])
        .filter((m) => m.role !== "tool");
      const lastNonTool = tailMsgs[tailMsgs.length - 1];
      if (!lastNonTool || lastNonTool.role === "user") {
        const interruptedNote = "（已中断）";
        addPaneMessage(pane.id, "assistant", interruptedNote, "meta", chatProvider, chatModel);
        try {
          await fetch(`${apiBase}/api/session/messages/append`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-agx-desktop-token": apiToken,
            },
            body: JSON.stringify({
              session_id: requestSessionId,
              messages: [
                {
                  role: "assistant",
                  content: interruptedNote,
                  metadata: { source: "barge-in" },
                },
              ],
            }),
          });
        } catch (err) {
          console.warn("[ChatPane] append interrupted placeholder failed:", err);
        }
      }
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
      releaseSendLock();
      return;
    }

    if (
      !isContinuation &&
      !skipUserHistory &&
      !options?.suppressUserEcho &&
      messageText.trim() &&
      requestSessionId &&
      !options?.forceSend
    ) {
      const now = Date.now();
      if (
        shouldDropDuplicateUserSend(
          lastUserSendDedupeRef.current,
          requestSessionId,
          messageText,
          now,
        )
      ) {
        console.warn(
          "[ChatPane] dropped duplicate user send within dedupe window",
          requestSessionId,
          messageText.slice(0, 48),
        );
        releaseSendLock();
        return;
      }
      lastUserSendDedupeRef.current = {
        sessionId: requestSessionId,
        text: messageText,
        at: now,
      };
    }

    // Re-sending the same user text after a completed turn (input box, not the retry
    // button) must truncate the prior assistant/tool tail and strip [compacted] blocks;
    // otherwise run_turn proactive compaction re-summarizes the old answer into context.
    if (
      !isContinuation &&
      !skipUserHistory &&
      !options?.suppressUserEcho &&
      messageText.length > 0 &&
      requestSessionId
    ) {
      const currentMsgs =
        useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? pane.messages ?? [];
      let implicitRetryIdx = -1;
      for (let i = currentMsgs.length - 1; i >= 0; i -= 1) {
        const row = currentMsgs[i];
        if (!row || row.role !== "user" || row.content !== messageText) continue;
        if (hasTrailingTurnMessages(currentMsgs, i)) {
          implicitRetryIdx = i;
          break;
        }
      }
      if (implicitRetryIdx >= 0) {
        const userOccurrence = countUserOccurrenceThrough(
          currentMsgs,
          implicitRetryIdx,
          messageText
        );
        const ok = await truncateSessionAtUserMessage(
          requestSessionId,
          messageText,
          "after",
          userOccurrence,
          true
        );
        if (!ok) {
          await reloadSessionFromDisk(requestSessionId);
          releaseSendLock();
          return;
        }
        setPaneMessages(pane.id, currentMsgs.slice(0, implicitRetryIdx + 1));
        suppressUserEcho = true;
        skipUserHistory = true;
      }
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
    if (
      !isContinuation &&
      !options?.forceSend &&
      shouldSuppressDuplicatePendingUserEcho(
        useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? pane.messages ?? [],
        messageText,
      )
    ) {
      suppressUserEcho = true;
      skipUserHistory = true;
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
          {
            ownerSessionId: requestSessionId,
            ...(quoteTarget
              ? {
                  quotedMessageId: quoteTarget.message.id,
                  quotedContent: `${quoteTarget.message.avatarName || quoteTarget.message.agentId || quoteTarget.message.role}: ${quoteTarget.body.slice(0, 120)}`,
                }
              : {}),
          }
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
    clearStopSuppressForSession(requestSessionId);
    setRunGuardSessionId(requestSessionId);
    setSessionExecutionState("running");
    prevExecutionStateBySidRef.current[requestSessionId] = "running";
    useAppStore.getState().markSessionHistoryActive(requestSessionId);
    useAppStore.getState().bumpSessionCatalogRevision();
    recordSseActivity(requestSessionId);
    setStallState("none");
    setExhaustedRounds(null);
    if ((pane.sessionId || "").trim() === requestSessionId) {
      syncStreamingUiForCurrentSession();
    }
    cancelStreamRenderFrame();
    setStreamedAssistantText("");
    setStreamReferences([]);
    setStreamSearchedQueries([]);
    streamCommitRegistryRef.current.beginSession(requestSessionId);
    streamTextRef.current = "";
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
      // Stamp the owning session on every streamed/committed row so the render
      // layer can never surface it under a different conversation, even if this
      // write races a session switch. extras is the 8th positional arg.
      const stamped = [...args] as Parameters<typeof addPaneMessage>;
      stamped[7] = { ...(stamped[7] ?? {}), ownerSessionId: requestSessionId };
      if (!isTargetSessionStillActive()) {
        const bucket = deferredSessionMessagesRef.current[requestSessionId] ?? [];
        bucket.push(stamped);
        deferredSessionMessagesRef.current[requestSessionId] = bucket.slice(-80);
        return;
      }
      addPaneMessage(...stamped);
    };
    let streamReasoningStartedAt: number | null = null;
    const commitCurrentStreamIfNeeded = () => {
      const raw = streamCommitRegistryRef.current.getText(requestSessionId).trim();
      // Trim trailing colon ("：" or ":") that model writes just before calling a tool
      // — prevents orphaned "检查文件：" bubbles before a ToolCallCard.
      const partial = raw.replace(/[：:]\s*$/, "").trimEnd();
      if (
        !partial ||
        isThinkingPlaceholderText(partial) ||
        streamCommitRegistryRef.current.isCommitted(requestSessionId)
      ) {
        return false;
      }
      const parsed = parseReasoningContent(partial);
      const reasoningText = parsed.reasoning.trim();
      const bodyContent = parsed.response.replace(/[：:]\s*$/, "").trimEnd();
      const commitExtras: Record<string, unknown> = {};
      let commitContent = partial;
      if (reasoningText) {
        commitExtras.reasoning = reasoningText.slice(0, 16384);
        let seconds = getCachedReasoningDuration(reasoningText);
        if (seconds === undefined && streamReasoningStartedAt !== null) {
          seconds = measureReasoningSeconds(streamReasoningStartedAt, Date.now());
          setCachedReasoningDuration(reasoningText, seconds);
        }
        if (seconds !== undefined && seconds >= 1) {
          commitExtras.reasoningSeconds = seconds;
        }
        commitContent = bodyContent;
      }
      addPaneMessageIfSessionActive(
        pane.id,
        "assistant",
        commitContent,
        "meta",
        chatProvider,
        chatModel,
        undefined,
        Object.keys(commitExtras).length > 0 ? commitExtras : undefined,
      );
      streamReasoningStartedAt = null;
      streamCommitRegistryRef.current.markCommitted(requestSessionId);
      streamCommitRegistryRef.current.setMidCommit(requestSessionId, partial);
      return true;
    };
    const scheduleStreamTextUpdate = (nextText: string) => {
      streamCommitRegistryRef.current.setText(requestSessionId, nextText);
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

    const turnRefsSnapshot = {
      references: [] as SearchReference[],
      queries: [] as string[],
    };

    try {
      const body: Record<string, unknown> = { session_id: requestSessionId, user_input: outboundMessageText };
      // Idempotency key: backend short-circuits a duplicate POST (double-click /
      // chip burst / retry race) so it never appends a second user row.
      body.client_turn_id = crypto.randomUUID();
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
      // Per-session KB retrieval mode: carry the session's explicit choice so the
      // backend prompt honors it instead of the single global config value.
      if (!isGroupPane && targetAgentId === "meta") {
        const kbMode = resolveEffectiveKbRetrievalMode(
          requestSessionId,
          pane.id,
          kbNewSessionDefaultRef.current,
        );
        body.retrieval_mode = kbMode;
      }
      if (isGroupPane && targetAgentId === "meta") {
        body.group_id = groupChatId;
        body.mentioned_avatar_ids = mentionedAvatarIds;
        body.meta_leader_display_name = metaLeaderDisplayName;
        body.user_display_name = groupChatUserLabel;
      }
      const outboundUserNickname = isGroupPane ? groupChatUserLabel : userBubbleLabel;
      if (outboundUserNickname && outboundUserNickname !== "我" && outboundUserNickname !== "用户") {
        body.user_nickname = outboundUserNickname;
      }
      if (userPreference.trim()) body.user_preference = userPreference.trim();
      // Extract @skill:// references from message text
      const skillSlugMatches = outboundMessageText.match(/@skill:\/\/([^\s@,，。！？\n]+)/g);
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
        // Always forward image data (when present as dataUrl) so the backend can:
        // - inject as vision content for the current turn (if the session's active model supports it), and
        // - persist as history_user_attachments (with data_url) for this session's messages.json.
        // This makes uploaded images durable in the session "section" and reconstructible for
        // later vision models or after restart/model switch. The server normalizes/strips
        // current-turn injection for non-vision sessions; the attachment record is still written.
        if (imageInputs.length > 0) {
          body.image_inputs = imageInputs;
        }
        const contextFilePayload: Record<string, string> = {};
        for (const file of userAttachments) {
          const key = buildContextFileKeyFromAttachment(file);
          if (!key) continue;
          const ready = resolveReadyAttachment(file, readyEntries);
          const isImage = !!file.dataUrl || file.mimeType.startsWith("image/") || !!ready?.dataUrl || ready?.mimeType.startsWith("image/");
          // Chat-uploaded images are carried via image_inputs / persisted attachments only.
          // Do not mirror them into context_files (bare filenames like image.png confuse
          // the model into calling view_image on non-existent workspace paths).
          if (isImage) continue;
          if (ready?.snippetContent) {
            contextFilePayload[key] = ready.snippetContent;
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
        if (isContinuation && continuation) {
          return fetch(continueSessionUrl(apiBase, sessionId), {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
            body: JSON.stringify({
              reason: continuation.reason,
              source: continuation.source,
              suppress_user_echo: true,
            }),
            signal: abortController.signal,
          });
        }
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
      const groupProgressRunId = crypto.randomUUID();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        releaseSendLock();
        return;
      }

      let full = "";
      let cumulativeFull = "";
      let receivedFinalEvent = false;
      let pendingSuggestedQuestions: string[] = [];
      let pendingReferences: SearchReference[] = [];
      let pendingSearchedQueries: string[] = [];
      let pendingReasoning: string | undefined = undefined;
      let pendingReasoningSeconds: number | undefined = undefined;
      const syncTurnRefsSnapshot = () => {
        turnRefsSnapshot.references = pendingReferences;
        turnRefsSnapshot.queries = pendingSearchedQueries;
      };
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
            const sessionStillActive = isTargetSessionStillActive();
            recordSseActivity(requestSessionId);
            const eventAgentId = payload.data?.agent_id ?? "meta";
            if (payload.type === "continuation_notice") {
              const noticeText = String(payload.data?.text ?? "").trim();
              if (noticeText) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "tool",
                  noticeText,
                  "meta",
                  undefined,
                  undefined,
                  undefined,
                  {
                    metadata: {
                      kind: "continuation_notice",
                      source: payload.data?.source,
                      reason: payload.data?.reason,
                      continuation_round: payload.data?.continuation_round,
                    },
                  }
                );
              }
              clearResumeInFlight(requestSessionId);
              if (sessionStillActive) {
                setStallRejectReason("");
                // Continuation accepted: now safe to dismiss the stall/exhausted card.
                setStallState("none");
              }
              continue;
            }
            if (payload.type === "continuation_rejected") {
              const rejectText = String(payload.data?.text ?? "").trim();
              clearResumeInFlight(requestSessionId);
              if (rejectText && sessionStillActive) {
                setStallRejectReason(rejectText);
                // Inline reject only shows inside a mounted recovery card. Fall
                // back to a toast when the user has left the pane OR no card is
                // currently visible (stallState === "none").
                if (stallStateRef.current === "none") {
                  setStallHintToast(rejectText);
                }
              }
              continue;
            }
            if (payload.type === "group_typing") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              continue;
            }
            if (payload.type === "group_progress") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const progressText = String(payload.data?.content ?? "").trim();
              const progressTitle = `${avatarName}：${progressText}`;
              const progressCallId = `${groupProgressRunId}:group-progress:${eventAgentId}`;
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              if (!progressText) continue;
              const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
              if (prevText === progressText) continue;
              lastGroupProgressRef.current[eventAgentId] = progressText;
              const merged = updatePaneMessageByToolCallId(pane.id, progressCallId, {
                content: "",
                toolStatus: "running",
                toolResultPreview: progressTitle,
              });
              if (!merged) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "tool",
                  "",
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  {
                    avatarName,
                    avatarUrl: avatarUrl || undefined,
                    toolCallId: progressCallId,
                    toolName: "group_progress",
                    toolStatus: "running",
                    toolResultPreview: progressTitle,
                  }
                );
              }
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
              updatePaneMessageByToolCallId(pane.id, `${groupProgressRunId}:group-progress:${eventAgentId}`, {
                toolStatus: errorText.trim() ? "error" : "done",
              });
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
              updatePaneMessageByToolCallId(pane.id, `${groupProgressRunId}:group-progress:${eventAgentId}`, {
                toolStatus: "cancelled",
              });
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
              recordProgressActivity(requestSessionId);
              const name = String(payload.data?.name ?? "tool");
              const sec = Number(payload.data?.elapsed_seconds ?? 0);
              if (eventAgentId === "meta" && sessionStillActive) {
                setLastToolProgress({ name, sec: Number.isFinite(sec) ? sec : 0 });
              }
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
                if (/<think>/i.test(full) && streamReasoningStartedAt === null) {
                  streamReasoningStartedAt = Date.now();
                }
                scheduleStreamTextUpdate(full);
              } else {
                const tok = String(payload.data?.text ?? "");
                if (tok) {
                  const sub = useAppStore.getState().subAgents.find((item) => item.id === eventAgentId);
                  const prev = sub?.liveOutput ?? "";
                  // Append token; cap at 8000 chars to avoid unbounded growth.
                  const next = (prev + tok).slice(-8000);
                  updateSubAgent(eventAgentId, { liveOutput: next });
                }
              }
            }
            if (payload.type === "tool_call") {
              const toolNameStr = String(payload.data?.name ?? "tool");
              const toolArgs = (payload.data?.arguments ?? payload.data?.args ?? {}) as Record<string, unknown>;
              const toolCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              if (SEARCH_REFERENCE_TOOLS.has(toolNameStr)) {
                const q = String(toolArgs.query ?? "").trim();
                if (q) pendingSearchedQueries = mergeSearchedQueries(pendingSearchedQueries, [q]);
              }
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
                  const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
                  const lastMsg = pan?.messages.length ? pan.messages[pan.messages.length - 1] : undefined;
                  const toolGroupId =
                    lastMsg?.role === "tool" && lastMsg.toolGroupId
                      ? lastMsg.toolGroupId
                      : crypto.randomUUID();
                  const rawArgs = JSON.stringify(toolArgs);
                  const content =
                    rawArgs.length > 80_000 ? `${rawArgs.slice(0, 80_000)}\n… (truncated)` : rawArgs;
                  // Clarification: paint the inline card before stream commit so the
                  // card appears on the same SSE frame as tool_call (no extra frame wait).
                  if (toolNameStr === "request_clarification") {
                    const clarifyExtras = toolCallId
                      ? buildClarificationMessageExtras(
                          toolArgs,
                          toolCallId,
                          toolGroupId,
                          requestSessionId,
                        )
                      : null;
                    if (clarifyExtras) {
                      addPaneMessageIfSessionActive(
                        pane.id,
                        "tool",
                        clarifyExtras.clarificationPrompt?.prompt ?? content,
                        "meta",
                        undefined,
                        undefined,
                        undefined,
                        clarifyExtras,
                      );
                      commitCurrentStreamIfNeeded();
                      full = "";
                      streamReasoningStartedAt = null;
                      streamCommitRegistryRef.current.resetTurnSegment(requestSessionId);
                      cancelStreamRenderFrame();
                      scheduleStreamTextUpdate("");
                      continue;
                    }
                  }
                  commitCurrentStreamIfNeeded();
                  full = "";
                  streamReasoningStartedAt = null;
                  streamCommitRegistryRef.current.resetTurnSegment(requestSessionId);
                  cancelStreamRenderFrame();
                  scheduleStreamTextUpdate("");
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
                  flushSubAgentLiveOutput(eventAgentId);
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
              if (SEARCH_REFERENCE_TOOLS.has(toolName)) {
                const accumulated = accumulateReferenceTurn(
                  pendingReferences,
                  pendingSearchedQueries,
                  payload.data,
                );
                pendingReferences = accumulated.references;
                pendingSearchedQueries = accumulated.queries;
                syncTurnRefsSnapshot();
                if (isTargetSessionStillActive()) {
                  setStreamReferences([...pendingReferences]);
                  setStreamSearchedQueries([...pendingSearchedQueries]);
                }
              }
              const formatted = formatToolResultMessage(toolName, payload.data?.result, settings.providers);
              if (formatted.silent) continue;
              const resultCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              const rawContent = serializeToolResultRaw(payload.data?.result);
              const preview = formatted.content.replace(/\s+/g, " ").trim().slice(0, 160);
              const mergedStatus = deriveToolStatusFromResult(payload.data?.result);
              if (eventAgentId === "meta") {
                const resultPatch = {
                  content: rawContent,
                  toolStatus: mergedStatus,
                  toolResultPreview: preview,
                  toolStreamLines: [],
                };
                let merged = resultCallId
                  ? updatePaneMessageByToolCallId(pane.id, resultCallId, resultPatch)
                  : false;
                if (!merged) {
                  // 流式期间后端可能未在 tool_result 上回传可匹配的 tool_call_id，
                  // 退化为把该 pane 内最后一条仍在执行的 tool 调用翻成完成态并写入结果，
                  // 避免分组头长期停留在「正在调用工具」直到整轮结束才被快照纠正。
                  const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
                  const fallbackCallId = [...(pan?.messages ?? [])]
                    .reverse()
                    .find(
                      (mm) =>
                        mm.role === "tool" &&
                        Boolean(mm.toolCallId) &&
                        (mm.toolStatus === "running" || mm.toolStatus === "pending") &&
                        (!toolName || (mm.toolName ?? "") === toolName)
                    )?.toolCallId;
                  if (fallbackCallId) {
                    merged = updatePaneMessageByToolCallId(pane.id, fallbackCallId, resultPatch);
                  }
                }
                if (!merged) {
                  addPaneMessageIfSessionActive(pane.id, "tool", formatted.content, "meta");
                }
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
            if (payload.type === "clarification_required") {
              const clarifyReqId = String(payload.data?.id ?? "");
              const clarifyPrompt = String(payload.data?.prompt ?? "");
              const clarifyOptions = Array.isArray(payload.data?.options)
                ? (payload.data.options as string[]).map((o) => String(o)).filter(Boolean)
                : [];
              const clarifyAllowFreeText = payload.data?.allow_free_text !== false;
              const clarifyContext = payload.data?.context;
              const clarifyDecisions = parseClarificationDecisions(payload.data?.decisions);
              if (eventAgentId !== "meta") {
                updateSubAgent(eventAgentId, {
                  status: "awaiting_input",
                  currentAction: "等待你的输入",
                  pendingClarification: clarifyReqId
                    ? {
                        requestId: clarifyReqId,
                        prompt: clarifyPrompt,
                        options: clarifyOptions,
                        decisions: clarifyDecisions.length > 0 ? clarifyDecisions : undefined,
                        allowFreeText: clarifyAllowFreeText,
                        agentId: eventAgentId,
                        sessionId: requestSessionId,
                        context: clarifyContext,
                      }
                    : undefined,
                });
                addSubAgentEvent(eventAgentId, {
                  type: "clarification_required",
                  content: clarifyPrompt || "等待输入",
                });
              }
              // For sub-agents we keep the legacy blocking path (updates pendingClarification on SubAgent).
              // For the main Meta agent we render a non-blocking inline ClarificationCard by
              // writing a tool message that carries `clarificationPrompt` (NFR-2 visibility).
              if (eventAgentId !== "meta" && onOpenClarification && clarifyReqId) {
                const answer = await onOpenClarification(
                  clarifyReqId,
                  clarifyPrompt,
                  clarifyOptions,
                  clarifyAllowFreeText,
                  eventAgentId,
                  clarifyContext,
                );
                await fetch(`${apiBase}/api/clarify`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
                  body: JSON.stringify({
                    session_id: requestSessionId,
                    request_id: clarifyReqId,
                    agent_id: eventAgentId,
                    answer_text: answer?.answerText ?? "",
                    selected_options: answer?.selectedOptions ?? [],
                  }),
                });
              }
              // Meta: inline card — patch the running tool row when possible so the
              // card appears immediately on tool_call and only receives the real
              // request_id here; never nest inside TurnToolGroupCard as raw JSON.
              if (eventAgentId === "meta" && clarifyReqId && clarifyPrompt) {
                const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
                const running = findRunningClarificationToolMessage(pan?.messages ?? []);
                const promptPayload = {
                  requestId: clarifyReqId,
                  prompt: clarifyPrompt,
                  options: clarifyOptions,
                  decisions: clarifyDecisions.length > 0 ? clarifyDecisions : undefined,
                  allowFreeText: clarifyAllowFreeText,
                  agentId: "meta",
                  sessionId: requestSessionId,
                  context: clarifyContext,
                };
                const metaPatch = {
                  content: clarifyPrompt,
                  clarificationPrompt: promptPayload,
                  metadata: {
                    kind: "clarification",
                    request_id: clarifyReqId,
                    prompt: clarifyPrompt,
                    options: clarifyOptions,
                    decisions: clarifyDecisions.length > 0 ? clarifyDecisions : undefined,
                    allow_free_text: clarifyAllowFreeText,
                    context: clarifyContext,
                  },
                };
                if (running?.toolCallId) {
                  updatePaneMessageByToolCallId(pane.id, running.toolCallId, metaPatch);
                } else {
                  const dup = (pan?.messages ?? []).some(
                    (m) => m.clarificationPrompt?.requestId === clarifyReqId,
                  );
                  if (!dup) {
                    addPaneMessageIfSessionActive(
                      pane.id,
                      "tool",
                      clarifyPrompt,
                      "meta",
                      undefined,
                      undefined,
                      undefined,
                      {
                        toolName: "request_clarification",
                        toolStatus: "running",
                        toolArgs: {
                          prompt: clarifyPrompt,
                          options: clarifyOptions,
                          allow_free_text: clarifyAllowFreeText,
                          context: clarifyContext,
                        },
                        clarificationPrompt: promptPayload,
                        metadata: metaPatch.metadata,
                      },
                    );
                  }
                }
              }
            }
            if (payload.type === "clarification_response") {
              const respId = String(payload.data?.id ?? "").trim();
              const respAnswer = payload.data?.answer;
              if (eventAgentId !== "meta") {
                updateSubAgent(eventAgentId, {
                  status: "running",
                  currentAction: "已收到回复，继续执行",
                  pendingClarification: undefined,
                });
                addSubAgentEvent(eventAgentId, {
                  type: "clarification_response",
                  content: "已收到用户回复",
                });
              }
              // Meta (and sub): mark the inline card as answered in the store so
              // the card flips to the "已回复" state even if the answer came from
              // another client / the legacy Dialog path.
              if (respId) {
                const ans =
                  respAnswer && typeof respAnswer === "object"
                    ? {
                        answerText: String((respAnswer as Record<string, unknown>).answer_text ?? ""),
                        selectedOptions: Array.isArray((respAnswer as Record<string, unknown>).selected_options)
                          ? ((respAnswer as Record<string, unknown>).selected_options as unknown[]).map((o) => String(o)).filter(Boolean)
                          : [],
                      }
                    : { answerText: "", selectedOptions: [] };
                useAppStore.getState().markClarificationAnswered(respId, ans);
              }
            }
            if (payload.type === "clarification_suspended") {
              if (eventAgentId !== "meta") {
                updateSubAgent(eventAgentId, {
                  status: "running",
                  currentAction: "无人值守，提问已挂起",
                  pendingClarification: undefined,
                });
              }
            }
            if (payload.type === "subagent_started") {
              const subId = payload.data?.agent_id;
              console.debug("[ChatPane] SSE subagent_started", subId, "sessionId:", requestSessionId);
              if (subId) {
                const isDelegation = Boolean(payload.data?.delegation);
                const isRetry = Boolean(payload.data?.retried);
                const alreadyTracked = subAgents.some((sub) => sub.id === subId);
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
                  ...(isRetry || alreadyTracked
                    ? { resultSummary: "", liveOutput: "", outputFiles: [] as string[] }
                    : {}),
                });
                addSubAgentEvent(
                  subId,
                  {
                    type: isRetry || alreadyTracked
                      ? "retry"
                      : isDelegation
                        ? "delegation_started"
                        : "started",
                    content: isRetry || alreadyTracked
                      ? "已重新启动"
                      : isDelegation
                        ? `已委派给 ${payload.data?.name ?? subId}`
                        : "已启动",
                  }
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
              // FR-2: tool-rounds saturation must surface as an explicit "paused"
              // state (not "running" or "completed") so the user knows the task
              // halted at a hard limit rather than finishing naturally.
              const subId = payload.data?.agent_id;
              if (subId) {
                const round = Number(payload.data?.round ?? 0) || 0;
                const maxRounds = Number(payload.data?.max_rounds ?? 0) || 0;
                const baseText = String(payload.data?.text ?? "已暂停").trim();
                const roundLabel = round && maxRounds ? `（触顶 ${round}/${maxRounds} 轮）` : "";
                const tools = Array.isArray(payload.data?.executed_tools)
                  ? (payload.data.executed_tools as unknown[]).map((t) => String(t)).filter(Boolean)
                  : [];
                const toolsLabel = tools.length ? ` · 最近工具：${tools.slice(-5).join(", ")}` : "";
                const display = `${baseText}${roundLabel}${toolsLabel}`;
                updateSubAgent(subId, {
                  status: "paused",
                  currentAction: display,
                  resultSummary:
                    typeof payload.data?.summary === "string" ? payload.data.summary : undefined,
                  sessionId:
                    (typeof payload.data?.avatar_session_id === "string" && payload.data.avatar_session_id.trim())
                      || undefined,
                });
                addSubAgentEvent(subId, { type: "paused", content: display });
                // Also drop a visible note into the avatar pane so the user does
                // not need to expand the subagent panel to see why work stopped.
                addPaneMessageIfSessionActive(
                  pane.id,
                  "tool",
                  `⏸ 任务已暂停${roundLabel}。${baseText}${toolsLabel}`,
                  eventAgentId || "meta",
                );
              }
            }
            if (payload.type === "subagent_completed") {
              const subId = payload.data?.agent_id;
              if (subId) {
                flushSubAgentLiveOutput(subId);
                const isDelegation = Boolean(payload.data?.delegation);
                const summary =
                  typeof payload.data?.summary === "string" ? payload.data.summary : undefined;
                const resultFile =
                  typeof payload.data?.result_file === "string" && payload.data.result_file
                    ? payload.data.result_file
                    : undefined;
                updateSubAgent(subId, {
                  status: "completed",
                  currentAction: isDelegation ? "委派完成（查看摘要）" : "已完成（查看摘要）",
                  resultSummary: summary,
                  resultFile,
                  outputFiles: resolveSubAgentOutputPaths(summary, { resultFile }),
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
                flushSubAgentLiveOutput(subId);
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
              receivedFinalEvent = true;
              if (eventAgentId === "meta") {
                useAppStore.getState().clearSessionHistoryHint(requestSessionId);
                const finalText = String(payload.data?.text ?? "");
                const sqRaw = payload.data?.suggested_questions;
                pendingSuggestedQuestions = Array.isArray(sqRaw)
                  ? sqRaw.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 3)
                  : [];
                const appliedRefs = applyFinalReferencePayload(
                  pendingReferences,
                  pendingSearchedQueries,
                  payload.data,
                );
                pendingReferences = appliedRefs.references;
                pendingSearchedQueries = appliedRefs.queries;
                const finalReasoningRaw = payload.data?.reasoning;
                if (typeof finalReasoningRaw === "string" && finalReasoningRaw.trim()) {
                  pendingReasoning = finalReasoningRaw.trim().slice(0, 16384);
                }
                const finalReasoningSecondsRaw = payload.data?.reasoning_seconds;
                if (
                  typeof finalReasoningSecondsRaw === "number" &&
                  finalReasoningSecondsRaw >= 1
                ) {
                  pendingReasoningSeconds = Math.round(finalReasoningSecondsRaw);
                }
                syncTurnRefsSnapshot();
                if (isTargetSessionStillActive()) {
                  setStreamReferences([...pendingReferences]);
                  setStreamSearchedQueries([...pendingSearchedQueries]);
                }
                // Final payload is authoritative. Replacing (instead of merging) avoids
                // duplicate concatenation when token stream shape differs from final text.
                if (finalText.trim() && !isThinkingPlaceholderText(finalText)) {
                  full = finalText;
                  cumulativeFull = finalText;
                }
                scheduleStreamTextUpdate(full);
              } else {
                flushSubAgentLiveOutput(eventAgentId);
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
            if (payload.type === "compaction") {
              // FR-3: surface context compaction so users do not learn about it
              // only when the model later "explains" it as a failure cause.
              const count = Number(payload.data?.compacted_count ?? 0) || 0;
              const reactive = Boolean(payload.data?.reactive);
              const text = buildCompactionNoticeText(count, reactive);
              addPaneMessageIfSessionActive(pane.id, "tool", text, eventAgentId || "meta", undefined, undefined, undefined, {
                noticeKind: reactive ? "compaction_reactive" : "compaction_proactive",
              });
            }
            if (payload.type === "context_stats") {
              if (!sessionStillActive) continue;
              const round = Number(payload.data?.round ?? 0) || 0;
              const toolSession = Number(payload.data?.tool_result_tokens_session ?? 0) || 0;
              const archived = Number(payload.data?.archived_tool_calls ?? 0) || 0;
              setContextLoopStats({ round, tool_result_tokens_session: toolSession, archived_tool_calls: archived });
            }
            if (payload.type === "error") {
              const errText = String(payload.data?.text ?? "未知错误");
              const severity = String(payload.data?.severity ?? "").trim();
              const detector = String(payload.data?.detector ?? "").trim();
              if (
                eventAgentId === "meta"
                && detector === "widget_flow_guard"
                && payload.data?.action === "discard_stream"
              ) {
                full = "";
                cumulativeFull = "";
                streamReasoningStartedAt = null;
                cancelStreamRenderFrame();
                scheduleStreamTextUpdate("");
                continue;
              }
              const budgetInfo = budgetExceededInfoFromPayload(
                payload.data as Record<string, unknown> | undefined,
              );
              if (budgetInfo) {
                const sid = (pane.sessionId || "").trim();
                setBudgetExceededInfo({ ...budgetInfo, sessionId: sid || budgetInfo.sessionId });
                addPaneMessageIfSessionActive(
                  pane.id,
                  "tool",
                  errText,
                  eventAgentId || "meta",
                  undefined,
                  undefined,
                  undefined,
                  {
                    noticeKind: "budget_exceeded",
                    budgetSource: budgetInfo.source,
                    budgetCurrent: budgetInfo.current,
                    budgetMax: budgetInfo.maxAllowed,
                  },
                );
              } else if (
                severity === "warning"
                || detector === "token_budget_compress"
                || detector === "compactor_circuit_breaker"
                || detector === "context_budget_compact"
                || detector === "context_window"
              ) {
                const noticeKind =
                  detector === "context_budget_compact" || detector === "context_window"
                    ? "context_compact"
                    : detector === "compactor_circuit_breaker"
                      ? "compactor_cb"
                      : "budget_compress";
                addPaneMessageIfSessionActive(pane.id, "tool", errText, eventAgentId || "meta", undefined, undefined, undefined, {
                  noticeKind,
                });
              } else if (errText.includes("已达到最大工具调用轮数")) {
                const maxRounds = Number(payload.data?.max_rounds ?? 0) || 30;
                const rounds = Number(payload.data?.round ?? maxRounds);
                setExhaustedRounds({ rounds, maxRounds });
                setStallState("exhausted");
                addPaneMessageIfSessionActive(pane.id, "tool", errText, "meta");
              } else if (!isEphemeralStopErrorText(errText)) {
                // Hook-blocked: merge into existing ToolCallCard to avoid duplicate bubble.
                const errToolCallId = String(payload.data?.tool_call_id ?? "").trim();
                if (HOOK_BLOCK_RE.test(errText) && errToolCallId) {
                  const merged = updatePaneMessageByToolCallId(pane.id, errToolCallId, {
                    content: errText,
                    toolStatus: "error",
                    toolResultPreview: errText.slice(0, 120),
                    toolStreamLines: [],
                  });
                  if (!merged) {
                    addPaneMessageIfSessionActive(pane.id, "tool", errText, "meta");
                  }
                } else {
                  addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
                }
              }
            }
          } catch {
            // Ignore malformed frame.
          }
        }
      }

      const trimmedFull = full.trim();
      syncTurnRefsSnapshot();
      const refExtras = referenceExtrasFromTurn(pendingReferences, pendingSearchedQueries);
      const sugExtras =
        pendingSuggestedQuestions.length > 0
          ? { suggestedQuestions: pendingSuggestedQuestions.slice(0, 3) }
          : undefined;
      const reasoningExtras: Record<string, unknown> = {};
      if (pendingReasoning) reasoningExtras.reasoning = pendingReasoning;
      if (pendingReasoningSeconds !== undefined)
        reasoningExtras.reasoningSeconds = pendingReasoningSeconds;
      const turnExtras =
        refExtras || sugExtras || Object.keys(reasoningExtras).length > 0
          ? { ...refExtras, ...sugExtras, ...reasoningExtras }
          : undefined;
      const completedAt = Date.now();
      const stampLastAssistantCompletedAt = () => {
        useAppStore.getState().mergeLastPaneMessageByRole(pane.id, "assistant", {
          timestamp: completedAt,
        });
      };
      if (
        trimmedFull &&
        !isThinkingPlaceholderText(full) &&
        !streamCommitRegistryRef.current.isCommitted(requestSessionId)
      ) {
        const mid = streamCommitRegistryRef.current.getMidCommit(requestSessionId);
        if (mid !== null && trimmedFull === mid) {
          streamCommitRegistryRef.current.markCommitted(requestSessionId);
          useAppStore.getState().mergeLastPaneMessageByRole(pane.id, "assistant", {
            ...(turnExtras ?? {}),
            timestamp: completedAt,
          });
        } else {
          addPaneMessageIfSessionActive(
            pane.id,
            "assistant",
            full,
            "meta",
            chatProvider,
            chatModel,
            undefined,
            { ...(turnExtras ?? {}), timestamp: completedAt },
          );
          streamCommitRegistryRef.current.markCommitted(requestSessionId);
        }
      } else if (
        trimmedFull &&
        !isThinkingPlaceholderText(full) &&
        streamCommitRegistryRef.current.isCommitted(requestSessionId)
      ) {
        if (turnExtras) {
          useAppStore.getState().mergeLastPaneMessageByRole(pane.id, "assistant", {
            ...turnExtras,
            timestamp: completedAt,
          });
        } else {
          stampLastAssistantCompletedAt();
        }
      } else if (!abortController.signal.aborted && !receivedFinalEvent) {
        // Backend persists turn_interrupted to messages.json; toast is ephemeral.
        setStallHintToast(TURN_INTERRUPTED_TOAST);
        await mergeTailFromDisk(requestSessionId);
      }
    } catch (error) {
      if (isContinuation) {
        clearResumeInFlight(requestSessionId);
      }
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        addPaneMessageIfSessionActive(pane.id, "tool", `❌ 请求失败: ${String(error)}`, "meta");
      }
    } finally {
      releaseSendLock();
      delete sessionAbortControllersRef.current[requestSessionId];
      streamCommitRegistryRef.current.clearSession(requestSessionId);
      const ended = sessionStreamStateRef.current[requestSessionId];
      if (ended) {
        ended.active = false;
        ended.text = "";
        sessionStreamStateRef.current[requestSessionId] = ended;
      }

      // Peek at the queue BEFORE setting idle state: if there is a follow-up
      // message already queued (e.g. unattended-continuation auto-send), the
      // session is NOT truly "done" — setting idle here would cause a one-frame
      // "已结束 关闭" flash that (a) misleads the user into thinking the task
      // finished and (b) triggers the false-promotion heuristic in StickyTaskBar
      // that marks in_progress todos as completed. When the user switches sessions
      // during that flash and returns, they see the continuation run's partial
      // progress and wonder why the state "regressed" from 5/5 → 4/5.
      // Fix: dequeue first, and skip the idle transition when a follow-up will
      // immediately restart the run (within the same requestAnimationFrame).
      const nextQueued = useAppStore.getState().dequeuePaneMessageForSession(
        pane.id,
        requestSessionId,
      );

      if ((pane.sessionId || "").trim() === requestSessionId) {
        const refPatch = referenceExtrasFromTurn(
          turnRefsSnapshot.references,
          turnRefsSnapshot.queries,
        );
        if (refPatch && !abortController.signal.aborted) {
          useAppStore.getState().mergeLastPaneMessageByRole(pane.id, "assistant", refPatch);
        }
        syncStreamingUiForCurrentSession();
        // Only transition to idle if there is no queued continuation. A queued
        // follow-up means the run will restart in the next animation frame; the
        // "running" state must stay set so the StickyTaskBar does not briefly
        // show "已结束" (and incorrectly promote in_progress todos to completed).
        if (!abortController.signal.aborted && !nextQueued) {
          setSessionExecutionState("idle");
        }
        setStreamReferences([]);
        setStreamSearchedQueries([]);
      }
      abortRef.current = null;
      cancelStreamRenderFrame();
      if ((pane.sessionId || "").trim() === requestSessionId) {
        streamTextRef.current = "";
      }
      setGroupTyping({});
      setContextFiles({});
      if (!abortController.signal.aborted) {
        useAppStore.getState().clearSessionHistoryHint(requestSessionId);
      }
      useAppStore.getState().bumpSessionCatalogRevision();
      window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 500);

      invalidateSessionTail(requestSessionId);
      useAppStore.getState().dropCachedSessionMessages(requestSessionId);
      void mergeTailFromDisk(requestSessionId);

      if (nextQueued) {
        requestAnimationFrame(() => {
          void sendChatRef.current(nextQueued.text, {
            lockedSessionId: requestSessionId,
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
      lockedSessionId: forwardAutoReply.sessionId,
      suppressUserEcho: forwardAutoReply.suppressUserEcho ?? true,
      skipUserHistory: forwardAutoReply.skipUserHistory ?? true,
    });
  }, [forwardAutoReply, paneId, pane.sessionId]);

  const initSession = async (inherit = false, prevSessionId?: string) => {
    const avatarId =
      pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
    const pendingMode = peekPanePendingSessionMode(pane.id) ?? pane.sessionMode ?? "daily_office";
    try {
      const result = await window.agenticxDesktop.createSession({
        avatar_id: avatarId,
        session_mode: pendingMode,
        ...(inherit && prevSessionId ? { inherit_from_session_id: prevSessionId } : {}),
        ...(chatProvider && chatModel ? { provider: chatProvider, model: chatModel } : {}),
      });
      if (result.ok && result.session_id) {
        setPaneSessionId(pane.id, result.session_id, {
          provider: chatProvider || undefined,
          model: chatModel || undefined,
        });
        setPaneSessionMode(pane.id, result.session_mode ?? pendingMode);
        clearPanePendingSessionMode(pane.id);
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

  const createNewTopic = (inherit = true, sessionMode: PaneSessionMode = "daily_office") => {
    const prevSessionId = (pane.sessionId || "").trim();
    // 用户主动新建会话时，不应强制中断旧会话流：旧会话允许后台继续执行。
    // 发送锁在 sendChat 里会基于 isPaneAwaitingFreshSession 进行抢占释放。
    clearPaneMessages(pane.id);
    setPaneContextInherited(pane.id, false);
    setPanePendingSessionMode(pane.id, sessionMode);
    setPaneSessionMode(pane.id, sessionMode);
    setKbRetrievalModeForPane("", pane.id, kbNewSessionDefaultRef.current);
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

  resumeInNewSessionRef.current = () => {
    const draft = buildBudgetResumeDraft(pane.messages ?? []);
    createNewTopic(false, pane.sessionMode ?? "daily_office");
    setBudgetExceededInfo(null);
    setInput(draft);
  };

  const insertGlobalSearchFileReference = useCallback(
    async (filePath: string, mode: "current" | "new") => {
      const trimmed = filePath.trim();
      if (!trimmed) return;

      if (mode === "new") {
        setContextFiles({});
        clearPaneMessages(pane.id);
        setPaneContextInherited(pane.id, false);
        setPaneSessionId(pane.id, "");
        clearPaneAwaitingFreshSession(pane.id);
        markPaneAwaitingFreshSession(pane.id);
      }

      const fileName = fileNameFromPath(trimmed);
      let content = `[文件引用] ${trimmed}`;
      try {
        const preview = await window.agenticxDesktop.systemSearchPreview(trimmed);
        if (preview.ok) {
          if (preview.kind === "text" && preview.content) {
            content = preview.content.slice(0, TEXT_ATTACHMENT_LIMIT);
          } else if (preview.kind === "metadata" && preview.content) {
            content = preview.content.slice(0, TEXT_ATTACHMENT_LIMIT);
          } else if (preview.kind === "image") {
            content = `[图片: ${fileName}]`;
          }
        }
      } catch {
        // keep fallback content
      }

      setContextFiles((prev) => ({
        ...prev,
        [trimmed]: {
          name: fileName,
          size: content.length,
          mimeType: "text/plain",
          status: "ready",
          content,
          sourcePath: trimmed,
          composerRefLabel: fileName,
          referenceToken: true,
        },
      }));

      const base = mode === "new" ? "" : extractComposerText();
      const { next, tokenNames } = buildFileMentionAppend(base, fileName);
      setComposerText(next, {
        tokenNames,
        refSourcePaths: { [fileName]: trimmed },
      });
      focusComposerEnd();
    },
    [
      clearPaneMessages,
      extractComposerText,
      focusComposerEnd,
      initSession,
      pane.id,
      setComposerText,
      setPaneContextInherited,
      setPaneSessionId,
    ]
  );

  useEffect(() => {
    const onReference = (event: Event) => {
      const detail = (event as CustomEvent<GlobalSearchReferenceFileDetail>).detail;
      if (!detail || detail.paneId !== pane.id) return;
      void insertGlobalSearchFileReference(detail.filePath, detail.mode);
    };
    const onWorkspaceAdded = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail;
      if (!detail?.paneId || detail.paneId !== pane.id) return;
      setTaskspaceAutoRefreshKey((k) => k + 1);
    };
    window.addEventListener(GLOBAL_SEARCH_REFERENCE_FILE, onReference);
    window.addEventListener(GLOBAL_SEARCH_WORKSPACE_ADDED, onWorkspaceAdded);
    return () => {
      window.removeEventListener(GLOBAL_SEARCH_REFERENCE_FILE, onReference);
      window.removeEventListener(GLOBAL_SEARCH_WORKSPACE_ADDED, onWorkspaceAdded);
    };
  }, [insertGlobalSearchFileReference, pane.id]);

  const maxTaskspaceWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.4)) : 480;
  const minTaskspaceWidth = 220;
  const maxSpawnsWidth = paneWidth > 0 ? Math.max(240, Math.floor(paneWidth * 0.42)) : 420;
  const minSpawnsWidth = 220;
  const minRunDrawerWidth = 280;
  const maxRunDrawerWidth = paneWidth > 0 ? Math.max(320, Math.floor(paneWidth * 0.48)) : 480;
  const maxHistoryWidth = paneWidth > 0 ? Math.max(220, Math.floor(paneWidth * 0.35)) : 360;
  const minHistoryWidth = 200;

  const compactSidePanels = paneWidth > 0 && paneWidth < CHATPANE_SIDE_OVERLAY_BREAK;
  const clampOverlayAside = (preferred: number, minPx: number) =>
    paneWidth > 0
      ? Math.min(Math.max(preferred, minPx), Math.max(Math.floor(paneWidth * 0.94), minPx))
      : preferred;
  const overlayTaskspaceWidth = clampOverlayAside(taskspaceWidth, minTaskspaceWidth);
  const overlayHistoryWidth = clampOverlayAside(historyWidth, minHistoryWidth);
  const overlaySpawnsWidth = clampOverlayAside(spawnsWidth, minSpawnsWidth);
  const overlayRunDrawerWidth = clampOverlayAside(runDrawerWidth, minRunDrawerWidth);

  useEffect(() => {
    setTaskspaceWidth((prev) => {
      const next = Math.min(maxTaskspaceWidth, Math.max(minTaskspaceWidth, prev));
      return next === prev ? prev : next;
    });
  }, [maxTaskspaceWidth, minTaskspaceWidth]);

  useEffect(() => {
    setSpawnsWidth((prev) => {
      const next = Math.min(maxSpawnsWidth, Math.max(minSpawnsWidth, prev));
      return next === prev ? prev : next;
    });
  }, [maxSpawnsWidth, minSpawnsWidth]);

  useEffect(() => {
    setRunDrawerWidth((prev) => {
      const next = Math.min(maxRunDrawerWidth, Math.max(minRunDrawerWidth, prev));
      return next === prev ? prev : next;
    });
  }, [maxRunDrawerWidth, minRunDrawerWidth]);

  useEffect(() => {
    setHistoryWidth((prev) => {
      const next = Math.min(maxHistoryWidth, Math.max(minHistoryWidth, prev));
      return next === prev ? prev : next;
    });
  }, [maxHistoryWidth, minHistoryWidth]);

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
      window.localStorage.setItem(RUN_DRAWER_WIDTH_STORAGE_KEY, String(runDrawerWidth));
    } catch {
      // ignore storage access failures
    }
  }, [runDrawerWidth]);

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

  const startResizeRunDrawer = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = runDrawerWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.max(minRunDrawerWidth, Math.min(maxRunDrawerWidth, startWidth + delta));
      setRunDrawerWidth(next);
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
    updateSubAgent(agentId, {
      status: "pending",
      currentAction: "正在重试...",
      resultSummary: "",
      resultFile: undefined,
      liveOutput: "",
      outputFiles: [],
      // Reset the activity timeline so the retry run starts from a clean log
      // instead of stacking on top of the previous attempt's events.
      events: [],
    });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: targetSessionId,
          agent_id: agentId,
          // Send the (possibly edited) task so backend re-runs with the latest
          // instruction instead of the original one.
          ...(sub?.task?.trim() ? { task: sub.task.trim() } : {}),
          ...(sub?.provider ? { provider: sub.provider } : {}),
          ...(sub?.model ? { model: sub.model } : {}),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, { type: "retry", content: "已发送重试请求" });
    } catch (err) {
      updateSubAgent(agentId, { status: "failed", currentAction: "重试失败" });
      addSubAgentEvent(agentId, { type: "error", content: `重试失败: ${String(err)}` });
    }
  };

  const changePaneSubAgentModel = async (agentId: string, provider: string, model: string) => {
    if (!apiBase || !apiToken || !pane.sessionId) return;
    const sub = subAgents.find((item) => item.id === agentId);
    const targetSessionId = (sub?.sessionId ?? pane.sessionId).trim() || pane.sessionId;
    updateSubAgent(agentId, { provider, model });
    try {
      const resp = await fetch(`${apiBase}/api/subagent/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: targetSessionId,
          agent_id: agentId,
          provider,
          model,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      addSubAgentEvent(agentId, {
        type: "model_changed",
        content: `已切换模型：${formatModelOptionLabel(provider, model, settings.providers[provider])}`,
      });
    } catch (err) {
      addSubAgentEvent(agentId, { type: "error", content: `切换模型失败: ${String(err)}` });
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

  useEffect(() => {
    // 历史面板已改为不挤占布局的锚定浮层（不再计入互斥占位），此处仅在工作区/记忆图谱/
    // 成员列表/Spawns/落盘 drawer 之间做单选互斥（窄窗格 overlay 模式）。
    if (!compactSidePanels) return;
    const p = pane;
    const stacked =
      Number(!!p.taskspacePanelOpen) +
      Number(!!p.memoryGraphOpen) +
      Number(!!p.membersPanelOpen) +
      Number(!!p.spawnsColumnOpen) +
      Number(!!p.runDrawerOpen);
    if (stacked <= 1) return;
    let keep: "workspace" | "memory-graph" | "members" | "spawns" | "run-drawer" = "run-drawer";
    if (p.runDrawerOpen) keep = "run-drawer";
    else if (p.taskspacePanelOpen) keep = "workspace";
    else if (p.memoryGraphOpen) keep = "memory-graph";
    else if (p.membersPanelOpen) keep = "members";
    else keep = "spawns";
    const desired = {
      taskspacePanelOpen: keep === "workspace",
      memoryGraphOpen: keep === "memory-graph",
      membersPanelOpen: keep === "members",
      spawnsColumnOpen: keep === "spawns",
      runDrawerOpen: keep === "run-drawer",
    };
    useAppStore.setState((s) => {
      const row = s.panes.find((r) => r.id === p.id);
      if (!row) return s;
      if (
        row.taskspacePanelOpen === desired.taskspacePanelOpen &&
        row.memoryGraphOpen === desired.memoryGraphOpen &&
        row.membersPanelOpen === desired.membersPanelOpen &&
        row.spawnsColumnOpen === desired.spawnsColumnOpen &&
        row.runDrawerOpen === desired.runDrawerOpen
      ) {
        return s;
      }
      return {
        panes: s.panes.map((r) => (r.id !== p.id ? r : { ...r, ...desired })),
      };
    });
  }, [
    compactSidePanels,
    pane.id,
    pane.taskspacePanelOpen,
    pane.memoryGraphOpen,
    pane.membersPanelOpen,
    pane.spawnsColumnOpen,
    pane.runDrawerOpen,
  ]);

  const dismissAuxiliaryOverlays = () => {
    useAppStore.setState((s) => ({
      panes: s.panes.map((row) =>
        row.id !== pane.id
          ? row
          : {
              ...row,
              taskspacePanelOpen: false,
              historyOpen: false,
              memoryGraphOpen: false,
              membersPanelOpen: false,
              spawnsColumnOpen: false,
              runDrawerOpen: false,
            }
      ),
    }));
  };

  const closeRunDrawerPanelOnly = () => {
    closeRunDrawer(pane.id);
  };

  const closeMemoryGraphPanelOnly = () => {
    useAppStore.setState((s) => ({
      panes: s.panes.map((row) => (row.id !== pane.id ? row : { ...row, memoryGraphOpen: false })),
    }));
  };

  const closeWorkspacePanelOnly = () => {
    useAppStore.setState((s) => ({
      panes: s.panes.map((row) => (row.id !== pane.id ? row : { ...row, taskspacePanelOpen: false })),
    }));
  };

  const closeMembersPanelOnly = () => {
    useAppStore.setState((s) => ({
      panes: s.panes.map((row) => (row.id !== pane.id ? row : { ...row, membersPanelOpen: false })),
    }));
  };

  const closeHistoryPanelOnly = () => {
    useAppStore.setState((s) => ({
      panes: s.panes.map((row) => (row.id !== pane.id ? row : { ...row, historyOpen: false })),
    }));
    setHistoryAnchorRect(null);
  };

  const toggleWorkspaceSidePanel = () => {
    if (!compactSidePanels) {
      if (!pane.taskspacePanelOpen) closeHistoryPanelOnly();
      cycleSidePanel(pane.id, "workspace");
      return;
    }
    useAppStore.setState((s) => ({
      panes: s.panes.map((p) => {
        if (p.id !== pane.id) return p;
        const opening = !p.taskspacePanelOpen;
        return opening
          ? {
              ...p,
              taskspacePanelOpen: true,
              sidePanelTab: "workspace",
              historyOpen: false,
              memoryGraphOpen: false,
              membersPanelOpen: false,
              spawnsColumnOpen: false,
            }
          : { ...p, taskspacePanelOpen: false };
      }),
    }));
  };

  const toggleMemoryGraphSidePanel = () => {
    if (!compactSidePanels) {
      if (!pane.memoryGraphOpen) closeHistoryPanelOnly();
      togglePaneMemoryGraph(pane.id);
      return;
    }
    useAppStore.setState((s) => ({
      panes: s.panes.map((p) => {
        if (p.id !== pane.id) return p;
        const opening = !p.memoryGraphOpen;
        return opening
          ? {
              ...p,
              memoryGraphOpen: true,
              taskspacePanelOpen: false,
              historyOpen: false,
              membersPanelOpen: false,
              spawnsColumnOpen: false,
            }
          : { ...p, memoryGraphOpen: false };
      }),
    }));
  };

  const toggleHistorySidePanel = () => {
    const opening = !pane.historyOpen;
    if (opening && historyButtonRef.current) {
      setHistoryAnchorRect(historyButtonRef.current.getBoundingClientRect());
    } else if (!opening) {
      setHistoryAnchorRect(null);
    }
    togglePaneHistory(pane.id);
  };

  // 窗口尺寸变化后锚点坐标会过期，直接收起浮层比重新定位更简单可靠。
  useEffect(() => {
    if (!pane.historyOpen) return;
    const onResize = () => closeHistoryPanelOnly();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pane.historyOpen]);

  const toggleMembersSidePanel = () => {
    if (!compactSidePanels) {
      if (!pane.membersPanelOpen) closeHistoryPanelOnly();
      cycleSidePanel(pane.id, "members");
      return;
    }
    useAppStore.setState((s) => ({
      panes: s.panes.map((p) => {
        if (p.id !== pane.id) return p;
        const opening = !p.membersPanelOpen;
        return opening
          ? {
              ...p,
              membersPanelOpen: true,
              sidePanelTab: "members",
              taskspacePanelOpen: false,
              historyOpen: false,
              memoryGraphOpen: false,
              spawnsColumnOpen: false,
            }
          : { ...p, membersPanelOpen: false };
      }),
    }));
  };

  const toggleSpawnsSideColumn = () => {
    if (pane.spawnsColumnOpen) {
      dismissSpawnsColumn(
        pane.id,
        paneSubAgents.map((s) => s.id)
      );
      return;
    }
    if (!compactSidePanels) {
      closeHistoryPanelOnly();
      setSpawnsColumnOpen(pane.id, true);
      return;
    }
    useAppStore.setState((s) => ({
      panes: s.panes.map((p) => {
        if (p.id !== pane.id) return p;
        return {
          ...p,
          spawnsColumnOpen: true,
          spawnsColumnSuppressAuto: false,
          spawnsColumnBaselineIds: [],
          taskspacePanelOpen: false,
          historyOpen: false,
          memoryGraphOpen: false,
          membersPanelOpen: false,
        };
      }),
    }));
  };

  return (
    <div
      ref={paneRef}
      className="relative agx-chatpane flex h-full min-w-0 flex-1"
      style={paneTint ? { backgroundColor: paneTint } : undefined}
      onMouseDown={onFocus}
    >
      <div
        className="agx-chatpane-main-column flex h-full min-w-0 flex-1 flex-col"
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
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium text-text-strong">
                <span className="shrink-0">{paneAvatarMeta.name}</span>
                {(pane.sessionId || "").trim() ? (
                  <span
                    className="select-all font-mono text-[9px] font-normal leading-snug text-text-faint"
                    title="会话 ID（便于排查）"
                  >
                    {(pane.sessionId || "").trim()}
                  </span>
                ) : null}
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
                onClick={toggleMembersSidePanel}
                title="切换群成员面板"
              >
                <Users className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            )}
            {isMachiMetaPane && (
              <button
                type="button"
                className="agx-topbar-btn !px-[5px]"
                onClick={() => openDeliveryPanel()}
                title="交付任务（POC/MVP）"
              >
                <Boxes className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            )}
            {!isGroupPane && (
              <button
                type="button"
                className="agx-topbar-btn !px-[5px]"
                onClick={() => toggleFocusMode(pane.id)}
                title="灵巧模式 · 实时语音 (⇧⌘F)"
                aria-label="进入灵巧模式"
              >
                <PhoneCall className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            )}
            <button
              className={`agx-topbar-btn !px-[5px] ${workspacePanelOpen ? "agx-topbar-btn--active" : ""}`}
              onClick={toggleWorkspaceSidePanel}
              title="切换工作区面板"
            >
              <FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            {paneSubAgents.length > 0 ? (
              <button
                className={`agx-topbar-btn !px-[5px] ${pane.spawnsColumnOpen ? "agx-topbar-btn--active" : ""}`}
                onClick={toggleSpawnsSideColumn}
                title={pane.spawnsColumnOpen ? "收起 Spawns 列" : "打开 Spawns 列"}
              >
                <Bot className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            ) : null}
            <button
              className={`agx-topbar-btn !px-[5px] ${pane.memoryGraphOpen ? "agx-topbar-btn--active" : ""}`}
              onClick={toggleMemoryGraphSidePanel}
              title="切换记忆图谱面板"
            >
              <Share2 className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            <button
              ref={historyButtonRef}
              className={`agx-topbar-btn !px-[5px] ${pane.historyOpen ? "agx-topbar-btn--active" : ""}`}
              onClick={toggleHistorySidePanel}
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

        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={listRef}
            className="agx-pane-message-list relative h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-3"
          >
          {!pane.sessionId && (isGroupPane || isAutomationTaskPane) ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-text-faint">
              <span className="animate-pulse">正在初始化会话...</span>
              <button
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => void initSession(false)}
              >
                重试
              </button>
            </div>
          ) : pane.loadingMessages && pane.sessionId ? (
            <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col justify-center gap-4 px-2 py-6">
              <div className="text-center text-xs text-text-faint animate-pulse">正在加载会话…</div>
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex animate-pulse gap-2.5">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-surface-hover" />
                    <div
                      className="h-14 flex-1 rounded-xl bg-surface-hover"
                      style={{ maxWidth: row === 1 ? "72%" : "84%" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (!pane.sessionId && !isGroupPane && !isAutomationTaskPane) ||
            (pane.sessionId && visibleMessages.length === 0) ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center text-xs">
              <img
                src={machiEmptyState}
                alt={`${APP_DISPLAY_NAME} Empty State`}
                className="w-[13.2rem] max-w-[42vw] select-none opacity-[0.85] theme-invert-logo"
                draggable={false}
              />
              <div className="space-y-2 select-none">
                <div className="text-[22px] font-semibold text-text-primary tracking-[0.24em]">
                  {APP_DISPLAY_NAME.toUpperCase()}
                </div>
                <div className="text-text-faint tracking-[0.22em] uppercase text-[12px]">
                  {APP_TAGLINE}
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
            <div className="mx-auto flex min-w-0 w-full max-w-4xl flex-col gap-3">
              {pane.loadingOlderMessages || (pane.hasOlderMessages && (pane.oldestLoadedIndex ?? 0) > 0) ? (
                <div className="flex justify-center py-2">
                  {pane.loadingOlderMessages ? (
                    <Loader2 className="h-4 w-4 animate-spin text-text-faint" aria-label="加载更早消息" />
                  ) : (
                    <button
                      type="button"
                      className="text-[11px] text-text-faint transition hover:text-text-subtle"
                      onClick={() => void loadOlderSessionMessages()}
                    >
                      向上滚动加载更早消息
                    </button>
                  )}
                </div>
              ) : null}
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

          {showJumpToBottomFab ? (
            <div className="pointer-events-none absolute bottom-3 left-0 right-0 z-30 flex justify-center">
              <button
                type="button"
                className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-card-strong/95 text-text-strong shadow-lg backdrop-blur-sm transition hover:bg-surface-hover"
                aria-label="回到底部"
                title="回到底部"
                onClick={() => {
                  const el = listRef.current;
                  if (!el) return;
                  autoScrollPinnedRef.current = true;
                  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                  flushJumpToBottomFab();
                }}
              >
                <ChevronDown className="h-5 w-5" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          ) : null}
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
          <StickyTaskBar
            messages={pane.messages ?? []}
            liveness={taskLiveness}
            executionState={sessionExecutionState}
            silentSeconds={silentSeconds}
            onResume={() => void resumeCurrentTask()}
            codeDevMode={false}
            phase={undefined}
            toolBudget={{ used: toolRoundCount, total: toolRoundBudget }}
            readFiles={0}
          />
          {bgCompleteToast ? (
            <div className="pointer-events-none mb-1 flex justify-center">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
                后台任务已完成
              </div>
            </div>
          ) : null}
          {stallHintToast ? (
            <div className="pointer-events-none mb-1 flex justify-center">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                {stallHintToast}
              </div>
            </div>
          ) : null}
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
              <button className="rounded px-1 hover:bg-surface-hover" onClick={() => void exportSelectedMessagesToPdf()}>
                保存为 PDF
              </button>
              <button className="rounded px-1 hover:bg-surface-hover text-rose-300" onClick={() => void deleteSelectedMessages()}>
                删除
              </button>
              <button className="rounded px-1 hover:bg-surface-hover" onClick={() => setSelectedMessageIds(new Set())}>取消</button>
            </div>
          ) : null}
          <MessageQueuePanel
            messages={queuedMessages}
            onEdit={(id, newText) => editPendingMessage(paneId, id, newText)}
            onRemove={(id) => removePendingMessage(paneId, id)}
            onSendNow={sendQueuedMessageNow}
          />
          {(sessionExecutionState === "running" || stallState === "stall" || sessionUnattended || budgetExceededInfo) && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span className="rounded-full bg-surface-panel/75 px-2 py-0.5">
                {[
                  !isAutomationTaskPane ? currentModelLabel : null,
                  sessionExecutionState === "running"
                    ? "运行中"
                    : stallState === "stall" && stallReason === "incomplete"
                      ? "未完成"
                      : sessionWorkInProgress
                        ? "处理中"
                        : null,
                  // An ended-incomplete turn is not "running" — suppress the silence
                  // timer so it never reads as "still processing / no response".
                  silentSeconds > 0 &&
                  sessionExecutionState === "running" &&
                  !(stallState === "stall" && stallReason === "incomplete")
                    ? silenceTier === "thinking"
                      ? "正在思考…"
                      : resolveSilenceTierLabel(silenceTier, silentSeconds)
                    : null,
                  lastToolProgress?.name
                    ? `${lastToolProgress.name}${lastToolProgress.sec > 0 ? ` ${lastToolProgress.sec}s` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {sessionHealth !== "normal" ? (
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    sessionHealth === "stuck"
                      ? "bg-amber-500/15 text-amber-200"
                      : "bg-surface-panel/75 text-text-muted"
                  }`}
                >
                  健康度：{sessionHealth === "stuck" ? "卡住" : "偏慢"}
                </span>
              ) : null}
              {contextLoopStats ? (
                <span className="rounded-full bg-surface-panel/75 px-2 py-0.5 text-text-muted">
                  context: {(contextLoopStats.tool_result_tokens_session / 1000).toFixed(1)}k ·{" "}
                  {contextLoopStats.round} rounds · {contextLoopStats.archived_tool_calls} archived
                </span>
              ) : null}
              {sessionUnattended && unattendedGlobalEnabled && !budgetExceededInfo ? (
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-200 [html[data-theme=light]_&]:bg-violet-500/15 [html[data-theme=light]_&]:text-violet-900">
                  无人值守 · 续跑 {unattendedContinueCount}/{unattendedMaxContinuations}
                </span>
              ) : null}
              {budgetExceededInfo ? (
                <button
                  type="button"
                  onClick={() => resumeInNewSessionRef.current()}
                  className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-200 transition hover:bg-rose-500/25"
                >
                  已达预算上限 · 续跑无效
                </button>
              ) : null}
              {unattendedGlobalEnabled ? (
                <button
                  type="button"
                  onClick={() => void toggleSessionUnattended()}
                  className={`rounded-full px-2 py-0.5 transition outline-none focus-visible:outline-none ${
                    sessionUnattended
                      ? "bg-violet-500/15 text-violet-200 [html[data-theme=light]_&]:bg-violet-500/15 [html[data-theme=light]_&]:text-violet-900"
                      : "bg-surface-panel/75 text-text-muted hover:text-text-strong"
                  }`}
                >
                  {sessionUnattended ? "本会话无人值守：开" : "本会话无人值守：关"}
                </button>
              ) : null}
              {!isStreamingCurrentSession && sessionExecutionState === "running" ? (
                <span className="text-amber-300/90">后台运行中</span>
              ) : null}
            </div>
          )}
          {sessionExecutionState === "running" &&
          (silenceTier === "slow" || silenceTier === "stuck") &&
          !(stallState === "stall" && stallReason === "incomplete") ? (
            <div className="mb-2 flex justify-center px-1">
              <div
                className={`inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${
                  silenceTier === "stuck"
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-100/95"
                    : "border-border bg-surface-panel/80 text-text-muted"
                }`}
              >
                <span>{resolveSilenceTierLabel(silenceTier, silentSeconds)}</span>
                <button
                  type="button"
                  className="rounded-full bg-surface-hover px-2 py-0.5 transition hover:bg-surface-card-strong"
                  onClick={() => void resumeCurrentTask()}
                >
                  立即重试
                </button>
                <button
                  type="button"
                  className="rounded-full bg-surface-hover px-2 py-0.5 transition hover:bg-surface-card-strong"
                  onClick={() => {
                    const fb = stallModelOptions[0] ?? STALL_MODEL_FALLBACKS[0];
                    if (fb) void resumeWithModel(fb.provider, fb.model);
                  }}
                >
                  换模型
                </button>
                <button
                  type="button"
                  className="rounded-full bg-surface-hover px-2 py-0.5 transition hover:bg-surface-card-strong"
                  onClick={() => void stopCurrentRun()}
                >
                  停止
                </button>
                {silenceTier === "stuck" ? (
                  <button
                    type="button"
                    className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-100 transition hover:bg-amber-500/30"
                    onClick={() => void takeoverSession()}
                  >
                    我来接管
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {voiceInputHint ? (
            <div className="mb-2 flex justify-center px-1">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-[12px] text-amber-100/95">
                <span aria-hidden>!</span>
                <span className="truncate">{voiceInputHint}</span>
              </span>
            </div>
          ) : null}
          <div className="agx-pane-composer-body agx-theme-focus-ring relative rounded-2xl border border-transparent bg-surface-card transition-all duration-300 ease-out">
            <VoicePttOverlay text={pttLiveText} visible={pttActive} />
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
              onDragOver={(e) => {
                if (composerAcceptsDragTypes(e.dataTransfer?.types ?? [])) {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    e.dataTransfer.dropEffect = "copy";
                  } catch {}
                }
              }}
              onDragEnter={(e) => {
                if (composerAcceptsDragTypes(e.dataTransfer?.types ?? [])) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onDrop={(e) => {
                const dt = e.dataTransfer;
                if (!dt) return;
                const workspaceRaw = dt.getData(NEAR_WORKSPACE_DRAG_MIME);
                if (workspaceRaw) {
                  const entry = decodeNearWorkspaceDragEntry(workspaceRaw);
                  if (entry) {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleWorkspaceDragEntry(entry);
                    return;
                  }
                }
                const files = dt.files ? Array.from(dt.files) : [];
                if (files.length === 0) return;
                e.preventDefault();
                e.stopPropagation();
                let showedVisionToast = false;
                for (const file of files) {
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
                  (e.key !== "Enter" && (e.key === "Process" || e.keyCode === 229));
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
                      setComposerText(next, { tokenNames: [first.alias || first.label] });
                      void addTaskspaceAliasReference(first.taskspaceId, first.alias, first.path);
                    } else {
                      void insertAtAutocompleteFileReference(first.taskspaceId, first.path, first.label);
                    }
                    return;
                  }
                  if (composerExpanded) {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      lastComposerEnterAtRef.current = 0;
                      void sendChat(extractComposerText());
                    }
                    return;
                  }
                  e.preventDefault();
                  const composerText = extractComposerText();
                  const trimmedComposer = composerText.trim();
                  const hasComposerPayload = !!trimmedComposer || readyAttachments.length > 0;
                  const sid = (pane.sessionId || "").trim();
                  const inFlightSid =
                    sendChatInFlightRef.current?.paneId === pane.id
                      ? (sendChatInFlightRef.current.sessionId || "").trim()
                      : "";
                  const awaitingFreshSession = isPaneAwaitingFreshSession(pane.id);
                  const queueSid = resolveQueueSessionKey({
                    currentSessionId: sid,
                    inFlightSessionId: inFlightSid,
                    awaitingFreshSession,
                  });
                  const streamActive = isStreamRunActiveForQueue({
                    sessionId: queueSid,
                    streamStateActive: !!sessionStreamStateRef.current[queueSid]?.active,
                    sendInFlightForSession: !!inFlightSid && inFlightSid === queueSid,
                    executionState: sessionExecutionState,
                    currentSessionId: sid,
                  });
                  const queue = useAppStore.getState().pendingMessages[paneId] ?? [];

                  if (streamActive) {
                    const sendQueuedNow =
                      isDoubleEnterWithinWindow(lastComposerEnterAtRef.current) ||
                      (!hasComposerPayload && queue.length > 0 && lastComposerEnterAtRef.current > 0);

                    if (sendQueuedNow) {
                      lastComposerEnterAtRef.current = 0;
                      if (hasComposerPayload) {
                        void sendChat(composerText, { forceSend: true });
                      } else {
                        const latestQueued = queue[queue.length - 1];
                        if (latestQueued) void sendQueuedMessageNow(latestQueued.id);
                      }
                      return;
                    }

                    if (!hasComposerPayload) return;

                    lastComposerEnterAtRef.current = Date.now();
                    void sendChat(composerText);
                    return;
                  }

                  lastComposerEnterAtRef.current = 0;
                  void sendChat(composerText);
                }
              }}
              className={`agx-pane-composer-input block w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-0 pt-4 text-[15px] leading-relaxed text-text-primary outline-none ${
                // 收起时右侧留白需覆盖「展开输入」角标（absolute right-3 + w-8），pr-4 会导致首行末字与按钮重叠
                composerExpanded ? "max-h-[62vh] min-h-[260px] pr-40" : "max-h-[220px] min-h-[72px] pr-14"
              }`}
            />
            {input.trim().length === 0 ? (
              <div className="agx-pane-composer-placeholder pointer-events-none absolute left-4 top-4 text-[15px] text-text-faint">
                发消息...
              </div>
            ) : null}
            </div>
            <div className="agx-pane-composer-actions flex min-w-0 items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
              <div className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden">
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
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                  title="上传附件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
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
                  <PaneKnowledgeRetrievalModeSwitch
                    apiToken={apiToken}
                    apiBase={apiBase}
                    sessionId={pane.sessionId}
                    paneId={paneId}
                    globalDefaultMode={kbGlobalDefaultMode}
                    onNewSessionDefaultChange={onKbNewSessionDefaultChange}
                  />
                </div>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
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
              <div className="flex min-w-0 shrink-0 items-center gap-1.5">
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
                  /* `canInterruptCurrentSession` 只覆盖"当前 pane 自己发起 SSE"的场景。
                   * 分身被 Meta 委派时，分身 pane 自己没有 SSE，但任务确实在跑。
                   * 用 `hasDelegation` 兜底，让分身/Meta 视角下都能看到 stop 按钮，
                   * 后端 `interruptSession` 对任意 session_id 生效。 */
                  streaming={showStopButton}
                  recording={recording}
                  transcribing={voiceTranscribing}
                  onSend={() => {
                    lastComposerEnterAtRef.current = 0;
                    void sendChat(extractComposerText());
                  }}
                  onMic={onMicClick}
                  onStop={stopCurrentRun}
                />
              </div>
            </div>
          </div>
          {composerRefTip
            ? createPortal(
                <div
                  role="tooltip"
                  className="pointer-events-none fixed z-[100] w-max max-w-[min(360px,calc(100vw-24px))] break-all rounded-md border border-border bg-surface-panel px-2.5 py-1.5 text-left text-[11px] leading-snug text-text-primary shadow-lg backdrop-blur-xl"
                  style={{
                    left: composerRefTip.x,
                    top: composerRefTip.y,
                    transform: "translate(-50%, calc(-100% - 6px))",
                  }}
                >
                  {composerRefTip.path}
                </div>,
                document.body
              )
            : null}
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
                        setComposerText(next, { tokenNames: [item.alias || item.label] });
                        void addTaskspaceAliasReference(item.taskspaceId, item.alias, item.path);
                      } else {
                        void insertAtAutocompleteFileReference(item.taskspaceId, item.path, item.label);
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

      {!compactSidePanels && isGroupPane && pane.membersPanelOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整面板宽度"
          >
            <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
          </div>
          <GroupMembersSidePanel
            groupId={groupChatId}
            avatarList={avatars}
            metaLeaderLabel={metaLeaderDisplayName}
            onClose={closeMembersPanelOnly}
          />
        </div>
      ) : null}
      {!compactSidePanels && workspacePanelOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: taskspaceWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeTaskspace}
            title="拖拽调整工作区面板宽度"
          >
            <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
          </div>
          <WorkspacePanel
            paneId={pane.id}
            sessionId={pane.sessionId}
            activeTaskspaceId={pane.activeTaskspaceId}
            onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
            autoRefreshKey={taskspaceAutoRefreshKey}
            onClose={closeWorkspacePanelOnly}
            tintColor={paneTint}
            onPickFileForReference={(taskspaceId, path) => {
              void insertWorkspaceFileReference(taskspaceId, path);
            }}
            onPickDirectoryForReference={({ taskspaceId, relPath, label }) => {
              void insertWorkspaceDirectoryReference(taskspaceId, relPath, label);
            }}
            onQuotePreviewSnippet={insertWorkspaceSnippetReference}
            previewOpenRequest={pendingWorkspacePreviewRequest}
            onPreviewOpenRequestHandled={() => setPendingWorkspacePreviewRequest(null)}
          />
        </div>
      ) : null}
      {!compactSidePanels && pane.spawnsColumnOpen ? (
        <SpawnsColumn
          width={spawnsWidth}
          sessionId={pane.sessionId || undefined}
          subAgents={paneSubAgents}
          selectedSubAgent={selectedSubAgent}
          onResizeStart={startResizeSpawns}
          onClose={() => dismissSpawnsColumn(pane.id, paneSubAgents.map((s) => s.id))}
          onCancel={(agentId) => void cancelPaneSubAgent(agentId)}
          onRetry={(agentId) => void retryPaneSubAgent(agentId)}
          onModelChange={(agentId, provider, model) => void changePaneSubAgentModel(agentId, provider, model)}
          onChat={togglePaneSubAgentChat}
          onOpenRun={openSubAgentDetailFromCluster}
          anchoredRunIds={anchoredSubAgentRunIds}
          onConfirmResolve={(agentId, approved) => void resolvePaneSubAgentConfirm(agentId, approved)}
          tintColor={paneTint}
        />
      ) : null}
      {!compactSidePanels && pane.runDrawerOpen && pane.runDrawerRunId && pane.sessionId ? (
        <SubAgentRunDrawer
          width={runDrawerWidth}
          sessionId={pane.sessionId}
          runId={pane.runDrawerRunId}
          liveSubAgent={drawerLiveSubAgent}
          apiBase={apiBase}
          apiToken={apiToken}
          onResizeStart={startResizeRunDrawer}
          onClose={closeRunDrawerPanelOnly}
          tintColor={paneTint}
        />
      ) : null}
      {!compactSidePanels && pane.memoryGraphOpen ? (
        <div className="relative h-full shrink-0 overflow-hidden border-l border-border" style={{ width: historyWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeHistory}
            title="拖拽调整记忆图谱面板宽度"
          >
            <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
          </div>
          <MemoryGraphPanel pane={pane} onClose={closeMemoryGraphPanelOnly} tintColor={paneTint} />
        </div>
      ) : null}
      {compactSidePanels &&
      (workspacePanelOpen ||
        pane.memoryGraphOpen ||
        (isGroupPane && pane.membersPanelOpen) ||
        pane.spawnsColumnOpen ||
        pane.runDrawerOpen) ? (
        <>
          <div
            aria-hidden
            role="presentation"
            className="pointer-events-auto absolute inset-x-0 bottom-0 top-10 z-[45] bg-black/35 backdrop-blur-[1px]"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            onClick={dismissAuxiliaryOverlays}
          />
          {isGroupPane && pane.membersPanelOpen ? (
            <div
              className="pointer-events-auto absolute bottom-0 right-0 top-10 z-50 shrink-0 overflow-hidden border-l border-border bg-surface-base shadow-[6px_0_24px_rgba(0,0,0,0.28)]"
              style={{ width: overlayTaskspaceWidth, WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <div
                className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
                onMouseDown={startResizeTaskspace}
                title="拖拽调整面板宽度"
              >
                <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
              </div>
              <GroupMembersSidePanel
                groupId={groupChatId}
                avatarList={avatars}
                metaLeaderLabel={metaLeaderDisplayName}
                onClose={closeMembersPanelOnly}
              />
            </div>
          ) : null}
          {workspacePanelOpen ? (
            <div
              className="pointer-events-auto absolute bottom-0 right-0 top-10 z-50 shrink-0 overflow-hidden border-l border-border bg-surface-base shadow-[6px_0_24px_rgba(0,0,0,0.28)]"
              style={{ width: overlayTaskspaceWidth, WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <div
                className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
                onMouseDown={startResizeTaskspace}
                title="拖拽调整工作区面板宽度"
              >
                <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
              </div>
              <WorkspacePanel
                paneId={pane.id}
                sessionId={pane.sessionId}
                activeTaskspaceId={pane.activeTaskspaceId}
                onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
                autoRefreshKey={taskspaceAutoRefreshKey}
                onClose={closeWorkspacePanelOnly}
                tintColor={paneTint}
                onPickFileForReference={(taskspaceId, path) => {
                  void insertWorkspaceFileReference(taskspaceId, path);
                }}
                onPickDirectoryForReference={({ taskspaceId, relPath, label }) => {
                  void insertWorkspaceDirectoryReference(taskspaceId, relPath, label);
                }}
                onQuotePreviewSnippet={insertWorkspaceSnippetReference}
                previewOpenRequest={pendingWorkspacePreviewRequest}
                onPreviewOpenRequestHandled={() => setPendingWorkspacePreviewRequest(null)}
              />
            </div>
          ) : null}
          {pane.spawnsColumnOpen ? (
            <div
              className="pointer-events-auto absolute bottom-0 right-0 top-10 z-50 shrink-0 overflow-hidden shadow-[6px_0_24px_rgba(0,0,0,0.28)]"
              style={{ width: overlaySpawnsWidth, WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <SpawnsColumn
                width={overlaySpawnsWidth}
                sessionId={pane.sessionId || undefined}
                subAgents={paneSubAgents}
                selectedSubAgent={selectedSubAgent}
                onResizeStart={startResizeSpawns}
                onClose={() => dismissSpawnsColumn(pane.id, paneSubAgents.map((s) => s.id))}
                onCancel={(agentId) => void cancelPaneSubAgent(agentId)}
                onRetry={(agentId) => void retryPaneSubAgent(agentId)}
                onModelChange={(agentId, provider, model) => void changePaneSubAgentModel(agentId, provider, model)}
                onChat={togglePaneSubAgentChat}
                onOpenRun={openSubAgentDetailFromCluster}
                anchoredRunIds={anchoredSubAgentRunIds}
                onConfirmResolve={(agentId, approved) => void resolvePaneSubAgentConfirm(agentId, approved)}
                tintColor={paneTint}
              />
            </div>
          ) : null}
          {pane.runDrawerOpen && pane.runDrawerRunId && pane.sessionId ? (
            <div
              className="pointer-events-auto absolute bottom-0 right-0 top-10 z-50 shrink-0 overflow-hidden shadow-[6px_0_24px_rgba(0,0,0,0.28)]"
              style={{ width: overlayRunDrawerWidth, WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <SubAgentRunDrawer
                width={overlayRunDrawerWidth}
                sessionId={pane.sessionId}
                runId={pane.runDrawerRunId}
                liveSubAgent={drawerLiveSubAgent}
                apiBase={apiBase}
                apiToken={apiToken}
                onResizeStart={startResizeRunDrawer}
                onClose={closeRunDrawerPanelOnly}
                tintColor={paneTint}
              />
            </div>
          ) : null}
          {pane.memoryGraphOpen ? (
            <div
              className="pointer-events-auto absolute bottom-0 right-0 top-10 z-50 shrink-0 overflow-hidden border-l border-border bg-surface-base shadow-[6px_0_24px_rgba(0,0,0,0.28)]"
              style={{ width: overlayHistoryWidth, WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <div
                className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
                onMouseDown={startResizeHistory}
                title="拖拽调整记忆图谱面板宽度"
              >
                <div className="mx-auto h-full w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
              </div>
              <MemoryGraphPanel pane={pane} onClose={closeMemoryGraphPanelOnly} tintColor={paneTint} />
            </div>
          ) : null}
        </>
      ) : null}
      {pane.historyOpen && historyAnchorRect
        ? createPortal(
            <>
              <div
                aria-hidden
                role="presentation"
                className="fixed inset-0 z-[9998]"
                onClick={closeHistoryPanelOnly}
              />
              <div
                className="fixed z-[9999] overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl backdrop-blur-xl"
                style={historyPanelPopoverStyle(historyAnchorRect)}
              >
                <HistoryPanelBoundary key={`hpb-${pane.id}-${pane.historyOpen}-popover`}>
                  <SessionHistoryPanel pane={pane} tintColor={paneTint} />
                </HistoryPanelBoundary>
              </div>
            </>,
            document.body
          )
        : null}
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
