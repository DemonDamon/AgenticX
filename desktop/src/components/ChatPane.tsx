import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addressForSession,
  ATTACHMENT_ROUTING_OFF,
  decideAttachmentRouting,
  dismissRoutingNotice,
  routingLockReason,
  routingNoticeDismissed,
  type RoutingModelRef,
} from "../utils/attachment-routing";
import type { ErrorInfo, ReactNode, MouseEvent as ReactMouseEvent, CSSProperties, RefObject } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Database,
  GripVertical,
  LayoutList,
  ListTree,
  Quote,
  Search,
  TextSearch,
  Forward,
  Sparkles,
  Radar,
  SquarePen,
  Plus,
  Wrench,
  Settings,
  UsersRound,
  X,
  PanelRight,
  ArrowRight,
  Loader2,
  PhoneCall,
} from "lucide-react";
import {
  useAppStore,
  type Avatar,
  type ChatPane as ChatPaneState,
  type ConfirmStrategy,
  type Message,
  type MessageAttachment,
  type PendingConfirm,
  type QueuedMessage,
  type SidePanelTab,
  type Taskspace,
} from "../store";
import { VOICE_UI_ENABLED } from "../constants/feature-flags";
import { LOCAL_KNOWLEDGE_ENABLED } from "../constants/desktop-feature-visibility";
import { useGraphRunStore } from "./graph/useGraphRun";
import { graphHasTaskNodes } from "./graph/graph-types";
import {
  appendDictationText,
  cancelDictation,
  startDictation,
  type SttPhase,
} from "../voice/stt";
import { useVoicePushToTalk } from "../hooks/useVoicePushToTalk";
import { VoicePttOverlay } from "./VoicePttOverlay";
import { SessionHistoryPanel } from "./SessionHistoryPanel";
import { AvatarSettingsPanel } from "./AvatarSettingsPanel";
import { MemoryGraphPanel } from "./memory/MemoryGraphPanel";
import { StickyTaskBar } from "./StickyTaskBar";
import { ContextUsageButton } from "./ContextUsagePopup";
import type { WorkspacePreviewOpenRequest, WorkspacePreviewQuotePayload } from "./workspace/workspace-preview-types";
import {
  NEAR_WORKSPACE_OPEN_PREVIEW,
  NEAR_WORKSPACE_PICK_DIR,
  NEAR_WORKSPACE_PICK_FILE,
  type NearWorkspaceOpenPreviewDetail,
  type NearWorkspacePickDirDetail,
  type NearWorkspacePickFileDetail,
} from "../utils/workspace-sidebar-events";
import { WorkPanel, type WorkPanelFocus } from "./work-panel/WorkPanel";
import { GroupMemberAvatar } from "./groups/GroupMemberAvatar";
import { loadPreparedHtmlSrcDoc } from "../utils/html-preview-assets";
import { buildHtmlElementContextSnippet } from "../utils/html-preview-inspect";
import {
  artifactBaseName,
  isInAppArtifactPreviewPath,
  isInAppHtmlPreviewPath,
  looksLikeDirectoryPath,
  pathToFileUrl,
} from "../utils/session-artifacts";
import { SubAgentRunDrawer } from "./subagent";
import { MessageRenderer, renderToolMessageExtras } from "./messages/MessageRenderer";
import type { SkillPatchPreviewPayload } from "./messages/skill-manage-preview";
import { extractPartialShowWidgetArgs } from "./messages/show-widget-partial";
import { groupConsecutiveToolMessages, shouldHoldToolGroupProgress, type GroupedChatRow } from "./messages/group-tool-messages";
import { resolveProcessFoldRange } from "./messages/react-work-fold";
import {
  isEphemeralStopErrorText,
  isInterruptedAssistantPlaceholder,
} from "../utils/noisy-chat-messages";
import { isStreamToolLabelOnlyText, shouldSkipFormattedToolResultFallback } from "../utils/orphan-formatted-tool";
import { HOOK_BLOCK_RE } from "../utils/hook-block-message";
import {
  collectTurnLinkedIds,
  collectTurnLinkedIdsForBlock,
  countSelectedConversationTurns,
  expandMessagesToTopLevelRows,
  expandSelectionToCompleteTurns,
} from "./messages/react-blocks";
import { isSubAgentLiveStatus, shouldHideStreamOverlay, shouldShowMidTurnStreamActivity } from "../utils/stream-overlay-policy";
import { flushSubAgentLiveOutput } from "../utils/subagent-live-output";
import { resolveSubAgentOutputPaths } from "../utils/subagent-output-files";
import { TurnToolGroupCard } from "./messages/TurnToolGroupCard";
import { ReactWorkCollapse } from "./messages/ReactWorkCollapse";
import { StallWaitChip } from "./messages/StallWaitChip";
import { parseStallWaitPayload, type StallWaitInfo } from "../utils/stall-wait-chip";
import { WorkingIndicator } from "./messages/WorkingIndicator";
import { ImBubble } from "./messages/ImBubble";
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
import { resolveForwardTarget as resolveForwardTargetPayload } from "../utils/resolve-forward-target";
import { HoverTip } from "./ds/HoverTip";
import { ConnectorsMenuButton } from "./connectors/ConnectorsMenuButton";
import { SkillPuzzleIcon, skillPuzzleIconInnerHtml } from "./icons/SkillPuzzleIcon";
import { filterAndRankSkills } from "../utils/skill-search";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  composerRefIconInnerHtml,
  resolveComposerRefIconKind,
} from "./icons/ComposerRefIcon";
import { composerQuoteIconInnerHtml, formatQuoteChipLabel } from "./icons/ComposerQuoteIcon";
import {
  composerQuotePlaceholder,
  matchComposerQuotePlaceholder,
  normalizeComposerQuotePlaceholdersToIndices,
  serializeQuotedContent,
  stripComposerQuotePlaceholders,
  type QuotePayloadItem,
} from "../utils/user-quote-display";
import {
  AT_MENTION_SEARCH_DEBOUNCE_MS,
  domTextLooksNonEmpty,
  isComposerNonEmpty,
  nextComposerAtMentionState,
  replaceAtMentionAtCaret,
} from "../utils/composer-input-sync";
import { Toast } from "./ds/Toast";
import { TopbarContextControls, TopbarGlobalActions } from "./Topbar";
import { ComposerContextControls } from "./ComposerContextControls";
import { AtMentionPicker } from "./AtMentionPicker";
import type { AtMentionBrowseState } from "./AtMentionPicker";
import type { AtMentionCandidate } from "../utils/at-mention-display";
import { parentBrowsePath } from "../utils/at-mention-display";
import { extractClipboardImageFiles, withClipboardImageNames } from "../utils/clipboard-images";
import { clipboardPlainTextForPaste } from "../utils/clipboard-plain-text";
import { isKnownNonVisionChatModel } from "../utils/model-vision";
import { getVisionFallbackInfo, type VisionFallbackInfo } from "../utils/vision-fallback";
import {
  applySessionFindHighlights,
  clearSessionFindHighlights,
} from "../utils/session-find-highlight";
import { isVideoFile } from "../utils/video-file";
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
import { shouldApplyScrollPinFromEvent, shouldPinScrollOnUserSend } from "../utils/chat-scroll-pin";
import {
  TURN_INTERRUPTED_TOAST,
  isTurnInterruptionNoticeMessage,
  shouldAutoResumeTruncationInterruption,
} from "../utils/turn-interruption-notice";
import {
  CHANNEL_C_GRACE_MS,
  stallDetectSilenceMs,
  isFutileResume,
  lastTurnHasActiveToolActivity,
  lastTurnHasCompletedAssistantReply,
  lastTurnHasToolActivity,
  paneHasPendingHumanGate,
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
import {
  buildPendingToolFallback,
  buildDeferredToolResultResolution,
  drainPendingToolResults,
  hasMatchingToolCall,
  resolvePendingToolName,
  type PendingToolResult,
} from "../utils/pending-tool-result";
import { injectLiveSubAgentClusterAnchors } from "../utils/subagent-cluster-inline";
import {
  buildSubAgentFromRunRecord,
  hydrateSessionSubAgentsFromDisk,
} from "../utils/subagent-hydrate";
import { fetchRunActivityPage, fetchRunDetail } from "./subagent/run-drawer-api";
import type { SubAgentRunRecord } from "./subagent/badge-vm";
import {
  enrichDiskMessagesWithInMemoryReferences,
  referencesDifferBetweenTails,
} from "../utils/session-reference-reconcile";
import { resolveReferencesForAssistant } from "../utils/turn-reference-context";
import { reattachSessionStreamUrl, parseSseFrame } from "../utils/session-reattach";
import {
  mapLoadedSessionMessage,
  type LoadedSessionMessage,
} from "../utils/session-message-map";
import {
  assistantVisibleBodyForUi,
  buildCommittedAssistantPatch,
  normalizeFinalAssistantPayload,
  reasoningDuplicatesVisibleBody,
} from "../utils/assistant-output";
import {
  buildContextFileKeyFromAttachment,
  canonicalizeUserReferenceMentions,
  findReferenceAttachmentMeta,
  isWorkspaceReferenceAttachment,
  parseLineRangeFromReferenceLabel,
} from "../utils/reference-attachment";
import { NEAR_ARTIFACT_TASKSPACES_SYNCED } from "../utils/workspace-sidebar-events";
import { isLikelyTextFile } from "../utils/text-attachment";
import { isViewImageInjectMessage } from "../utils/view-image-inject";
import { resolveSessionTailForSwitch, invalidateSessionTail } from "../utils/session-tail-cache";
import { visibleMessagesForSession } from "../utils/message-ownership";
import { maxContinuationRound } from "../utils/continuation-notice";
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
import { formatModelDisplayParts, formatModelOptionLabel } from "../utils/model-display";
import { SettingsSwitch } from "./settings/SettingsSwitch";
import {
  DEFAULT_KIMI_REASONING_EFFORT,
  DEEPSEEK_REASONING_EFFORT_OPTIONS,
  describeModelForPicker,
  KIMI_REASONING_EFFORT_OPTIONS,
  labelForDeepSeekReasoningEffort,
  labelForKimiReasoningEffort,
  normalizeDeepSeekReasoningEffort,
  normalizeKimiReasoningEffort,
  supportsDeepSeekV4Thinking,
  supportsKimiK3ReasoningEffort,
  type DeepSeekReasoningEffort,
  type KimiReasoningEffort,
} from "../utils/model-hover-blurb";
import { getProviderDisplayName } from "../utils/provider-display";
import {
  collectSelectableModelOptions,
  coerceSelectableModel,
  groupManagedModelOptions,
  isModelSelectable,
  isProviderCredentialed,
  resolveDirectModelPickerProvider,
  sortModelOptionsByPrefix,
} from "../utils/model-options";
import { resolveManagedContextWindow } from "../utils/managed-context-window";
import { isAutomationPaneAvatarId } from "../utils/automation-pane";
import { shouldAutoApproveConfirm } from "../utils/confirm-scope";
import { sessionCreateAvatarId } from "../utils/session-create-avatar";
import { NEW_TOPIC_INHERITS_CONTEXT, newTopicTriggerLabel } from "../utils/new-topic-label";
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
import { buildMessagesPdfHtml, expandSelectionForCompletePdfExport, messagesForShareExport } from "../utils/export-pdf-html";
import { ShareImagePreviewModal } from "./ShareImagePreviewModal";
import { buildCompactionEventNotice, noticeKindForRuntimeWarning } from "../utils/context-notice";
import { usePaneSortableHandle } from "./pane-sortable-context";
import { FeishuBadge } from "./FeishuBadge";
import {
  SHOW_DESKTOP_EXTERNAL_IM,
  SHOW_DESKTOP_MULTI_PANE,
  SHOW_DESKTOP_RUN_GRAPH,
} from "../constants/desktop-feature-visibility";
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
  COMPOSER_DRAFT_SAVE_DEBOUNCE_MS,
  composerDraftIdentity,
  deleteComposerDraft,
  loadComposerDraft,
  migrateComposerDraft,
  saveComposerDraft,
  type ComposerDraft,
  type ComposerDraftAttachment,
  type ComposerDraftRefMeta,
} from "../utils/composer-draft-storage";
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
import { formatTaskspaceAddError } from "../utils/taskspace-errors";
import {
  ensureWorkspaceSessionBeforeFirstMessage,
  shouldKeepNewTopicWorkspaceControls,
} from "../utils/workspace-session-visibility";
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
  findRunningActionConfirmationToolMessage,
  findRunningClarificationToolMessage,
} from "../utils/clarification-inline";
import { parseClarificationDecisions } from "../utils/clarification-notice";
import {
  buildActionConfirmationAnswer,
  findResolvableActionConfirmation,
  matchActionConfirmationReply,
  parseActionConfirmationContext,
  type ActionConfirmationDecision,
  type PendingActionConfirmation,
} from "../utils/action-confirmation";

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

type ForwardPendingAttachment = {
  name: string;
  mime_type: string;
  size: number;
  data_url?: string;
  source_path?: string;
};

type ForwardPendingMessage = {
  sender: string;
  role: string;
  content: string;
  avatar_url?: string;
  timestamp?: number;
  attachments?: ForwardPendingAttachment[];
};

function attachmentsForForwardPayload(message: Message): ForwardPendingAttachment[] | undefined {
  const atts = message.attachments;
  if (!Array.isArray(atts) || atts.length === 0) return undefined;
  const out: ForwardPendingAttachment[] = [];
  for (const att of atts) {
    const name = String(att.name || "").trim() || "file";
    const mime = String(att.mimeType || "").trim() || "application/octet-stream";
    const size = Number.isFinite(att.size) ? Number(att.size) : 0;
    const dataUrl = String(att.dataUrl || "").trim();
    const sourcePath = String(att.sourcePath || "").trim();
    if (!dataUrl && !sourcePath && name === "file") continue;
    out.push({
      name,
      mime_type: mime,
      size: Math.max(0, size),
      ...(dataUrl ? { data_url: dataUrl } : {}),
      ...(sourcePath ? { source_path: sourcePath } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function buildForwardPendingMessage(
  message: Message,
  userLabel: string,
  selectedText?: string
): ForwardPendingMessage {
  const attachments = attachmentsForForwardPayload(message);
  let content = resolveQuoteBody(message, selectedText).trim();
  if (!content && attachments?.length) {
    content = `（见附件：${attachments.map((a) => a.name).slice(0, 3).join("、")}）`;
  }
  return {
    sender: resolveForwardSender(message, userLabel),
    role: message.role,
    content,
    avatar_url: message.avatarUrl,
    timestamp: message.timestamp,
    ...(attachments ? { attachments } : {}),
  };
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
const EMPTY_TASKSPACES: Taskspace[] = [];
const KB_RETRIEVAL_MODE_OPTIONS: {
  value: "auto" | "always";
  label: string;
  hint: string;
}[] = [
  { value: "auto", label: "智能检索", hint: "由模型判断何时查知识库" },
  { value: "always", label: "始终检索", hint: "回答前优先检索知识库" },
];

/** 多分窗下仅看窗口宽度不可靠：按单窗格可视宽度切换到「侧栏抽屉」模式（对齐左侧主导航 overlay，不并排挤压会话区）。 */
const CHATPANE_SIDE_OVERLAY_BREAK = 760;

/** 程序化展开工作区：窄窗格时与其它侧栏互斥，避免并排挤压。 */
function openWorkspaceSidebarForPane(
  paneId: string,
  paneOuterWidthPx: number,
  openSidePanel: (paneId: string, tab: SidePanelTab) => void,
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
            graphPanelOpen: false,
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
  graphPanelOpen: false,
  activeGraphRunId: null,
  sidePanelTab: "workspace",
  activeTaskspaceId: null,
  spawnsColumnOpen: false,
  spawnsColumnSuppressAuto: false,
  spawnsColumnBaselineIds: [],
  terminalTabs: [],
  activeTerminalTabId: null,
  sessionTokens: { input: 0, output: 0 },
  historySearchTerms: [],
  historyJumpMessageId: null,
  loadingMessages: false,
  oldestLoadedIndex: 0,
  hasOlderMessages: false,
  loadingOlderMessages: false,
  runDrawerOpen: false,
  runDrawerRunId: null,
};

/** 输入区能力菜单的浮层宽度。 */
const KB_MODE_SUBMENU_WIDTH = 200;

/** 将「更多操作」的二级菜单与一级菜单同顶并排，空间不足时翻到左侧。 */
function positionEmbeddedComposerFlyout(
  triggerEl: HTMLElement,
  flyoutWidth: number,
  preferredMaxHeight?: number,
): { top: number; left: number; maxHeight: number } {
  const parent = triggerEl.closest(".agx-menu-pop");
  const band = (parent ?? triggerEl).getBoundingClientRect();
  const gap = 8;
  let left = band.right + gap;
  if (left + flyoutWidth > window.innerWidth - gap) {
    left = band.left - flyoutWidth - gap;
  }
  left = Math.max(gap, Math.min(left, window.innerWidth - flyoutWidth - gap));
  const viewportMaxHeight = Math.max(120, window.innerHeight - gap * 2);
  const maxHeight = Math.min(
    Math.max(120, preferredMaxHeight ?? band.height),
    viewportMaxHeight,
  );
  return {
    top: Math.max(gap, Math.min(band.top, window.innerHeight - maxHeight - gap)),
    left,
    maxHeight,
  };
}

/** 顶栏单一主操作：始终在当前元智能体、数字专家或群聊下开启全新上下文。 */
function NewTopicButton({
  onNewTopic,
  triggerLabel,
}: {
  onNewTopic: (inherit: boolean, sessionMode?: PaneSessionMode) => void;
  triggerLabel: string;
}) {
  return (
    <HoverTip label={triggerLabel}>
      <button
        type="button"
        className="agx-topbar-btn !px-[5px]"
        aria-label={triggerLabel}
        onClick={() => onNewTopic(NEW_TOPIC_INHERITS_CONTEXT, "daily_office")}
      >
        <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
      </button>
    </HoverTip>
  );
}

/** 「更多操作」只承载当前消息的附件与能力，不混入会话级的新对话操作。 */
function ComposerMoreActionsButton({
  onPickFile,
  renderSkillPicker,
  renderKbRetrieval,
  renderConnectors,
}: {
  onPickFile: () => void;
  renderSkillPicker: () => ReactNode;
  renderKbRetrieval?: () => ReactNode;
  renderConnectors: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const syncPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) syncPosition();
      return next;
    });
  }, [syncPosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      for (const id of [
        "agx-skill-picker-dropdown",
        "agx-kb-retrieval-mode-menu",
        "agx-connectors-menu-dropdown",
      ]) {
        if (document.getElementById(id)?.contains(target)) return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [open, syncPosition]);

  const panel = open && panelPos
    ? createPortal(
        <div
          ref={panelRef}
          style={{ bottom: panelPos.bottom, left: panelPos.left, transformOrigin: "bottom left" }}
          className="agx-menu-pop fixed z-[9999] flex w-56 flex-col gap-0.5 rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
          role="menu"
          aria-label="更多操作"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-standard transition-colors hover:bg-surface-hover"
            onClick={() => {
              onPickFile();
              setOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px] shrink-0 text-text-muted">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            <span className="flex-1">添加文件</span>
          </button>
          {renderSkillPicker()}
          {renderKbRetrieval?.()}
          {renderConnectors()}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={rootRef} className="flex shrink-0 items-center">
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-strong transition hover:bg-surface-hover"
          aria-label="更多操作"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <Plus className={`h-[17px] w-[17px] transition-transform ${open ? "rotate-45" : ""}`} strokeWidth={1.85} aria-hidden />
        </button>
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
  /** Render as a full-width row inside「更多操作」and open a side flyout. */
  embedded?: boolean;
}

const SKILL_DROPDOWN_WIDTH = 288; // w-72
const SKILL_DROPDOWN_MAX_HEIGHT = 360;

function SkillPickerButton({ apiBase, apiToken, onSelect, embedded = false }: SkillPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<
    { left: number; top?: number; bottom?: number; maxHeight?: number } | null
  >(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong";

  const fetchSkills = useCallback(async () => {
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
  }, [apiBase, apiToken]);

  useEffect(() => {
    const off = window.agenticxDesktop.onSkillsChanged(() => {
      void fetchSkills();
    });
    return () => off();
  }, [fetchSkills]);

  const handleOpen = () => {
    if (btnRef.current) {
      if (embedded) {
        setDropdownPos(
          positionEmbeddedComposerFlyout(
            btnRef.current,
            SKILL_DROPDOWN_WIDTH,
            SKILL_DROPDOWN_MAX_HEIGHT,
          ),
        );
      } else {
        const rect = btnRef.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.right + 8, window.innerWidth - SKILL_DROPDOWN_WIDTH - 8));
        setDropdownPos({ bottom: window.innerHeight - rect.top + 6, left });
      }
    }
    setOpen(true);
    setQuery("");
    void fetchSkills();
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

  const filtered = filterAndRankSkills(skills, query);

  const dropdown =
    open && dropdownPos
      ? createPortal(
          <div
            id="agx-skill-picker-dropdown"
            style={{
              left: dropdownPos.left,
              width: SKILL_DROPDOWN_WIDTH,
              ...(dropdownPos.top != null
                ? { top: dropdownPos.top, maxHeight: dropdownPos.maxHeight }
                : { bottom: dropdownPos.bottom }),
            }}
            className="fixed z-[9999] flex w-72 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl backdrop-blur-md"
          >
            <div className="shrink-0 border-b border-border p-2">
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
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {loading && skills.length === 0 ? (
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
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--theme-color-rgb,59,130,246),0.22)] text-[rgb(var(--theme-color-fg-rgb,59,130,246))]">
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

  if (embedded) {
    return (
      <>
        <button
          ref={btnRef}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-standard transition-colors hover:bg-surface-hover"
          aria-label="技能"
          aria-expanded={open}
          onClick={open ? handleClose : handleOpen}
        >
          <SkillPuzzleIcon className="h-[15px] w-[15px] shrink-0 text-text-muted" />
          <span className="flex-1">技能</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
        </button>
        {dropdown}
      </>
    );
  }

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
const PANE_MODEL_PICKER_MAX_HEIGHT = 360;
const PANE_MODEL_PICKER_PANEL_WIDTH = 360;

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
    const maxHeight = Math.min(
      PANE_MODEL_PICKER_MAX_HEIGHT,
      Math.max(PANE_MODEL_PICKER_MIN_MAX_HEIGHT, Math.floor(spaceAbove)),
    );
    return {
      left,
      width: panelWidth,
      maxHeight,
      bottom: vh - anchor.top + PANE_MODEL_PICKER_GAP,
      top: "auto",
      right: "auto",
    };
  }

  const maxHeight = Math.min(
    PANE_MODEL_PICKER_MAX_HEIGHT,
    Math.max(PANE_MODEL_PICKER_MIN_MAX_HEIGHT, Math.floor(spaceBelow)),
  );
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

/** Monochrome provider mark: shape carries identity while color follows the active theme. */
function ProviderGlyph({ provider, model }: { provider: string; model?: string }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-strong" aria-hidden>
      <ProviderIcon provider={provider} model={model} className="h-[15px] w-[15px]" />
    </span>
  );
}

const MODEL_HOVER_TIP_WIDTH = 220;
const MODEL_HOVER_TIP_GAP = 8;
const MODEL_HOVER_TIP_EFFORT_ROW_HEIGHT = 30;

/** Rough height budget for the model hover card (used for first paint before measure). */
function estimateModelHoverTipHeight(args: {
  showDeepSeekThinking: boolean;
  paneThinkingEnabled: boolean;
  effortMenuOpen: boolean;
  showEffortControls: boolean;
  deepSeekEffortCount: number;
  kimiEffortCount: number;
}): number {
  const {
    showDeepSeekThinking,
    paneThinkingEnabled,
    effortMenuOpen,
    showEffortControls,
    deepSeekEffortCount,
    kimiEffortCount,
  } = args;
  if (showDeepSeekThinking) {
    let h = 140;
    if (paneThinkingEnabled) {
      h = 172;
      if (effortMenuOpen) {
        h += 12 + deepSeekEffortCount * MODEL_HOVER_TIP_EFFORT_ROW_HEIGHT + 8;
      }
    }
    return h;
  }
  if (showEffortControls) {
    let h = 148;
    if (effortMenuOpen) {
      h += 12 + kimiEffortCount * MODEL_HOVER_TIP_EFFORT_ROW_HEIGHT + 8;
    }
    return h;
  }
  return 108;
}

function clampFixedPopoverTop(top: number, height: number, margin = PANE_MODEL_PICKER_MARGIN): number {
  const vh = window.innerHeight;
  let nextTop = top;
  if (nextTop + height > vh - margin) {
    nextTop = Math.max(margin, vh - margin - height);
  }
  if (nextTop < margin) nextTop = margin;
  return nextTop;
}

function PaneModelPicker({ paneId }: { paneId: string }) {
  const settings = useAppStore((s) => s.settings);
  const setPaneModel = useAppStore((s) => s.setPaneModel);
  const setPaneReasoningEffort = useAppStore((s) => s.setPaneReasoningEffort);
  const setPaneThinkingEnabled = useAppStore((s) => s.setPaneThinkingEnabled);
  const paneModel = useAppStore((s) => s.panes.find((pane) => pane.id === paneId));
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeModelRowRef = useRef<HTMLButtonElement | null>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverRowTop, setHoverRowTop] = useState(0);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const hoverTipRef = useRef<HTMLDivElement>(null);
  const [hoverTipLayout, setHoverTipLayout] = useState<{ top: number; maxHeight: number } | null>(
    null,
  );

  /** Keep tip visible while moving between list row and tip card. */
  const cancelClearHover = useCallback(() => {
    if (hoverClearTimerRef.current != null) {
      clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
  }, []);

  const scheduleClearHover = useCallback(() => {
    cancelClearHover();
    hoverClearTimerRef.current = setTimeout(() => {
      setHoverKey(null);
      setEffortMenuOpen(false);
      hoverClearTimerRef.current = null;
    }, 120);
  }, [cancelClearHover]);

  useEffect(() => {
    return () => {
      if (hoverClearTimerRef.current != null) {
        clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
    };
  }, []);

  const handleSelect = (provider: string, model: string) => {
    setPaneModel(paneId, provider, model);
    setOpen(false);
    // Persist the current pane model as global fallback for restarts.
    void window.agenticxDesktop.saveConfig({ activeProvider: provider, activeModel: model }).then((result) => {
      if (!result.ok) {
        console.warn("[ChatPane] global model persistence failed", result.error);
      }
    });
    // If this pane is bound to a real session, record the model against that
    // session so a cold restart + jump-back restores the exact pick.
    const sid = String(paneModel?.sessionId ?? "").trim();
    if (sid) {
      void window.agenticxDesktop.setSessionModel({ sessionId: sid, provider, model }).then((result) => {
        if (!result.ok) {
          console.warn("[ChatPane] session model persistence failed", result.error);
        }
      });
    }
  };

  const options = useMemo(
    () => sortModelOptionsByPrefix(collectSelectableModelOptions(settings.providers)),
    [settings.providers],
  );

  /**
   * Group by vendor. Seed every enabled+credentialed provider first so「已启动」渠道
   * (e.g. MOMA with only legacy `model` / empty visible `models`) still gets a section.
   */
  const physicalProviderGroups = useMemo(() => {
    const byProvider = new Map<string, typeof options>();
    for (const [provider, entry] of Object.entries(settings.providers)) {
      if (entry.enabled === false) continue;
      if (!isProviderCredentialed(entry)) continue;
      byProvider.set(provider, []);
    }
    for (const opt of options) {
      const bucket = byProvider.get(opt.provider);
      if (bucket) bucket.push(opt);
      else byProvider.set(opt.provider, [opt]);
    }
    return [...byProvider.entries()].map(([provider, items]) => ({
      provider,
      providerLabel: getProviderDisplayName(provider, settings.providers[provider]),
      items,
    }));
  }, [options, settings.providers]);
  const directProviderId = useMemo(
    () => resolveDirectModelPickerProvider(settings.providers),
    [settings.providers],
  );
  const groups = useMemo(() => {
    if (directProviderId) {
      const entry = settings.providers[directProviderId];
      if (entry) {
        const internalGroups = groupManagedModelOptions(
          entry,
          options.filter((option) => option.provider === directProviderId),
        );
        return internalGroups.map((group) => ({
          key: `${directProviderId}:${group.provider.toLowerCase()}`,
          requestProvider: directProviderId,
          visualProvider: group.provider,
          providerLabel: group.providerLabel,
          items: group.items,
        }));
      }
    }
    return physicalProviderGroups.map((group) => ({
      key: group.provider,
      requestProvider: group.provider,
      visualProvider: group.provider,
      providerLabel: group.providerLabel,
      items: group.items,
    }));
  }, [directProviderId, options, physicalProviderGroups, settings.providers]);
  const explicitlySelectedProviderGroup = selectedProviderId
    ? groups.find((group) => group.key === selectedProviderId) ?? null
    : null;
  const selectedProviderGroup =
    explicitlySelectedProviderGroup ?? (directProviderId && groups.length === 1 ? groups[0] ?? null : null);
  const displayedProviderId = selectedProviderGroup?.requestProvider ?? null;

  /** Same model id served by several vendors — only then does the row need its vendor spelled out. */
  const ambiguousModelNames = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    for (const opt of options) {
      const { modelName } = formatModelDisplayParts(opt.provider, opt.model, settings.providers[opt.provider]);
      const providers = seen.get(modelName) ?? new Set<string>();
      providers.add(opt.provider);
      seen.set(modelName, providers);
    }
    return new Set([...seen.entries()].filter(([, p]) => p.size > 1).map(([name]) => name));
  }, [options, settings.providers]);

  const currentProvider = (paneModel?.modelProvider || "").trim();
  const currentModel = (paneModel?.modelName || "").trim();
  const currentSelectable =
    Boolean(currentModel)
    && Boolean(currentProvider)
    && isModelSelectable(currentProvider, currentModel, settings.providers);
  const currentParts = useMemo(() => {
    if (!currentSelectable) return null;
    return formatModelDisplayParts(currentProvider, currentModel, settings.providers[currentProvider]);
  }, [currentSelectable, currentModel, currentProvider, settings.providers]);
  const currentLabel = useMemo(() => {
    if (!currentModel) return "未选模型";
    if (!currentProvider) return currentModel;
    if (!currentSelectable) return "未选模型";
    const entry = settings.providers[currentProvider];
    return formatModelOptionLabel(currentProvider, currentModel, entry);
  }, [currentModel, currentProvider, currentSelectable, settings.providers]);

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

  useEffect(() => {
    if (!open) {
      setHoverKey(null);
      setEffortMenuOpen(false);
      setSelectedProviderId(null);
      cancelClearHover();
    }
  }, [open, cancelClearHover]);

  // 进入当前渠道的模型列表后，把当前模型滚进可视区。
  useLayoutEffect(() => {
    if (!open || displayedProviderId !== currentProvider) return;
    const row = activeModelRowRef.current;
    if (!row) return;
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, displayedProviderId, currentProvider, currentModel]);

  const hoverOpt = useMemo(() => {
    if (!hoverKey) return null;
    return options.find((o) => `${o.provider}:${o.model}` === hoverKey) ?? null;
  }, [hoverKey, options]);

  const hoverBlurb = useMemo(() => {
    if (!hoverOpt) return null;
    const providerGroup = groups.find((group) =>
      group.items.some(
        (item) => item.provider === hoverOpt.provider && item.model === hoverOpt.model,
      ),
    );
    const providerLabel =
      providerGroup?.providerLabel
      ?? getProviderDisplayName(hoverOpt.provider, settings.providers[hoverOpt.provider]);
    return describeModelForPicker(
      providerGroup?.visualProvider ?? hoverOpt.provider,
      hoverOpt.model,
      providerLabel,
    );
  }, [groups, hoverOpt, settings.providers]);

  const paneReasoningEffort = normalizeKimiReasoningEffort(paneModel?.reasoningEffort);
  const paneDeepSeekEffort = normalizeDeepSeekReasoningEffort(paneModel?.reasoningEffort);
  const paneThinkingEnabled = paneModel?.thinkingEnabled !== false;
  const showEffortControls = Boolean(hoverBlurb?.supportsReasoningEffort);
  const showDeepSeekThinking = Boolean(hoverBlurb?.supportsDeepSeekThinking);

  const hoverTipStyle = useMemo((): CSSProperties | null => {
    if (!hoverBlurb || !panelRef.current) return null;
    const panel = panelRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const tipW = MODEL_HOVER_TIP_WIDTH;
    const spaceRight = vw - panel.right - PANE_MODEL_PICKER_MARGIN;
    const placeRight = spaceRight >= tipW + MODEL_HOVER_TIP_GAP;
    const left = placeRight
      ? panel.right + MODEL_HOVER_TIP_GAP
      : Math.max(PANE_MODEL_PICKER_MARGIN, panel.left - MODEL_HOVER_TIP_GAP - tipW);
    const tipH = estimateModelHoverTipHeight({
      showDeepSeekThinking,
      paneThinkingEnabled,
      effortMenuOpen,
      showEffortControls,
      deepSeekEffortCount: DEEPSEEK_REASONING_EFFORT_OPTIONS.length,
      kimiEffortCount: KIMI_REASONING_EFFORT_OPTIONS.length,
    });
    const top = clampFixedPopoverTop(hoverRowTop, tipH);
    return {
      left,
      top,
      width: tipW,
    };
  }, [hoverBlurb, hoverRowTop, showEffortControls, showDeepSeekThinking, paneThinkingEnabled, effortMenuOpen]);

  useLayoutEffect(() => {
    const el = hoverTipRef.current;
    if (!hoverBlurb || !hoverTipStyle || !el) {
      setHoverTipLayout(null);
      return;
    }
    const height = el.getBoundingClientRect().height;
    const baseTop = typeof hoverTipStyle.top === "number" ? hoverTipStyle.top : PANE_MODEL_PICKER_MARGIN;
    const top = clampFixedPopoverTop(baseTop, height);
    const maxHeight = Math.max(
      MODEL_HOVER_TIP_EFFORT_ROW_HEIGHT,
      window.innerHeight - top - PANE_MODEL_PICKER_MARGIN,
    );
    setHoverTipLayout((prev) =>
      prev && prev.top === top && prev.maxHeight === maxHeight ? prev : { top, maxHeight },
    );
  }, [
    hoverBlurb,
    hoverTipStyle,
    effortMenuOpen,
    paneThinkingEnabled,
    hoverKey,
    showEffortControls,
    showDeepSeekThinking,
  ]);

  return (
    <div className="relative min-w-0 max-w-full" ref={anchorRef}>
      <button
        type="button"
        className={`group flex h-8 min-h-8 max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 text-[13px] font-medium leading-5 transition-colors focus:outline-none focus-visible:bg-surface-hover ${
          open ? "bg-surface-hover" : "hover:bg-surface-hover"
        }`}
        onClick={() => setOpen((v) => !v)}
        title={currentLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <ProviderGlyph provider={currentProvider} model={currentModel} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
          <span className="min-w-0 truncate text-text-strong">
            {currentParts?.modelName ?? currentLabel}
          </span>
          {currentParts && ambiguousModelNames.has(currentParts.modelName) ? (
            <span className="shrink-0 truncate text-[11px] font-normal text-text-muted">{currentParts.providerLabel}</span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-fast ease-out ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              className="agx-menu-pop fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl backdrop-blur-xl"
              style={{
                ...panelStyle,
                display: "flex",
                flexDirection: "column",
              }}
              role="listbox"
              onMouseEnter={cancelClearHover}
              onMouseLeave={scheduleClearHover}
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {options.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[12px] leading-relaxed text-text-muted">
                    还没有可用模型
                    <span className="mt-1 block text-[11px] text-text-subtle">请先在设置中配置服务商</span>
                  </div>
                ) : !selectedProviderGroup ? (
                  <>
                    <div className="px-2.5 pb-1.5 pt-1 text-[11px] text-text-faint">
                      先选择模型提供商
                    </div>
                    {groups.map((group) => {
                      const isCurrentProvider = group.items.some(
                        (item) => item.provider === currentProvider && item.model === currentModel,
                      );
                      return (
                        <button
                          key={group.key}
                          type="button"
                          className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                            isCurrentProvider
                              ? "bg-surface-cardStrong"
                              : "hover:bg-surface-hover"
                          }`}
                          onClick={() => {
                            setSelectedProviderId(group.key);
                            setHoverKey(null);
                            setEffortMenuOpen(false);
                          }}
                        >
                          <ProviderGlyph
                            provider={group.visualProvider}
                            model={group.items[0]?.model ?? ""}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-strong">
                            {group.providerLabel}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
                            {group.items.length} 个模型
                          </span>
                          <span className="text-[14px] text-text-faint" aria-hidden>›</span>
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {selectedProviderId ? (
                      <button
                        type="button"
                        className="mb-1 flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-strong"
                        onClick={() => {
                          setSelectedProviderId(null);
                          setHoverKey(null);
                          setEffortMenuOpen(false);
                        }}
                      >
                        <span aria-hidden>‹</span>
                        <span>全部提供商</span>
                      </button>
                    ) : null}
                    <div className="px-2.5 pb-1 text-[11px] font-medium text-text-faint">
                      {selectedProviderId
                        ? `${selectedProviderGroup.providerLabel} · 选择模型`
                        : "选择模型"}
                    </div>
                    {selectedProviderGroup.items.length === 0 ? (
                      <div className="px-2.5 py-2 text-[12px] text-text-faint">
                        暂无可见模型，请在设置中添加
                      </div>
                    ) : (
                      selectedProviderGroup.items.map((opt) => {
                        const rowKey = `${opt.provider}:${opt.model}`;
                        const isActive =
                          opt.provider === currentProvider && opt.model === currentModel;
                        const isHover = hoverKey === rowKey;
                        const { modelName } = formatModelDisplayParts(
                          opt.provider,
                          opt.model,
                          settings.providers[opt.provider],
                        );
                        return (
                          <button
                            key={rowKey}
                            ref={isActive ? activeModelRowRef : undefined}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-2.5 text-left text-[13px] leading-5 transition-colors ${
                              isActive || isHover
                                ? "bg-surface-cardStrong"
                                : "hover:bg-surface-hover"
                            }`}
                            onMouseEnter={(e) => {
                              cancelClearHover();
                              setHoverKey(rowKey);
                              setEffortMenuOpen(false);
                              setHoverRowTop(e.currentTarget.getBoundingClientRect().top);
                            }}
                            onClick={() => handleSelect(opt.provider, opt.model)}
                          >
                            <ProviderGlyph
                              provider={selectedProviderGroup.visualProvider}
                              model={opt.model}
                            />
                            <span className="min-w-0 flex-1 whitespace-normal break-all font-semibold leading-5 text-text-strong">
                              {modelName}
                            </span>
                            <span className="flex w-3.5 shrink-0 justify-end">
                              {isActive ? (
                                <Check
                                  className="h-3.5 w-3.5 text-status-success"
                                  strokeWidth={2.5}
                                />
                              ) : null}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </>
                )}
              </div>
              <div className="shrink-0 border-t border-border p-1.5">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface-cardStrong px-2.5 py-2 text-[12.5px] font-medium text-text-strong transition-colors hover:bg-surface-hover"
                  onMouseEnter={() => setHoverKey(null)}
                  onClick={() => {
                    setOpen(false);
                    useAppStore.getState().openSettings("account");
                  }}
                >
                  <SquarePen className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
                  企业账号与模型
                </button>
              </div>
            </div>
            {hoverBlurb && hoverTipStyle ? (
              <div
                ref={hoverTipRef}
                className={`agx-menu-pop fixed z-[9999] overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-surface-panel px-3.5 py-3 shadow-2xl backdrop-blur-xl ${
                  showEffortControls || showDeepSeekThinking
                    ? "pointer-events-auto"
                    : "pointer-events-none"
                }`}
                style={{
                  ...hoverTipStyle,
                  ...(hoverTipLayout
                    ? { top: hoverTipLayout.top, maxHeight: hoverTipLayout.maxHeight }
                    : null),
                }}
                role="tooltip"
                onMouseEnter={cancelClearHover}
                onMouseLeave={scheduleClearHover}
              >
                <div className="truncate text-[13px] font-semibold leading-snug text-text-strong">
                  {hoverBlurb.title}
                </div>
                <div className="mt-1 text-[12px] leading-relaxed text-text-muted">
                  {hoverBlurb.description}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5 text-[11px]">
                  <span className="text-text-muted">{hoverBlurb.metaLabel}</span>
                  <span className="truncate font-medium text-text-strong">{hoverBlurb.metaValue}</span>
                </div>
                {showDeepSeekThinking ? (
                  <div className="relative mt-2 border-t border-border pt-2">
                    <div className="flex w-full items-center justify-between gap-3 text-[11px]">
                      <span className="text-text-muted">思考模式</span>
                      <SettingsSwitch
                        checked={paneThinkingEnabled}
                        size="sm"
                        aria-label="思考模式"
                        onChange={(next) => {
                          setPaneThinkingEnabled(paneId, next);
                          if (!next) setEffortMenuOpen(false);
                        }}
                      />
                    </div>
                    {paneThinkingEnabled ? (
                      <>
                        <button
                          type="button"
                          className="mt-2 flex w-full items-center justify-between gap-3 text-[11px] transition-colors hover:text-text-strong"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEffortMenuOpen((v) => !v);
                          }}
                        >
                          <span className="text-text-muted">思考强度</span>
                          <span className="inline-flex items-center gap-0.5 font-medium text-text-strong">
                            {labelForDeepSeekReasoningEffort(paneDeepSeekEffort)}
                            <ChevronRight
                              className={`h-3 w-3 text-text-muted transition-transform ${
                                effortMenuOpen ? "rotate-90" : ""
                              }`}
                              strokeWidth={2}
                              aria-hidden
                            />
                          </span>
                        </button>
                        {effortMenuOpen ? (
                          <div className="mt-1.5 overflow-hidden rounded-lg border border-border bg-surface-cardStrong p-0.5">
                            {DEEPSEEK_REASONING_EFFORT_OPTIONS.map((opt) => {
                              const active = paneDeepSeekEffort === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                                    active
                                      ? "bg-surface-hover font-medium text-text-strong"
                                      : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = opt.value as DeepSeekReasoningEffort;
                                    setPaneReasoningEffort(paneId, next);
                                    setEffortMenuOpen(false);
                                  }}
                                >
                                  <span>{opt.label}</span>
                                  {active ? (
                                    <Check className="h-3 w-3 text-status-success" strokeWidth={2.5} />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : showEffortControls ? (
                  <div className="relative mt-2 border-t border-border pt-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 text-[11px] transition-colors hover:text-text-strong"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEffortMenuOpen((v) => !v);
                      }}
                    >
                      <span className="text-text-muted">思考强度</span>
                      <span className="inline-flex items-center gap-0.5 font-medium text-text-strong">
                        {labelForKimiReasoningEffort(paneReasoningEffort)}
                        <ChevronRight
                          className={`h-3 w-3 text-text-muted transition-transform ${
                            effortMenuOpen ? "rotate-90" : ""
                          }`}
                          strokeWidth={2}
                          aria-hidden
                        />
                      </span>
                    </button>
                    {effortMenuOpen ? (
                      <div className="mt-1.5 overflow-hidden rounded-lg border border-border bg-surface-cardStrong p-0.5">
                        {KIMI_REASONING_EFFORT_OPTIONS.map((opt) => {
                          const active = paneReasoningEffort === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                                active
                                  ? "bg-surface-hover font-medium text-text-strong"
                                  : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = opt.value as KimiReasoningEffort;
                                setPaneReasoningEffort(paneId, next);
                                setEffortMenuOpen(false);
                              }}
                            >
                              <span>{opt.label}</span>
                              {active ? (
                                <Check className="h-3 w-3 text-status-success" strokeWidth={2.5} />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
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
  /** True when rendered as a row inside「更多操作」vertical menu (full-width row + right flyout). */
  embedded = false,
}: {
  apiToken: string;
  apiBase: string;
  sessionId: string;
  paneId: string;
  globalDefaultMode: KbRetrievalMode;
  onNewSessionDefaultChange?: (mode: KbRetrievalMode) => void;
  embedded?: boolean;
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
  const [menuPos, setMenuPos] = useState<
    { left: number; top?: number; bottom?: number; maxHeight?: number } | null
  >(null);
  const rootRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  const openMenu = useCallback((flyoutRight = false) => {
    if (rootRef.current) {
      if (flyoutRight) {
        setMenuPos(positionEmbeddedComposerFlyout(rootRef.current, KB_MODE_SUBMENU_WIDTH));
      } else {
        const rect = rootRef.current.getBoundingClientRect();
        setMenuPos({
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
        });
      }
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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

  const activeLabel =
    KB_RETRIEVAL_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? "智能检索";

  // Portal to document.body — composer toolbar has overflow-hidden and would clip
  // an absolute dropdown.
  const panel =
    open && menuPos
      ? createPortal(
          <div
            id="agx-kb-retrieval-mode-menu"
            ref={menuRef}
            style={{
              left: menuPos.left,
              ...(menuPos.top != null
                ? { top: menuPos.top, maxHeight: menuPos.maxHeight }
                : { bottom: menuPos.bottom }),
            }}
            className="fixed z-[9999] w-[200px] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
            role="listbox"
            aria-label="知识库检索模式"
          >
            {KB_RETRIEVAL_MODE_OPTIONS.map((opt) => {
              const isActive = mode === opt.value;
              const Icon = opt.value === "auto" ? Sparkles : Radar;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={saving}
                  className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                  } ${opt.value === "always" ? "mt-0.5" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    void saveMode(opt.value);
                  }}
                >
                  <Icon
                    className={`h-[15px] w-[15px] shrink-0 ${
                      isActive ? "text-text-strong" : "text-text-muted group-hover:text-text-standard"
                    }`}
                    strokeWidth={2}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={`text-[13px] font-medium leading-none ${
                        isActive ? "text-text-strong" : "text-text-standard"
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span className="text-[11px] leading-none text-text-faint">{opt.hint}</span>
                  </span>
                  <span className="flex w-4 shrink-0 justify-end">
                    {isActive ? (
                      <Check className="h-3.5 w-3.5 text-text-strong" strokeWidth={2.5} />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  if (embedded) {
    return (
      <>
        <button
          ref={rootRef as unknown as RefObject<HTMLButtonElement>}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-standard transition-colors hover:bg-surface-hover"
          disabled={saving}
          aria-label="知识库检索"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openMenu(true))}
        >
          {mode === "auto" ? (
            <Sparkles className="h-[15px] w-[15px] shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
          ) : (
            <Radar className="h-[15px] w-[15px] shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
          )}
          <span className="flex-1">知识库检索</span>
          <span className="text-[11px] text-text-faint">{activeLabel}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
        </button>
        {panel}
      </>
    );
  }

  return (
    <>
      <div ref={rootRef as unknown as RefObject<HTMLDivElement>} className="relative">
        <HoverTip label={`知识库检索模式：${activeLabel}`}>
          <button
            type="button"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition hover:bg-surface-hover hover:text-text-strong ${
              open ? "bg-surface-hover text-text-strong" : "text-text-muted"
            }`}
            disabled={saving}
            aria-label="知识库检索模式"
            aria-expanded={open}
            onClick={() => (open ? setOpen(false) : openMenu())}
          >
            {mode === "auto" ? (
              <Sparkles className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
            ) : (
              <Radar className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
            )}
          </button>
        </HoverTip>
      </div>
      {panel}
    </>
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
  } else if (!VOICE_UI_ENABLED) {
    // 语音入口隐藏时仍保留发送键，避免输入区右侧失去主要操作。
    onClick = onSend;
    title = "发送";
    icon = <SendIcon />;
    filled = false;
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
      disabled={!VOICE_UI_ENABLED && !hasInput && !streaming}
      aria-label={title}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

function composerFileExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "FILE";
  return name.slice(idx + 1).toUpperCase();
}

function composerFileIconKind(name: string, mimeType: string): "spreadsheet" | "document" | "code" | "image" | "generic" {
  const lower = name.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/.test(lower)) return "image";
  if (/\.(xls|xlsx|csv|tsv|ods)$/.test(lower) || mime.includes("spreadsheet") || mime === "text/csv") {
    return "spreadsheet";
  }
  if (/\.(pdf|doc|docx|ppt|pptx|pages|rtf|odt|txt|md)$/.test(lower)) return "document";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|cs|rb|php|sh|json|yaml|yml|toml|xml|html|css|sql)$/.test(lower)) {
    return "code";
  }
  return "generic";
}

function composerIconPalette(kind: ReturnType<typeof composerFileIconKind>): { bg: string; fg: string } {
  switch (kind) {
    case "spreadsheet":
      return { bg: "rgba(34, 197, 94, 0.16)", fg: "rgb(22, 163, 74)" };
    case "document":
      return { bg: "rgba(59, 130, 246, 0.14)", fg: "rgb(37, 99, 235)" };
    case "code":
      return { bg: "rgba(168, 85, 247, 0.14)", fg: "rgb(147, 51, 234)" };
    case "image":
      return { bg: "rgba(236, 72, 153, 0.12)", fg: "rgb(219, 39, 119)" };
    default:
      return { bg: "var(--surface-hover)", fg: "var(--text-faint)" };
  }
}

function ComposerFileGlyph({ kind }: { kind: ReturnType<typeof composerFileIconKind> }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    className: "h-[18px] w-[18px]",
  } as const;
  if (kind === "spreadsheet") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-13z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.5h16M4 14.5h16M9.5 4v16" />
      </svg>
    );
  }
  if (kind === "document") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.5h6.5L19 9v11.5A1.5 1.5 0 0117.5 22h-10A1.5 1.5 0 016 20.5v-15A1.5 1.5 0 017.5 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5V9H19M9 13h6M9 17h4" />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 3.5h5.5L18 8v12.5A1.5 1.5 0 0116.5 22h-8A1.5 1.5 0 017 20.5v-15A1.5 1.5 0 018.5 4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5V8H18" />
    </svg>
  );
}

/** Trae Work–style composer attachment chip (matches sent-message AttachmentCard). */
function AttachmentChip({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  const isImage = !!file.dataUrl && file.mimeType.startsWith("image/");
  const isReferenceToken = !!file.referenceToken;
  const pathHint =
    isReferenceToken && file.sourcePath ? formatReferencePathHint(file.sourcePath) : "";
  const ext = composerFileExt(file.name);
  const kind = composerFileIconKind(file.name, file.mimeType);
  const palette = composerIconPalette(kind);
  const secondary = isReferenceToken
    ? pathHint
      ? `@ ${pathHint}`
      : "@ 文件引用"
    : file.status === "parsing"
      ? "解析中..."
      : file.status === "error"
        ? file.errorText || "解析失败"
        : ext;

  return (
    <div
      className={`group relative inline-flex min-w-[148px] max-w-[200px] items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors ${
        isReferenceToken
          ? "border border-sky-500/40 bg-sky-500/10"
          : "bg-surface-panel hover:bg-surface-hover/80"
      }`}
      title={file.sourcePath ? resolveReferenceSourcePath(file.name, file.sourcePath) : file.name}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">
        {isImage && file.dataUrl ? (
          <img src={file.dataUrl} alt={file.name} className="h-full w-full object-cover" />
        ) : isReferenceToken ? (
          <div className="flex h-full w-full items-center justify-center bg-sky-500/20 text-sky-400">
            <span className="text-base leading-none">↘</span>
          </div>
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: palette.bg, color: palette.fg }}
          >
            <ComposerFileGlyph kind={kind} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 pr-4">
        <div
          className={`truncate text-[13px] font-medium leading-tight ${
            isReferenceToken ? "text-sky-100" : "text-text-strong"
          }`}
        >
          {file.name}
        </div>
        <div
          className={`mt-0.5 truncate text-[11px] tracking-wide ${
            isReferenceToken
              ? "text-sky-200/80"
              : file.status === "parsing"
                ? "animate-pulse text-text-faint normal-case"
                : file.status === "error"
                  ? "text-status-error normal-case"
                  : "uppercase text-text-faint"
          }`}
        >
          {secondary}
        </div>
      </div>
      <button
        type="button"
        className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 ${
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
  integratedToolbar?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
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
  const toolName = String(toolNameRaw ?? "").trim() || "tool";
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
  if (toolName === "create_avatar") {
    try {
      const parsed = JSON.parse(resultText) as Record<string, unknown>;
      const avatarName = String(parsed.name ?? "").trim();
      const avatarId = String(parsed.avatar_id ?? "").trim();
      if (parsed.ok) {
        return {
          content: `✅ 数字分身「${avatarName || "未命名"}」已创建并加入分身列表${avatarId ? `\nID: ${avatarId}` : ""}`,
          silent: false,
        };
      }
      if (String(parsed.error ?? "") === "avatar_exists") {
        return {
          content: `⚠️ 分身「${avatarName || "同名"}」已存在${avatarId ? `（id=${avatarId}）` : ""}，可直接委派或打开`,
          silent: false,
        };
      }
      const message = String(parsed.message ?? parsed.error ?? "").trim();
      if (message) {
        return { content: `⚠️ 创建分身失败：${message}`, silent: false };
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
  if (!compact.trim()) {
    return { content: "", silent: true };
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
/** Chat column floor while dragging the workbench wider (Trae-like: prefer a large canvas). */
const CHAT_COLUMN_MIN_WIDTH = 240;
/** Workbench may grow up to this share of the pane; chat keeps CHAT_COLUMN_MIN_WIDTH. */
const TASKSPACE_MAX_WIDTH_RATIO = 0.62;
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
  htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
};

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Office/PDF documents the frontend cannot parse inline; backend skills (liteparse/docx) handle them via absolute path. */
function isReferenceableDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".pdf"].some((ext) => lower.endsWith(ext));
}

/** Match composer attachment to parsed contextFiles row for /api/chat context_files body. */
function resolveReadyAttachment(
  file: MessageAttachment,
  readyTuples: [string, AttachedFile][]
): AttachedFile | undefined {
  // Prefer exact resource key (`abs:el-snippet-…`) — multiple HTML element chips share one sourcePath.
  const wantKey = buildContextFileKeyFromAttachment(file);
  if (wantKey) {
    for (const [stateKey, rec] of readyTuples) {
      if (stateKey === wantKey) return rec;
      if (buildContextFileKeyFromAttachment(rec) === wantKey) return rec;
    }
  }
  const wantSnippet = String(file.snippetRef || "").trim();
  if (wantSnippet) {
    for (const [, rec] of readyTuples) {
      if (String(rec.snippetRef || "").trim() === wantSnippet) return rec;
    }
  }
  const byAlias = new Map<string, AttachedFile>();
  for (const [stateKey, rec] of readyTuples) {
    byAlias.set(stateKey, rec);
    const nm = String(rec.name || "").trim();
    if (nm) byAlias.set(nm, rec);
    // Only index bare sourcePath when the row is NOT a snippet/line-range slice.
    const sp = String(rec.sourcePath || "").trim();
    if (sp && !rec.snippetRef && !rec.lineRange) byAlias.set(sp, rec);
  }
  const keys = [file.name, file.sourcePath].map((k) => String(k || "").trim()).filter(Boolean);
  for (const k of keys) {
    const hit = byAlias.get(k);
    if (hit) return hit;
  }
  for (const [, rec] of readyTuples) {
    if (file.name && rec.name === file.name && file.size === rec.size) return rec;
  }
  for (const [, rec] of readyTuples) {
    if (file.name && rec.name === file.name) return rec;
  }
  return undefined;
}

type AtCandidate = AtMentionCandidate;

export function ChatPane({
  paneId,
  focused,
  onFocus,
  onOpenConfirm,
  onOpenClarification,
  onSubmitClarification,
  integratedToolbar = false,
  sidebarCollapsed = false,
  onToggleSidebar,
}: Props) {
  const pane = useAppStore((s) => s.panes.find((item) => item.id === paneId) ?? FALLBACK_PANE);
  const preloadedComposerTaskspaces = useAppStore((s) => {
    const sid = String(pane.sessionId || "").trim();
    return sid ? s.preloadedTaskspacesBySessionId[sid] ?? EMPTY_TASKSPACES : EMPTY_TASKSPACES;
  });
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
  const cycleSidePanel = useAppStore((s) => s.cycleSidePanel);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const openSidePanel = useAppStore((s) => s.openSidePanel);
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
  const setPaneHistoryJumpMessageId = useAppStore((s) => s.setPaneHistoryJumpMessageId);
  const setPanePendingQuote = useAppStore((s) => s.setPanePendingQuote);
  const setPaneHistorySearchTerms = useAppStore((s) => s.setPaneHistorySearchTerms);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneContextInherited = useAppStore((s) => s.setPaneContextInherited);
  const confirmStrategy = useAppStore((s) => s.confirmStrategy);
  const setConfirmStrategy = useAppStore((s) => s.setConfirmStrategy);
  const [composerTaskspaces, setComposerTaskspaces] = useState<Taskspace[]>(
    preloadedComposerTaskspaces,
  );
  const [composerWorkspaceLoading, setComposerWorkspaceLoading] = useState(false);
  const [composerWorkspaceActionBusy, setComposerWorkspaceActionBusy] = useState(false);
  const [composerWorkspaceError, setComposerWorkspaceError] = useState("");
  const [composerPermissionSaving, setComposerPermissionSaving] = useState(false);
  const [composerPermissionError, setComposerPermissionError] = useState("");
  const composerWorkspaceRequestRef = useRef(0);
  const composerWorkspaceSessionRef = useRef(String(pane.sessionId || "").trim());

  useEffect(() => {
    const nextSessionId = String(pane.sessionId || "").trim();
    const sessionChanged = composerWorkspaceSessionRef.current !== nextSessionId;
    if (sessionChanged) {
      composerWorkspaceSessionRef.current = nextSessionId;
      composerWorkspaceRequestRef.current += 1;
      setComposerWorkspaceLoading(false);
      setComposerWorkspaceActionBusy(false);
    }
    setComposerTaskspaces(preloadedComposerTaskspaces);
    setComposerWorkspaceError("");
    const activeTaskspaceId = String(
      useAppStore.getState().panes.find((item) => item.id === pane.id)?.activeTaskspaceId ?? "",
    ).trim();
    if (
      activeTaskspaceId &&
      !preloadedComposerTaskspaces.some((item) => item.id === activeTaskspaceId)
    ) {
      setActiveTaskspace(pane.id, null);
    }
  }, [pane.sessionId, preloadedComposerTaskspaces]);
  const toolRoundCount = useMemo(
    () => (pane.messages ?? []).filter((m) => m.role === "tool" && (m.toolName ?? "").trim()).length,
    [pane.messages]
  );
  /** Hide context usage until the user has actually started chatting. */
  const hasStartedChat = useMemo(
    () =>
      (pane.messages ?? []).some(
        (m) => m.role === "user" && String(m.content ?? "").trim().length > 0,
      ),
    [pane.messages],
  );
  const showNewTopicContext = shouldKeepNewTopicWorkspaceControls(
    hasStartedChat,
    pane.loadingMessages,
    composerWorkspaceLoading,
  );
  const toolRoundBudget = 60;
  const queuedMessages = useAppStore((s) => s.pendingMessages[paneId] ?? EMPTY_QUEUE);
  const enqueuePaneMessage = useAppStore((s) => s.enqueuePaneMessage);
  const takePendingMessage = useAppStore((s) => s.takePendingMessage);
  const removePendingMessage = useAppStore((s) => s.removePendingMessage);
  const editPendingMessage = useAppStore((s) => s.editPendingMessage);
  const setSpawnsColumnOpen = useAppStore((s) => s.setSpawnsColumnOpen);
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
    if (!LOCAL_KNOWLEDGE_ENABLED) return;
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
  const showToolCalls = useAppStore((s) => s.showToolCalls);
  const userNickname = useAppStore((s) => s.userNickname);
  const userPreference = useAppStore((s) => s.userPreference);
  const attachmentRoutingPolicy =
    useAppStore((s) => s.userAccount.attachmentRouting) ?? ATTACHMENT_ROUTING_OFF;
  const attachmentRoutingLock = useAppStore((s) => s.attachmentRoutingLock);
  const setAttachmentRoutingLock = useAppStore((s) => s.setAttachmentRoutingLock);
  /** 本会话第一次被锁定时弹一次说明；勾了「不再显示」之后就不再弹。 */
  const [routingNotice, setRoutingNotice] = useState<RoutingModelRef | null>(null);
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
    if (aid.startsWith("group:")) {
      return { name: activeGroup?.name || pane?.avatarName || "群聊", url: undefined };
    }
    const found = avatars.find((a) => a.id === aid);
    return {
      name: found?.name || pane?.avatarName || "AI",
      url: found?.avatarUrl || undefined,
    };
  }, [activeGroup, pane?.avatarId, pane?.avatarName, avatars, metaAvatarUrl]);
  const newTopicLabel = useMemo(
    () => newTopicTriggerLabel({ displayName: paneAvatarMeta.name, isGroup: isGroupPane }),
    [isGroupPane, paneAvatarMeta.name],
  );
  const [composerHasText, setComposerHasText] = useState(false);
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
  /** Debounce timers for mid-reattach group disk merges (keyed by session id). */
  const reattachGroupMergeTimersRef = useRef<Record<string, number>>({});
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
  const [stallWait, setStallWait] = useState<StallWaitInfo | null>(null);
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
  /** sid → last auto-resumed turn_interrupted message id (truncation/timeout). */
  const truncationAutoResumeNoticeRef = useRef<Record<string, string>>({});
  /** sid → auto-resume count for truncation detectors (cap 2, no unattended needed). */
  const truncationAutoResumeCountRef = useRef<Record<string, number>>({});
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
  /** >0 while we assign scrollTop; scroll events in that window must not unpin. */
  const programmaticScrollRef = useRef(0);
  const loadingOlderMessagesRef = useRef(false);
  const sessionBootstrapRef = useRef("");
  const sessionBootstrapInflightRef = useRef("");
  const sessionBootstrapAttemptRef = useRef(0);
  const [sessionBootstrapRetryNonce, setSessionBootstrapRetryNonce] = useState(0);
  const lastUserSendDedupeRef = useRef<SendDedupeEntry | null>(null);
  const sendChatInFlightRef = useRef<{ paneId: string; sessionId: string } | null>(null);
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const imeComposingRef = useRef(false);
  const atSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAtCandidatesRef = useRef<
    (queryText: string, browseArg?: AtMentionBrowseState | null) => void | Promise<void>
  >(() => {});
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atCandidates, setAtCandidates] = useState<AtCandidate[]>([]);
  /** Non-null while the `@` picker is drilled into a directory. */
  const [atBrowse, setAtBrowse] = useState<AtMentionBrowseState | null>(null);
  const [groupTyping, setGroupTyping] = useState<Record<string, string>>({});
  /** One-line activity hint per group member (tool progress); not a chat message. */
  const [groupActivityHint, setGroupActivityHint] = useState<Record<string, string>>({});
  const groupActiveAgentIds = useMemo(
    () => Array.from(new Set([...Object.keys(groupTyping), ...Object.keys(groupActivityHint)])),
    [groupTyping, groupActivityHint],
  );
  /** 显式相位覆盖：group_blocked → "waiting"，group_error → "failed"。 */
  const [groupMemberPhase, setGroupMemberPhase] = useState<Record<string, "waiting" | "failed">>({});
  const [crewSettingsAvatarId, setCrewSettingsAvatarId] = useState<string | null>(null);
  const lastGroupProgressRef = useRef<Record<string, string>>({});
  type QuoteTarget = { id: string; message: Message; body: string };
  const [quoteTargets, setQuoteTargets] = useState<QuoteTarget[]>([]);
  const quoteTargetsRef = useRef<QuoteTarget[]>([]);
  quoteTargetsRef.current = quoteTargets;
  /** Newly added quote id — insert at caret once (not prepended to composer start). */
  const pendingCaretQuoteIdRef = useRef<string | null>(null);
  const addQuoteTarget = useCallback((message: Message, body: string) => {
    const cleanBody = String(body || "").trim();
    if (!cleanBody) return;
    setQuoteTargets((prev) => {
      if (prev.some((q) => q.message.id === message.id && q.body === cleanBody)) {
        return prev;
      }
      const id = crypto.randomUUID();
      pendingCaretQuoteIdRef.current = id;
      return [...prev, { id, message, body: cleanBody }];
    });
  }, []);
  const clearQuoteTargets = useCallback(() => {
    pendingCaretQuoteIdRef.current = null;
    quoteTargetsRef.current = [];
    setQuoteTargets([]);
  }, []);
  useEffect(() => {
    const pending = pane.pendingQuote;
    if (!pending) return;
    addQuoteTarget(
      {
        id: pending.messageId,
        role: "assistant",
        content: pending.body,
        avatarName: pending.label,
      },
      pending.body
    );
    setPanePendingQuote(pane.id, null);
  }, [pane.pendingQuote, pane.id, setPanePendingQuote, addQuoteTarget]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareImageOpen, setShareImageOpen] = useState(false);
  const shareBtnRef = useRef<HTMLButtonElement | null>(null);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingForwardMessages, setPendingForwardMessages] = useState<ForwardPendingMessage[]>([]);
  const contextFilesRef = useRef<Record<string, AttachedFile>>({});
  const [contextFiles, setContextFilesState] = useState<Record<string, AttachedFile>>({});
  const setContextFiles = useCallback(
    (
      next:
        | Record<string, AttachedFile>
        | ((previous: Record<string, AttachedFile>) => Record<string, AttachedFile>),
    ) => {
      const resolved =
        typeof next === "function" ? next(contextFilesRef.current) : next;
      contextFilesRef.current = resolved;
      setContextFilesState(resolved);
    },
    [],
  );
  const [attachToastOpen, setAttachToastOpen] = useState(false);
  const [attachToastMessage, setAttachToastMessage] = useState(VISION_UNSUPPORTED_TOAST);
  const [visionFallback, setVisionFallback] = useState<VisionFallbackInfo>({ available: false });
  const fallbackHintedRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    void getVisionFallbackInfo({ apiToken })
      .then((info) => {
        if (!cancelled) setVisionFallback(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiToken, chatProvider, chatModel]);
  const [debateNudgeText, setDebateNudgeText] = useState("");
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
  /** Last caret inside composer — survives blur when quoting from message context menu. */
  const composerSavedRangeRef = useRef<Range | null>(null);
  const composerRefPathsRef = useRef<Record<string, string>>({});
  /** Chip meta available before setContextFiles re-renders (fixes html-element → index.html flash). */
  const composerRefMetaOverrideRef = useRef<
    Record<
      string,
      {
        sourcePath?: string;
        composerRefLabel?: string;
        htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
      }
    >
  >({});
  const activeDraftIdentityRef = useRef(
    composerDraftIdentity({
      paneId: pane.id,
      avatarId: pane.avatarId,
      sessionId: pane.sessionId,
    }),
  );
  const hydratedDraftIdentityRef = useRef("");
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftHydratingRef = useRef(false);
  const composerDraftTextRef = useRef("");
  const scheduleComposerDraftSaveRef = useRef<() => void>(() => {});
  const flushComposerDraftNowRef = useRef<(identity?: string) => void>(() => {});
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
    if (!shareMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shareBtnRef.current?.contains(t) || shareMenuRef.current?.contains(t)) return;
      setShareMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShareMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [shareMenuOpen]);
  useEffect(() => {
    if (selectedMessageIds.size === 0) setShareMenuOpen(false);
  }, [selectedMessageIds.size]);
  useEffect(() => {
    ccBridgeLastSessionModeRef.current = "";
  }, [pane.sessionId]);
  // ChatPane stays mounted across history jumps; mention UI is pane-local and
  // must not ride into the next session.
  useEffect(() => {
    if (atSearchTimerRef.current != null) {
      clearTimeout(atSearchTimerRef.current);
      atSearchTimerRef.current = null;
    }
    setAtOpen(false);
    setAtQuery("");
    setAtCandidates([]);
    setAtBrowse(null);
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
  /** WorkBuddy-style in-session find bar (toolbar magnifier → highlight + N/M nav). */
  const [sessionFindOpen, setSessionFindOpen] = useState(false);
  /** One-shot focus for WorkPanel tabs (summary / workspace / terminal / browser). */
  const [workPanelFocus, setWorkPanelFocus] = useState<WorkPanelFocus>(null);
  /** Trae-style: enlarge work panel to dominate the chat pane (main content). */
  const [workPanelExpanded, setWorkPanelExpanded] = useState(false);
  const [sessionFindQuery, setSessionFindQuery] = useState("");
  const [sessionFindMatchIndex, setSessionFindMatchIndex] = useState(0);
  const [sessionFindMatchCount, setSessionFindMatchCount] = useState(0);
  const sessionFindInputRef = useRef<HTMLInputElement | null>(null);
  const sessionFindActiveIndexRef = useRef(0);
  /** 数字分身窗格顶栏：直接打开分身设置，无需再切到左侧「数字分身」画廊。 */
  const [avatarSettingsOpen, setAvatarSettingsOpen] = useState(false);
  const paneSettingsAvatar = useMemo(() => {
    if (crewSettingsAvatarId) return avatars.find((a) => a.id === crewSettingsAvatarId);
    if (!isDedicatedAvatarPane || !pane?.avatarId) return undefined;
    return avatars.find((a) => a.id === pane.avatarId);
  }, [crewSettingsAvatarId, isDedicatedAvatarPane, pane?.avatarId, avatars]);
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
  const syncJumpToBottomFab = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      setShowJumpToBottomFab(false);
      return;
    }
    const overflow = el.scrollHeight > el.clientHeight + 4;
    setShowJumpToBottomFab(overflow && !isNearBottom(el));
  }, []);

  const flushJumpToBottomFab = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      setShowJumpToBottomFab(false);
      return;
    }
    if (shouldApplyScrollPinFromEvent(programmaticScrollRef.current > 0)) {
      autoScrollPinnedRef.current = isNearBottom(el);
    }
    syncJumpToBottomFab();
  }, [syncJumpToBottomFab]);

  const scrollListToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    programmaticScrollRef.current += 1;
    el.scrollTop = el.scrollHeight;
    programmaticScrollRef.current -= 1;
  }, []);

  const pinChatListToLatestTurn = useCallback(() => {
    autoScrollPinnedRef.current = true;
    scrollListToBottom();
    setShowJumpToBottomFab(false);
  }, [scrollListToBottom]);

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

  // Cold-start: rehydrate WorkPanel「子智能体」from persisted subagent_runs after restart.
  useEffect(() => {
    const sid = (pane?.sessionId ?? "").trim();
    if (!sid || !apiBase || !apiToken) return;
    let cancelled = false;
    void hydrateSessionSubAgentsFromDisk(apiBase, apiToken, sid).then((result) => {
      if (cancelled || !result.ok) return;
    });
    return () => {
      cancelled = true;
    };
  }, [pane?.sessionId, apiBase, apiToken]);

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
    () => attachmentEntries.filter(([, file]) => file.status === "ready").map(([, file]) => ({ ...file })),
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
          // 增量合并而非整表替换：mergeSessionMessagesTail 以 sid 为 id 前缀并
          // 复用内存行 id，已有气泡的 React key 稳定，不会整列表重挂载闪烁。
          const livePane = useAppStore.getState().panes.find((p) => p.id === pane.id);
          const current = livePane?.messages ?? [];
          const merged = mergeSessionMessagesTail(
            current,
            result.messages as LoadedSessionMessage[],
            currentSid
          );
          const changed =
            merged.length !== current.length ||
            String(merged[merged.length - 1]?.content ?? "") !==
              String(current[current.length - 1]?.content ?? "");
          if (!changed) return;
          setPaneMessages(pane.id, merged);
          // 全量合并后内存已覆盖完整磁盘历史，复位分页游标，避免顶部
          // 「加载更早消息」按旧 oldestLoadedIndex 拉取与内存同 id 的行。
          if (livePane?.hasOlderMessages || (livePane?.oldestLoadedIndex ?? 0) > 0) {
            setPaneMessagePaging(pane.id, {
              oldestLoadedIndex: 0,
              hasOlderMessages: false,
              loadingOlderMessages: false,
            });
          }
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
    setPaneMessagePaging,
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
    // User scroll may unpin. Content-height resize must not unpin; if still
    // pinned, keep the latest turn in view as bubbles/stream grow.
    const onScroll = () => flushJumpToBottomFab();
    const onResize = () => {
      if (autoScrollPinnedRef.current) {
        scrollListToBottom();
      }
      syncJumpToBottomFab();
    };
    flushJumpToBottomFab();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [paneId, flushJumpToBottomFab, syncJumpToBottomFab, scrollListToBottom]);

  useLayoutEffect(() => {
    if (autoScrollPinnedRef.current) {
      scrollListToBottom();
      // Second frame: markdown/images can grow after the first commit.
      requestAnimationFrame(() => {
        if (autoScrollPinnedRef.current) {
          scrollListToBottom();
        }
        syncJumpToBottomFab();
      });
      return;
    }
    // FAB only — do not recompute pin here. Layout is often still short of the
    // true bottom when a new user bubble mounts, and that used to unpin us.
    syncJumpToBottomFab();
  }, [visibleMessages, streamedAssistantText, scrollListToBottom, syncJumpToBottomFab]);

  const highlightJumpKeyRef = useRef<string>("");
  useEffect(() => {
    // In-session find bar owns scroll/highlight navigation while open.
    if (sessionFindOpen) return;
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
  }, [pane.sessionId, pane.historySearchTerms, visibleMessages.length, sessionFindOpen]);

  const closeSessionFind = useCallback(() => {
    const hadQuery = sessionFindQuery.trim().length > 0;
    setSessionFindOpen(false);
    setSessionFindQuery("");
    setSessionFindMatchIndex(0);
    setSessionFindMatchCount(0);
    sessionFindActiveIndexRef.current = 0;
    clearSessionFindHighlights();
    // Only clear highlight terms if this find bar had driven them (preserve global-search jump).
    if (hadQuery) setPaneHistorySearchTerms(paneId, []);
  }, [paneId, sessionFindQuery, setPaneHistorySearchTerms]);

  const openSessionFind = useCallback(() => {
    setSessionFindOpen(true);
    window.setTimeout(() => sessionFindInputRef.current?.focus(), 40);
  }, []);

  const stepSessionFindMatch = useCallback(
    (delta: number) => {
      if (sessionFindMatchCount <= 0) return;
      const next =
        (sessionFindMatchIndex + delta + sessionFindMatchCount) % sessionFindMatchCount;
      sessionFindActiveIndexRef.current = next;
      setSessionFindMatchIndex(next);
      const applied = applySessionFindHighlights(
        listRef.current,
        sessionFindQuery,
        next
      );
      if (applied.count !== sessionFindMatchCount) {
        setSessionFindMatchCount(applied.count);
        setSessionFindMatchIndex(applied.activeIndex);
        sessionFindActiveIndexRef.current = applied.activeIndex;
      }
    },
    [sessionFindMatchCount, sessionFindMatchIndex, sessionFindQuery]
  );

  // Apply mint highlights + expand matching tool cards when the find query changes.
  useEffect(() => {
    if (!sessionFindOpen) {
      clearSessionFindHighlights();
      return;
    }
    const q = sessionFindQuery.trim();
    if (!q) {
      clearSessionFindHighlights();
      setSessionFindMatchCount(0);
      setSessionFindMatchIndex(0);
      sessionFindActiveIndexRef.current = 0;
      return;
    }
    setPaneHistorySearchTerms(paneId, [q]);
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const applied = applySessionFindHighlights(
        listRef.current,
        q,
        sessionFindActiveIndexRef.current
      );
      setSessionFindMatchCount(applied.count);
      setSessionFindMatchIndex(applied.activeIndex);
      sessionFindActiveIndexRef.current = applied.activeIndex;
    };
    // Wait a frame so tool cards can expand (historySearchTerms) before ranging text.
    const t = window.setTimeout(() => requestAnimationFrame(run), 40);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [
    sessionFindOpen,
    sessionFindQuery,
    visibleMessages.length,
    streamedAssistantText,
    paneId,
    setPaneHistorySearchTerms,
  ]);

  // ⌘F / Ctrl+F opens in-session find when this pane is active; Esc closes the bar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isFindChord =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f";
      if (isFindChord) {
        const activePaneId = useAppStore.getState().activePaneId;
        if (activePaneId !== paneId) return;
        const target = event.target as HTMLElement | null;
        // Allow native find inside true text fields outside the chat pane.
        if (
          target &&
          !paneRef.current?.contains(target) &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        if (sessionFindOpen) {
          sessionFindInputRef.current?.focus();
          sessionFindInputRef.current?.select();
        } else {
          openSessionFind();
        }
        return;
      }
      if (event.key === "Escape" && sessionFindOpen) {
        const activePaneId = useAppStore.getState().activePaneId;
        if (activePaneId !== paneId) return;
        event.preventDefault();
        closeSessionFind();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paneId, sessionFindOpen, openSessionFind, closeSessionFind]);

  useEffect(() => {
    return () => {
      clearSessionFindHighlights();
    };
  }, []);

  /** Scroll + flash when history panel jumps to a user query in this session. */
  const historyJumpInFlightRef = useRef<string>("");
  useEffect(() => {
    const targetId = String(pane.historyJumpMessageId ?? "").trim();
    if (!targetId || !pane.sessionId) {
      historyJumpInFlightRef.current = "";
      return;
    }
    const jumpKey = `${pane.sessionId}::${targetId}`;
    if (historyJumpInFlightRef.current === jumpKey) return;
    historyJumpInFlightRef.current = jumpKey;
    let cancelled = false;

    const flashAndClear = (el: HTMLElement) => {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      // Keep unpinned so the follow-up stream/auto-scroll effect does not yank us back.
      autoScrollPinnedRef.current = false;
      el.classList.remove("agx-message-jump-flash");
      // Force reflow so re-triggering the same class still animates.
      void el.offsetWidth;
      el.classList.add("agx-message-jump-flash");
      window.setTimeout(() => {
        el.classList.remove("agx-message-jump-flash");
      }, 1300);
      setPaneHistoryJumpMessageId(paneId, null);
      // Allow jumping to the same message id again later.
      historyJumpInFlightRef.current = "";
      window.setTimeout(() => {
        autoScrollPinnedRef.current = false;
        flushJumpToBottomFab();
        autoScrollPinnedRef.current = false;
      }, 350);
    };

    const ensureLoadedThenScroll = async () => {
      const findEl = () =>
        listRef.current?.querySelector(
          `[data-message-id="${CSS.escape(targetId)}"]`
        ) as HTMLElement | null;

      let el = findEl();
      if (!el && pane.hasOlderMessages) {
        try {
          const full = await window.agenticxDesktop.loadSessionMessages(pane.sessionId);
          if (cancelled) return;
          if (full.ok && Array.isArray(full.messages)) {
            const sid = pane.sessionId;
            const mapped = full.messages.map((item, index) =>
              mapLoadedSessionMessage(item as LoadedSessionMessage, sid, index, sid)
            );
            setPaneMessages(paneId, mapped);
            setPaneMessagePaging(paneId, {
              oldestLoadedIndex: 0,
              hasOlderMessages: false,
              loadingOlderMessages: false,
            });
          }
        } catch {
          /* fall through to retry DOM query */
        }
      }

      const run = (attempt = 0) => {
        if (cancelled) return;
        el = findEl();
        if (el) {
          flashAndClear(el);
          return;
        }
        if (attempt < 8) {
          window.setTimeout(() => run(attempt + 1), 60);
          return;
        }
        setPaneHistoryJumpMessageId(paneId, null);
      };
      requestAnimationFrame(() => {
        window.setTimeout(() => run(0), 20);
      });
    };

    void ensureLoadedThenScroll();
    return () => {
      cancelled = true;
    };
  }, [
    pane.historyJumpMessageId,
    pane.sessionId,
    pane.hasOlderMessages,
    paneId,
    setPaneHistoryJumpMessageId,
    setPaneMessages,
    setPaneMessagePaging,
    flushJumpToBottomFab,
  ]);

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

  const refreshComposerTaskspaces = async (): Promise<Taskspace[] | null> => {
    const apiSessionId = String(
      useAppStore.getState().panes.find((item) => item.id === pane.id)?.sessionId ?? "",
    ).trim();
    const requestId = ++composerWorkspaceRequestRef.current;
    if (!apiSessionId) {
      setComposerTaskspaces([]);
      setComposerWorkspaceLoading(false);
      setComposerWorkspaceError("");
      return null;
    }
    setComposerWorkspaceLoading(true);
    setComposerWorkspaceError("");
    try {
      const result = await window.agenticxDesktop.listTaskspaces(apiSessionId);
      const currentSessionId = String(
        useAppStore.getState().panes.find((item) => item.id === pane.id)?.sessionId ?? "",
      ).trim();
      if (
        requestId !== composerWorkspaceRequestRef.current ||
        currentSessionId !== apiSessionId
      ) {
        return null;
      }
      if (!result.ok || !Array.isArray(result.workspaces)) {
        setComposerWorkspaceError(result.error ?? "工作区读取失败");
        return null;
      }
      const next = result.workspaces as Taskspace[];
      setComposerTaskspaces(next);
      const currentId = String(
        useAppStore.getState().panes.find((item) => item.id === pane.id)?.activeTaskspaceId ?? "",
      ).trim();
      if (next.length === 0) {
        if (currentId) setActiveTaskspace(pane.id, null);
        return next;
      }
      if (currentId && !next.some((item) => item.id === currentId)) {
        setActiveTaskspace(pane.id, null);
      }
      return next;
    } catch (error) {
      const currentSessionId = String(
        useAppStore.getState().panes.find((item) => item.id === pane.id)?.sessionId ?? "",
      ).trim();
      if (
        requestId === composerWorkspaceRequestRef.current &&
        currentSessionId === apiSessionId
      ) {
        setComposerWorkspaceError(`工作区读取失败：${String(error)}`);
      }
      return null;
    } finally {
      if (requestId === composerWorkspaceRequestRef.current) {
        setComposerWorkspaceLoading(false);
      }
    }
  };

  const prepareComposerWorkspaceMenu = async (): Promise<void> => {
    let sessionId = String(
      useAppStore.getState().panes.find((item) => item.id === pane.id)?.sessionId ?? "",
    ).trim();
    if (!sessionId) {
      setComposerWorkspaceLoading(true);
      setComposerWorkspaceError("");
      sessionId = String(
        await ensureWorkspaceSessionBeforeFirstMessage("", materializeLazySession),
      ).trim();
      if (!sessionId) {
        setComposerWorkspaceLoading(false);
        setComposerWorkspaceError("会话工作区初始化失败，请检查本地服务后重试。");
        return;
      }
    }
    await refreshComposerTaskspaces();
  };

  const addComposerWorkspace = async (
    pathValue: string,
    labelValue: string,
  ): Promise<boolean> => {
    const path = pathValue.trim();
    if (!path) {
      setComposerWorkspaceError("请输入工作区目录路径");
      return false;
    }

    const currentSessionId = String(
      useAppStore.getState().panes.find((item) => item.id === pane.id)?.sessionId ?? "",
    ).trim();
    if (!currentSessionId) {
      setComposerWorkspaceActionBusy(true);
      setComposerWorkspaceError("");
    }
    const sessionId = await ensureWorkspaceSessionBeforeFirstMessage(
      currentSessionId,
      materializeLazySession,
    );
    if (!sessionId) {
      if (!currentSessionId) {
        setComposerWorkspaceActionBusy(false);
        setComposerWorkspaceError("会话初始化失败，请检查本地服务后重试。");
      }
      return false;
    }

    setComposerWorkspaceActionBusy(true);
    setComposerWorkspaceError("");
    try {
      const result = await window.agenticxDesktop.addTaskspace({
        sessionId,
        path,
        label: labelValue.trim() || undefined,
      });
      if (!result.ok) {
        setComposerWorkspaceError(formatTaskspaceAddError(result.error));
        return false;
      }

      const next = await refreshComposerTaskspaces();
      const added = result.workspace as Taskspace | undefined;
      const selected =
        (added?.id ? next?.find((item) => item.id === added.id) : undefined) ??
        next?.find((item) => item.path === path);
      if (selected) setActiveTaskspace(pane.id, selected.id);
      setTaskspaceAutoRefreshKey((value) => value + 1);
      return true;
    } catch (error) {
      setComposerWorkspaceError(`添加工作区失败：${String(error)}`);
      return false;
    } finally {
      setComposerWorkspaceActionBusy(false);
    }
  };

  const openComposerLocalFolder = async (): Promise<boolean> => {
    const picker = window.agenticxDesktop.chooseDirectory;
    if (typeof picker !== "function") {
      setComposerWorkspaceError("当前客户端不支持目录选择，请完全重启桌面端后重试。");
      return false;
    }
    setComposerWorkspaceActionBusy(true);
    setComposerWorkspaceError("");
    try {
      const picked = await picker();
      if (!picked.ok || !picked.path) {
        if (!picked.canceled) {
          setComposerWorkspaceError(picked.error ?? "目录选择失败，请重试。");
        }
        return false;
      }
      const normalized = picked.path.replace(/[\\/]+$/, "");
      const label = normalized.split(/[\\/]/).filter(Boolean).pop() ?? "";
      return await addComposerWorkspace(picked.path, label);
    } catch (error) {
      setComposerWorkspaceError(`目录选择失败：${String(error)}`);
      return false;
    } finally {
      setComposerWorkspaceActionBusy(false);
    }
  };

  const changeComposerConfirmStrategy = async (
    strategy: ConfirmStrategy,
  ): Promise<boolean> => {
    const previous = useAppStore.getState().confirmStrategy;
    if (previous === strategy) {
      setComposerPermissionError("");
      return true;
    }
    setComposerPermissionSaving(true);
    setComposerPermissionError("");
    setConfirmStrategy(strategy);
    try {
      const result = await window.agenticxDesktop.saveConfirmStrategy(strategy);
      if (!result.ok) throw new Error("保存失败");
      return true;
    } catch (error) {
      if (useAppStore.getState().confirmStrategy === strategy) {
        setConfirmStrategy(previous);
      }
      setComposerPermissionError(`权限保存失败：${String(error)}`);
      return false;
    } finally {
      setComposerPermissionSaving(false);
    }
  };

  const searchAtCandidates = async (
    queryText: string,
    browseArg?: AtMentionBrowseState | null
  ) => {
    // Callers that just changed directory pass the next state explicitly; the
    // debounced path relies on this render's closure.
    const browse = browseArg === undefined ? atBrowse : browseArg;
    const lowered = queryText.trim().toLowerCase();
    const metaLabel = metaLeaderDisplayName.trim() || META_AGENT_DISPLAY_NAME;
    const metaAtAliases = [metaLabel, META_AGENT_DISPLAY_NAME, "组长", "Machi", "machi", "meta", "meta-agent"];
    const metaMatchesQuery =
      !lowered ||
      metaAtAliases.some((alias) => alias.toLowerCase().includes(lowered)) ||
      "群聊协调者".includes(lowered) ||
      "项目经理".includes(lowered);
    const metaCandidate: AtCandidate | null =
      isGroupPane && metaMatchesQuery
        ? {
            kind: "avatar",
            avatarId: "__meta__",
            label: metaLabel,
            role: "群聊协调者",
            avatarUrl: metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL,
          }
        : null;
    const memberCandidates: AtCandidate[] = isGroupPane
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
    // Near (meta leader) first — always @-able in group chat, matching members panel.
    // Inside a directory the list is purely filesystem, so members drop out.
    const avatarCandidates: AtCandidate[] = browse
      ? []
      : metaCandidate
        ? [metaCandidate, ...memberCandidates]
        : memberCandidates;

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
    const activeId = browse
      ? browse.taskspaceId
      : pane.activeTaskspaceId && wsResp.workspaces.some((item) => item.id === pane.activeTaskspaceId)
        ? pane.activeTaskspaceId
        : wsResp.workspaces[0].id;
    if (!browse && !pane.activeTaskspaceId) setActiveTaskspace(pane.id, activeId);
    const browseRoot = browse?.path || ".";
    const rootResp = await window.agenticxDesktop.listTaskspaceFiles({
      sessionId: apiSessionId,
      taskspaceId: activeId,
      path: browseRoot,
    });
    if (!rootResp.ok || !Array.isArray(rootResp.files)) {
      setAtCandidates(avatarCandidates.slice(0, 24));
      return;
    }
    // Mounted taskspace roots stay at the top level; inside a directory the
    // breadcrumb owns the location instead.
    const mountRows: Extract<AtCandidate, { kind: "taskspace" }>[] = browse
      ? []
      : wsResp.workspaces.map((item) => ({
          kind: "taskspace",
          taskspaceId: item.id,
          path: item.path,
          label: item.label || item.path.split("/").filter(Boolean).pop() || "taskspace",
          alias: item.label || item.path.split("/").filter(Boolean).pop() || "taskspace",
        }));

    if (!lowered) {
      // No query: list exactly one level so deep trees stay browsable instead of
      // being flattened into a dump the user has to scroll.
      const dirRows: Extract<AtCandidate, { kind: "dir" }>[] = [];
      const fileRows: Extract<AtCandidate, { kind: "file" }>[] = [];
      for (const row of rootResp.files) {
        if (row.type === "dir") {
          dirRows.push({ kind: "dir", taskspaceId: activeId, path: row.path, label: row.name });
        } else if (row.type === "file") {
          fileRows.push({ kind: "file", taskspaceId: activeId, path: row.path, label: row.name });
        }
      }
      setAtCandidates(
        [...avatarCandidates, ...mountRows, ...dirRows.slice(0, 40), ...fileRows.slice(0, 40)].slice(
          0,
          80
        )
      );
      return;
    }

    // With a query, scan recursively under the current location.
    const flatRows: Extract<AtCandidate, { kind: "file" }>[] = [];
    const nestedDirRows: Extract<AtCandidate, { kind: "dir" }>[] = [];
    const queue: string[] = [browseRoot];
    const visited = new Set<string>();
    while (queue.length > 0 && flatRows.length < 200) {
      const current = queue.shift() || browseRoot;
      if (visited.has(current)) continue;
      visited.add(current);
      const listResp =
        current === browseRoot
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
        if (row.type === "dir") {
          nestedDirRows.push({ kind: "dir", taskspaceId: activeId, path: row.path, label: row.name });
          if (!visited.has(row.path) && queue.length < 200) queue.push(row.path);
        }
      }
    }
    const filteredFiles = flatRows
      .filter((item) => item.path.toLowerCase().includes(lowered))
      .slice(0, 20);
    const filteredFolders = [
      ...mountRows.filter(
        (item) =>
          item.alias.toLowerCase().includes(lowered) || item.path.toLowerCase().includes(lowered)
      ),
      ...nestedDirRows.filter((item) => item.path.toLowerCase().includes(lowered)),
    ].slice(0, 8);
    setAtCandidates([...avatarCandidates, ...filteredFolders, ...filteredFiles].slice(0, 28));
  };
  searchAtCandidatesRef.current = searchAtCandidates;

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

  const updateAtStateFromText = useCallback((value: string, caretOffset?: number) => {
    const next = nextComposerAtMentionState(value, caretOffset);
    setAtOpen((prev) => (prev === next.open ? prev : next.open));
    setAtQuery((prev) => (prev === next.query ? prev : next.query));
    // Losing the `@` token ends the browse session, so the next `@` starts at the top.
    if (!next.open) setAtBrowse((prev) => (prev === null ? prev : null));
    if (next.shouldSearch) {
      if (atSearchTimerRef.current != null) clearTimeout(atSearchTimerRef.current);
      atSearchTimerRef.current = setTimeout(() => {
        atSearchTimerRef.current = null;
        void searchAtCandidatesRef.current(next.query);
      }, AT_MENTION_SEARCH_DEBOUNCE_MS);
      return;
    }
    if (atSearchTimerRef.current != null) {
      clearTimeout(atSearchTimerRef.current);
      atSearchTimerRef.current = null;
    }
  }, []);

  const syncComposerFromValue = useCallback(
    (value: string, caretOffset?: number) => {
      setComposerHasText((prev) => {
        const next = isComposerNonEmpty(value);
        return prev === next ? prev : next;
      });
      updateAtStateFromText(value, caretOffset);
    },
    [updateAtStateFromText]
  );

  const serializeComposerRoot = useCallback((root: HTMLElement): string => {
    // Keep visual token text clean (without "@"), but serialize it as "@name" for routing.
    const tokenNodes = root.querySelectorAll<HTMLElement>("[data-ref-token='1']");
    for (const node of tokenNodes) {
      const name = String(node.dataset.refName || node.textContent || "").trim();
      node.textContent = name ? `@${name}` : "";
    }
    // Serialize skill tokens as "@skill://name"
    const skillNodes = root.querySelectorAll<HTMLElement>("[data-skill-token='1']");
    for (const node of skillNodes) {
      const name = String(node.dataset.skillName || "").trim();
      node.textContent = name ? `@skill://${name}` : "";
    }
    // Keep quote chips as positional placeholders so setComposerText / @file round-trips
    // do not yank them back to the start of the composer.
    root.querySelectorAll<HTMLElement>("[data-quote-token='1']").forEach((node) => {
      const id = String(node.getAttribute("data-quote-id") || "").trim();
      node.textContent = id ? composerQuotePlaceholder(id) : "";
    });
    return (root.innerText || "").replace(/\u00a0/g, " ");
  }, []);

  const extractComposerText = useCallback((): string => {
    const el = composerRef.current;
    if (!el) return "";
    const clone = el.cloneNode(true) as HTMLDivElement;
    return serializeComposerRoot(clone);
  }, [serializeComposerRoot]);

  const extractComposerSendText = useCallback((): string => {
    return stripComposerQuotePlaceholders(extractComposerText());
  }, [extractComposerText]);

  /** Display/history text: keeps inline quote placeholders with stable index ids. */
  const buildComposerDisplayText = useCallback((): string => {
    const raw = extractComposerText();
    const el = composerRef.current;
    if (!el) return raw;
    const orderedIds = Array.from(
      el.querySelectorAll<HTMLElement>('[data-quote-token="1"]')
    )
      .map((node) => node.getAttribute("data-quote-id") || "")
      .filter(Boolean);
    if (orderedIds.length === 0) return raw;
    return normalizeComposerQuotePlaceholdersToIndices(raw, orderedIds);
  }, [extractComposerText]);

  const collectComposerDraft = useCallback((): Omit<ComposerDraft, "updatedAt"> => {
    const text = composerRef.current
      ? extractComposerText()
      : composerDraftTextRef.current;
    composerDraftTextRef.current = text;
    const attachments: ComposerDraftAttachment[] = Object.entries(contextFilesRef.current)
      .filter(([, file]) => file.status === "ready")
      .map(([key, file]) => ({
        key,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        status: "ready" as const,
        content: file.content,
        ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
        ...(file.sourcePath ? { sourcePath: file.sourcePath } : {}),
        ...(file.referenceToken ? { referenceToken: true } : {}),
        ...(file.composerRefLabel ? { composerRefLabel: file.composerRefLabel } : {}),
        ...(file.lineRange ? { lineRange: file.lineRange } : {}),
        ...(file.spreadsheetRef ? { spreadsheetRef: file.spreadsheetRef } : {}),
        ...(file.snippetRef ? { snippetRef: file.snippetRef } : {}),
        ...(file.snippetContent ? { snippetContent: file.snippetContent } : {}),
        ...(file.htmlElementRef ? { htmlElementRef: file.htmlElementRef } : {}),
      }));
    return {
      text,
      attachments,
      quotes: quoteTargetsRef.current
        .filter((target) => text.includes(composerQuotePlaceholder(target.id)))
        .map((target) => ({
          id: target.id,
          body: target.body,
          message: {
            id: target.message.id,
            role: target.message.role,
            content: target.message.content,
            ...(target.message.avatarName ? { avatarName: target.message.avatarName } : {}),
            ...(target.message.avatarUrl ? { avatarUrl: target.message.avatarUrl } : {}),
            ...(target.message.agentId ? { agentId: target.message.agentId } : {}),
          },
        })),
      refPaths: { ...composerRefPathsRef.current },
      refMetaOverrides: Object.fromEntries(
        Object.entries(composerRefMetaOverrideRef.current).map(([key, value]) => [
          key,
          { ...value },
        ]),
      ),
    };
  }, [extractComposerText]);

  const flushComposerDraftNow = useCallback(
    (identity = activeDraftIdentityRef.current) => {
      if (!identity || draftHydratingRef.current) return;
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      saveComposerDraft(identity, collectComposerDraft());
    },
    [collectComposerDraft],
  );
  flushComposerDraftNowRef.current = flushComposerDraftNow;

  const scheduleComposerDraftSave = useCallback(() => {
    if (draftHydratingRef.current) return;
    if (composerRef.current) {
      composerDraftTextRef.current = extractComposerText();
    }
    if (draftSaveTimerRef.current != null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      flushComposerDraftNowRef.current();
    }, COMPOSER_DRAFT_SAVE_DEBOUNCE_MS);
  }, [extractComposerText]);
  scheduleComposerDraftSaveRef.current = scheduleComposerDraftSave;

  useEffect(() => {
    scheduleComposerDraftSaveRef.current();
  }, [contextFiles, quoteTargets]);

  useEffect(() => {
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushComposerDraftNowRef.current();
      }
    };
    const flushOnUnload = () => flushComposerDraftNowRef.current();
    document.addEventListener("visibilitychange", flushOnVisibilityChange);
    window.addEventListener("beforeunload", flushOnUnload);
    return () => {
      document.removeEventListener("visibilitychange", flushOnVisibilityChange);
      window.removeEventListener("beforeunload", flushOnUnload);
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      draftHydratingRef.current = false;
      flushComposerDraftNowRef.current();
    };
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
    composerSavedRangeRef.current = range.cloneRange();
  }, []);

  const handleSkillSelect = useCallback((skill: SkillItem) => {
    const el = composerRef.current;
    if (!el) return;
    const skillToken = createSkillRefToken(skill.name);
    const space = document.createTextNode(" ");
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(space);
      range.insertNode(skillToken);
      range.setStartAfter(space);
      range.setEndAfter(space);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      el.appendChild(skillToken);
      el.appendChild(space);
      focusComposerEnd();
    }
    syncComposerFromValue(extractComposerSendText());
    scheduleComposerDraftSaveRef.current();
  }, [extractComposerSendText, focusComposerEnd, syncComposerFromValue]);

  const saveComposerCaret = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    composerSavedRangeRef.current = range.cloneRange();
  }, []);

  const readLiveComposerCaretOffset = useCallback((fullText: string): number => {
    const el = composerRef.current;
    if (!el) return fullText.length;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return fullText.length;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return fullText.length;
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(el);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const before = prefixRange.toString().replace(/\u00a0/g, " ");
    if (fullText.startsWith(before)) return before.length;
    const idx = fullText.indexOf(before);
    if (idx >= 0) return idx + before.length;
    return fullText.length;
  }, []);

  const readSerializedComposerAroundCaret = useCallback((): { before: string; after: string } => {
    const el = composerRef.current;
    if (!el) return { before: "", after: "" };
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : composerSavedRangeRef.current;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      return { before: extractComposerText(), after: "" };
    }
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(el);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(el);
    afterRange.setStart(range.endContainer, range.endOffset);
    const beforeWrap = document.createElement("div");
    beforeWrap.appendChild(beforeRange.cloneContents());
    const afterWrap = document.createElement("div");
    afterWrap.appendChild(afterRange.cloneContents());
    return {
      before: serializeComposerRoot(beforeWrap),
      after: serializeComposerRoot(afterWrap),
    };
  }, [extractComposerText, serializeComposerRoot]);

  useEffect(() => {
    const onSelectionChange = () => saveComposerCaret();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [saveComposerCaret]);

  useEffect(() => {
    return () => {
      if (atSearchTimerRef.current != null) clearTimeout(atSearchTimerRef.current);
    };
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
  }, [composerExpanded, contextFiles, pane.id]);

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
  }, [patchComposerRefTokenPaths]);

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
      const override = composerRefMetaOverrideRef.current[name];
      const baseMeta = resolveRefMetaForLabel(name);
      const meta = {
        ...baseMeta,
        ...override,
        htmlElementRef: override?.htmlElementRef ?? baseMeta?.htmlElementRef,
        composerRefLabel: override?.composerRefLabel ?? baseMeta?.composerRefLabel,
        sourcePath: override?.sourcePath ?? baseMeta?.sourcePath,
      };
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
      token.setAttribute("data-ref-kind", kind);
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
      // HTML select-element: [cursor] tag · [bubble] comment — never host HTML filename.
      if (meta?.htmlElementRef) {
        const tag = meta.htmlElementRef.tagName || name;
        const comment = String(meta.htmlElementRef.comment || "").trim();
        label.textContent = tag;
        token.appendChild(label);
        if (comment) {
          token.setAttribute("data-html-element-comment", comment);
          const sep = document.createElement("span");
          sep.className = "mx-0.5 opacity-50";
          sep.textContent = "·";
          token.appendChild(sep);
          const bubble = document.createElement("span");
          bubble.innerHTML =
            '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px;display:inline;vertical-align:-0.1em;margin-right:0.18em;opacity:0.9;color:#059669"><path d="M3 3.5h10a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0113 11.5H8l-2.5 2v-2H3A1.5 1.5 0 011.5 10V5A1.5 1.5 0 013 3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="11.5" cy="4" r="1" fill="currentColor"/></svg>';
          token.appendChild(bubble);
          const commentEl = document.createElement("span");
          commentEl.className = "min-w-0 truncate";
          commentEl.textContent = comment;
          token.appendChild(commentEl);
        }
      } else {
        label.textContent = formatReferenceChipLabel(name, resolvedPath, lineRange);
        token.appendChild(label);
      }
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

  const createQuoteRefToken = useCallback((target: QuoteTarget) => {
    const sender =
      target.message.avatarName ||
      target.message.agentId ||
      (target.message.role === "user" ? "我" : "AI");
    const token = document.createElement("span");
    token.setAttribute("contenteditable", "false");
    token.setAttribute("data-quote-token", "1");
    token.setAttribute("data-quote-id", target.id);
    token.setAttribute("data-quote-message-id", target.message.id);
    // Keep the exact body on the DOM token as a last-resort recovery path for
    // send/draft races. The visible label is intentionally truncated, but the
    // quote itself must never degrade to only that preview.
    token.setAttribute("data-quote-body", target.body);
    token.setAttribute("aria-label", `引用：${target.body}`);
    // Override shared chip max-width — quote preview must stay compact (Cursor-style).
    token.className = `${COMPOSER_INLINE_CHIP_CLASS} agx-composer-quote-chip`;
    token.title = `${sender}: ${target.body}`;
    const icon = document.createElement("span");
    icon.innerHTML = composerQuoteIconInnerHtml(12);
    token.appendChild(icon);
    const label = document.createElement("span");
    label.className = "agx-composer-quote-chip-label";
    label.textContent = formatQuoteChipLabel(target.body);
    token.appendChild(label);
    return token;
  }, []);

  const removeComposerQuoteTokens = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.querySelectorAll('[data-quote-token="1"]').forEach((node) => {
      const next = node.nextSibling;
      node.remove();
      if (next?.nodeType === Node.TEXT_NODE && (next.textContent === " " || next.textContent === "\u00a0")) {
        next.remove();
      }
    });
  }, []);

  const focusAfterNode = useCallback((node: Node) => {
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const after = node.nextSibling;
    if (after?.nodeType === Node.TEXT_NODE) {
      range.setStart(after, Math.min(1, after.textContent?.length ?? 0));
    } else {
      range.setStartAfter(node);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  /** Insert a quote chip at the current caret (Cursor-style inline semantics). */
  const insertQuoteTokenAtCaret = useCallback(
    (target: QuoteTarget) => {
      const el = composerRef.current;
      if (!el) return;
      if (el.querySelector(`[data-quote-id="${target.id}"]`)) return;
      const token = createQuoteRefToken(target);
      const spacer = document.createTextNode(" ");
      const selection = window.getSelection();
      let range: Range | null = null;
      const saved = composerSavedRangeRef.current;
      if (
        saved &&
        el.contains(saved.startContainer) &&
        el.contains(saved.endContainer)
      ) {
        range = saved.cloneRange();
      }
      // Do not el.focus() before resolving range — focus() resets caret to composer start.
      if (!range && selection && selection.rangeCount > 0) {
        const current = selection.getRangeAt(0);
        if (el.contains(current.commonAncestorContainer)) {
          range = current.cloneRange();
        }
      }
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      range.deleteContents();
      // insertNode puts the node at the start of the range; insert spacer then token so order is token+spacer.
      range.insertNode(spacer);
      range.insertNode(token);
      focusAfterNode(token);
    },
    [createQuoteRefToken, focusAfterNode]
  );

  const syncQuoteTargetsFromComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el || quoteTargetsRef.current.length === 0) return;
    const remaining = new Set(
      Array.from(el.querySelectorAll('[data-quote-token="1"]')).map(
        (node) => node.getAttribute("data-quote-id") || ""
      )
    );
    setQuoteTargets((prev) => {
      const next = prev.filter((q) => remaining.has(q.id));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  // Insert newly added quotes at caret; clear DOM chips when state empties.
  useEffect(() => {
    if (quoteTargets.length === 0) {
      removeComposerQuoteTokens();
      return;
    }
    const pendingId = pendingCaretQuoteIdRef.current;
    if (!pendingId) return;
    pendingCaretQuoteIdRef.current = null;
    const target = quoteTargets.find((q) => q.id === pendingId);
    if (!target) return;
    insertQuoteTokenAtCaret(target);
    syncComposerFromValue(extractComposerSendText());
    scheduleComposerDraftSaveRef.current();
  }, [
    quoteTargets,
    insertQuoteTokenAtCaret,
    removeComposerQuoteTokens,
    extractComposerSendText,
    syncComposerFromValue,
  ]);

  const buildQuotedPayload = useCallback((): {
    quotedMessageId?: string;
    quotedContent?: string;
  } => {
    // Preserve semantic order as chips appear in the composer (not append order).
    const byId = new Map(quoteTargets.map((q) => [q.id, q]));
    const orderedNodes = Array.from(
      composerRef.current?.querySelectorAll<HTMLElement>('[data-quote-token="1"]') ?? []
    );
    const ordered: QuoteTarget[] = [];
    for (const node of orderedNodes) {
      const id = node.getAttribute("data-quote-id") || "";
      const hit = byId.get(id);
      if (hit) {
        ordered.push(hit);
        byId.delete(id);
        continue;
      }
      // The chip itself carries the exact body so a DOM/state reconciliation
      // race cannot turn a visible quote into an empty request.
      const body = String(node.getAttribute("data-quote-body") || "").trim();
      if (body) {
        ordered.push({
          id: id || crypto.randomUUID(),
          body,
          message: {
            id: String(node.getAttribute("data-quote-message-id") || id || "quote"),
            role: "assistant",
            content: body,
          },
        });
      }
    }
    for (const leftover of byId.values()) ordered.push(leftover);
    if (ordered.length === 0) return {};
    const items: QuotePayloadItem[] = ordered.map((q) => ({
      label:
        q.message.avatarName ||
        q.message.agentId ||
        (q.message.role === "user" ? "我" : "AI"),
      body: q.body,
    }));
    return {
      quotedMessageId: ordered.map((q) => q.message.id).join(","),
      quotedContent: serializeQuotedContent(items),
    };
  }, [quoteTargets]);

  const setComposerText = useCallback(
    (
      value: string,
      options?: {
        tokenNames?: string[];
        refSourcePaths?: Record<string, string>;
        focus?: boolean;
      },
    ) => {
      composerDraftTextRef.current = value;
      const el = composerRef.current;
      if (!el) {
        syncComposerFromValue(value);
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
      const quoteById = new Map(quoteTargetsRef.current.map((q) => [q.id, q]));
      let cursor = 0;
      let textBuffer = "";
      while (cursor < value.length) {
        const quotePh = matchComposerQuotePlaceholder(value, cursor);
        if (quotePh) {
          if (textBuffer) {
            el.appendChild(document.createTextNode(textBuffer));
            textBuffer = "";
          }
          const target = quoteById.get(quotePh.id);
          if (target) {
            el.appendChild(createQuoteRefToken(target));
          }
          cursor += quotePh.len;
          continue;
        }
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
      const visible = stripComposerQuotePlaceholders(value);
      syncComposerFromValue(visible);
      if (options?.focus !== false) focusComposerEnd();
      scheduleComposerDraftSaveRef.current();
    },
    [
      contextFiles,
      createFileRefToken,
      createSkillRefToken,
      createQuoteRefToken,
      focusComposerEnd,
      syncComposerFromValue,
    ]
  );

  const restoreComposerDraft = useCallback(
    (identity: string) => {
      draftHydratingRef.current = true;
      try {
        const restored = loadComposerDraft(identity);
        const restoredText = restored?.text ?? "";
        const restoredQuotes: QuoteTarget[] = (restored?.quotes ?? [])
          .filter((quote) => restoredText.includes(composerQuotePlaceholder(quote.id)))
          .map((quote) => ({
            id: quote.id,
            body: quote.body,
            message: {
              id: quote.message.id,
              role: quote.message.role,
              content: quote.message.content,
              avatarName: quote.message.avatarName,
              avatarUrl: quote.message.avatarUrl,
              agentId: quote.message.agentId,
            },
          }));
        const restoredContextFiles: Record<string, AttachedFile> = Object.fromEntries(
          (restored?.attachments ?? []).map((attachment) => [
            attachment.key,
            {
              name: attachment.name,
              size: attachment.size,
              mimeType: attachment.mimeType,
              status: attachment.status,
              content: attachment.content,
              dataUrl: attachment.dataUrl,
              sourcePath: attachment.sourcePath,
              referenceToken: attachment.referenceToken,
              composerRefLabel: attachment.composerRefLabel,
              lineRange: attachment.lineRange,
              spreadsheetRef: attachment.spreadsheetRef,
              snippetRef: attachment.snippetRef,
              snippetContent: attachment.snippetContent,
              htmlElementRef: attachment.htmlElementRef,
            },
          ]),
        );
        const restoredRefMeta: Record<string, ComposerDraftRefMeta> = {
          ...(restored?.refMetaOverrides ?? {}),
        };
        for (const attachment of restored?.attachments ?? []) {
          const label =
            String(attachment.composerRefLabel || "").trim() ||
            String(attachment.name || "").trim();
          if (!label) continue;
          restoredRefMeta[label] = {
            ...restoredRefMeta[label],
            ...(attachment.sourcePath ? { sourcePath: attachment.sourcePath } : {}),
            ...(attachment.composerRefLabel
              ? { composerRefLabel: attachment.composerRefLabel }
              : {}),
            ...(attachment.htmlElementRef
              ? { htmlElementRef: attachment.htmlElementRef }
              : {}),
          };
        }

        pendingCaretQuoteIdRef.current = null;
        quoteTargetsRef.current = restoredQuotes;
        contextFilesRef.current = restoredContextFiles;
        composerRefPathsRef.current = { ...(restored?.refPaths ?? {}) };
        composerRefMetaOverrideRef.current = restoredRefMeta;
        composerSavedRangeRef.current = null;
        setQuoteTargets(restoredQuotes);
        setContextFiles(restoredContextFiles);
        setComposerText(restoredText, {
          tokenNames: (restored?.attachments ?? [])
            .flatMap((attachment) => [
              attachment.composerRefLabel,
              attachment.name,
              attachment.sourcePath,
            ])
            .filter((value): value is string => Boolean(value))
            .concat(
              Object.keys(restored?.refPaths ?? {}),
              Object.keys(restored?.refMetaOverrides ?? {}),
            ),
          refSourcePaths: restored?.refPaths ?? {},
          focus: false,
        });
        hydratedDraftIdentityRef.current = identity;

        const omitted = restored?.omittedAttachmentNames ?? [];
        if (omitted.length > 0) {
          const summary =
            omitted.length === 1
              ? `草稿已恢复，附件“${omitted[0]}”需重新添加`
              : `草稿已恢复，${omitted.length} 个较大附件需重新添加`;
          setAttachToastMessage(summary);
          setAttachToastOpen(true);
        }

        for (const attachment of restored?.attachments ?? []) {
          if (
            !attachment.mimeType.startsWith("image/") ||
            attachment.dataUrl ||
            !attachment.sourcePath ||
            typeof window.agenticxDesktop?.loadLocalImageDataUrl !== "function"
          ) {
            continue;
          }
          void window.agenticxDesktop
            .loadLocalImageDataUrl(attachment.sourcePath)
            .then((result) => {
              if (activeDraftIdentityRef.current !== identity) return;
              setContextFiles((prev) => {
                const current = prev[attachment.key];
                if (!current) return prev;
                if (result.ok && result.dataUrl) {
                  return {
                    ...prev,
                    [attachment.key]: { ...current, status: "ready", dataUrl: result.dataUrl },
                  };
                }
                return {
                  ...prev,
                  [attachment.key]: {
                    ...current,
                    status: "error",
                    errorText: "草稿附件已失效，请重新添加",
                  },
                };
              });
            })
            .catch(() => {
              if (activeDraftIdentityRef.current !== identity) return;
              setContextFiles((prev) => {
                const current = prev[attachment.key];
                if (!current) return prev;
                return {
                  ...prev,
                  [attachment.key]: {
                    ...current,
                    status: "error",
                    errorText: "草稿附件已失效，请重新添加",
                  },
                };
              });
            });
        }
      } finally {
        draftHydratingRef.current = false;
      }
    },
    [setComposerText],
  );

  useLayoutEffect(() => {
    const nextIdentity = composerDraftIdentity({
      paneId: pane.id,
      avatarId: pane.avatarId,
      sessionId: pane.sessionId,
    });
    const previousIdentity = activeDraftIdentityRef.current;
    if (
      previousIdentity === nextIdentity &&
      hydratedDraftIdentityRef.current === nextIdentity
    ) {
      return;
    }
    if (previousIdentity && previousIdentity !== nextIdentity) {
      flushComposerDraftNowRef.current(previousIdentity);
    }
    activeDraftIdentityRef.current = nextIdentity;
    restoreComposerDraft(nextIdentity);
  }, [pane.id, pane.avatarId, pane.sessionId, restoreComposerDraft]);

  const migrateActiveComposerDraftToSession = useCallback(
    (sessionId: string) => {
      const trimmedSessionId = sessionId.trim();
      if (!trimmedSessionId) return;
      const fromIdentity = activeDraftIdentityRef.current;
      const toIdentity = composerDraftIdentity({
        paneId: pane.id,
        avatarId: pane.avatarId,
        sessionId: trimmedSessionId,
      });
      flushComposerDraftNowRef.current(fromIdentity);
      migrateComposerDraft(fromIdentity, toIdentity);
      activeDraftIdentityRef.current = toIdentity;
      hydratedDraftIdentityRef.current = toIdentity;
    },
    [pane.id, pane.avatarId],
  );

  const activateFreshComposerDraft = useCallback(
    (initialText = "") => {
      const currentIdentity = activeDraftIdentityRef.current;
      flushComposerDraftNowRef.current(currentIdentity);
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      const provisionalIdentity = composerDraftIdentity({
        paneId: pane.id,
        avatarId: pane.avatarId,
        sessionId: "",
      });
      deleteComposerDraft(provisionalIdentity);
      activeDraftIdentityRef.current = provisionalIdentity;
      hydratedDraftIdentityRef.current = provisionalIdentity;
      draftHydratingRef.current = true;
      try {
        pendingCaretQuoteIdRef.current = null;
        quoteTargetsRef.current = [];
        contextFilesRef.current = {};
        composerRefPathsRef.current = {};
        composerRefMetaOverrideRef.current = {};
        composerSavedRangeRef.current = null;
        setQuoteTargets([]);
        setContextFiles({});
        setComposerText(initialText);
      } finally {
        draftHydratingRef.current = false;
      }
      if (initialText.trim()) scheduleComposerDraftSaveRef.current();
    },
    [pane.id, pane.avatarId, setComposerText],
  );

  const applyAtMentionReplacement = useCallback(
    (mention: string, options?: Parameters<typeof setComposerText>[1]) => {
      const { before, after } = readSerializedComposerAroundCaret();
      setComposerText(replaceAtMentionAtCaret(before, after, mention), options);
    },
    [readSerializedComposerAroundCaret, setComposerText]
  );

  const handleCrewAppendDirective = useCallback(
    (agentId: string) => {
      const avatar = avatars.find((a) => a.id === agentId);
      const name = String(avatar?.name || agentId).trim();
      if (!name) return;
      applyAtMentionReplacement(`@${name} `);
      focusComposerEnd();
    },
    [applyAtMentionReplacement, avatars, focusComposerEnd],
  );

  const handleCrewSwitchModel = useCallback((agentId: string) => {
    setCrewSettingsAvatarId(agentId);
    setAvatarSettingsOpen(true);
  }, []);

  const handleCrewInterrupt = useCallback(() => {
    const sid = pane.sessionId;
    if (!sid) return;
    void window.agenticxDesktop.interruptSession?.(sid);
  }, [pane.sessionId]);

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
      applyAtMentionReplacement(mention, {
        tokenNames: [cleanLabel],
        ...(absKey ? { refSourcePaths: { [cleanLabel]: absKey } } : {}),
      });
      focusComposerEnd();
    },
    [addContextFile, applyAtMentionReplacement, focusComposerEnd]
  );

  /** Same as insertWorkspaceDirectoryReference, but replaces the `@` token at the
   * caret instead of appending, and accepts an already-known absolute path. */
  const insertAtAutocompleteDirectoryReference = useCallback(
    async (taskspaceId: string, relPath: string, label: string, absolutePathHint?: string) => {
      const cleanLabel = String(label || relPath.split(/[\\/]/).pop() || "folder").trim();
      if (!taskspaceId || !cleanLabel) return;
      const start = relPath || ".";
      let abs = String(absolutePathHint || "").trim();
      if (!abs) {
        const apiSessionId = resolveTaskspaceApiSessionId();
        if (!apiSessionId) return;
        const wsResp = await window.agenticxDesktop.listTaskspaces(apiSessionId);
        const ts = wsResp.workspaces?.find((item) => item.id === taskspaceId);
        if (!ts?.path) return;
        abs = start === "." ? ts.path : absoluteTaskspacePath(ts.path, start);
      }
      await addTaskspaceAliasReference(taskspaceId, cleanLabel, abs, start);
      applyAtMentionReplacement(`@${cleanLabel} `, { tokenNames: [cleanLabel] });
      focusComposerEnd();
    },
    [addTaskspaceAliasReference, applyAtMentionReplacement, focusComposerEnd]
  );

  /** Drill into a folder row; the typed query (if any) now scopes to that subtree. */
  const enterAtMentionDir = useCallback(
    (item: Extract<AtCandidate, { kind: "taskspace" | "dir" }>) => {
      const next: AtMentionBrowseState =
        item.kind === "taskspace"
          ? { taskspaceId: item.taskspaceId, taskspaceLabel: item.label, path: "." }
          : {
              taskspaceId: item.taskspaceId,
              taskspaceLabel: atBrowse?.taskspaceLabel || item.label,
              path: item.path,
            };
      setAtBrowse(next);
      void searchAtCandidatesRef.current(atQuery, next);
    },
    [atBrowse, atQuery]
  );

  const leaveAtMentionBrowse = useCallback(() => {
    if (!atBrowse) return;
    // Stepping above the taskspace root returns to the top-level list.
    const next: AtMentionBrowseState | null =
      atBrowse.path === "." ? null : { ...atBrowse, path: parentBrowsePath(atBrowse.path) };
    setAtBrowse(next);
    void searchAtCandidatesRef.current(atQuery, next);
  }, [atBrowse, atQuery]);

  const insertAtMentionDir = useCallback(
    (item: Extract<AtCandidate, { kind: "taskspace" | "dir" }>) => {
      setAtOpen(false);
      setAtQuery("");
      setAtBrowse(null);
      void insertAtAutocompleteDirectoryReference(
        item.taskspaceId,
        item.kind === "taskspace" ? "." : item.path,
        item.label,
        item.kind === "taskspace" ? item.path : undefined
      );
    },
    [insertAtAutocompleteDirectoryReference]
  );

  const pickAtMentionCandidate = useCallback(
    (item: AtCandidate) => {
      if (item.kind === "taskspace" || item.kind === "dir") {
        enterAtMentionDir(item);
        return;
      }
      setAtOpen(false);
      setAtQuery("");
      setAtBrowse(null);
      if (item.kind === "avatar") {
        applyAtMentionReplacement(`@${item.label} `);
        return;
      }
      void insertAtAutocompleteFileReference(item.taskspaceId, item.path, item.label);
    },
    [applyAtMentionReplacement, enterAtMentionDir, insertAtAutocompleteFileReference]
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
      if (payload.kind === "html-element") {
        const comment = String(payload.comment || "").trim();
        const content = buildHtmlElementContextSnippet({
          absolutePath: abs,
          tagName: payload.tagName,
          selectorHint: payload.selectorHint,
          outerHTML: payload.outerHTML,
          innerText: payload.innerText,
          comment,
        });
        if (!content.trim()) return;
        const tag = String(payload.tagName || "element").trim() || "element";
        // Key must match buildContextFileKeyFromAttachment → `${abs}:${snippetRef}`.
        const snippetRef = `el-${makeSnippetRef(
          `${payload.selectorHint}\n${payload.outerHTML}\n${comment}`
        )}`;
        // Unique @token per element — bare tag (e.g. "span") is shared across chips and
        // would overwrite composerRefMetaOverrideRef / collapse Trae comment onto every chip.
        // Chip display still uses htmlElementRef.tagName (+ comment), never the token id.
        const tokenLabel = snippetRef;
        const key = `${abs}:${snippetRef}`;
        const htmlElementRef = {
          tagName: tag,
          selectorHint: payload.selectorHint,
          ...(comment ? { comment } : {}),
        };
        // Must set before setComposerText — otherwise chip falls back to folder + index.html.
        composerRefMetaOverrideRef.current[tokenLabel] = {
          sourcePath: abs,
          composerRefLabel: tokenLabel,
          htmlElementRef,
        };
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
            composerRefLabel: tokenLabel,
            snippetRef,
            snippetContent: content,
            htmlElementRef,
          },
        }));
        // Trae: comment lives inside the chip visually; model also gets user_comment in context_files.
        const { next, tokenNames } = buildFileMentionAppend(extractComposerText(), tokenLabel, {
          mentionText: tokenLabel,
        });
        setComposerText(next, {
          tokenNames,
          refSourcePaths: { [tokenLabel]: abs },
        });
        focusComposerEnd();
        return;
      }
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

  /** Left-sidebar file-manage view dispatches picks; only the owning pane applies them. */
  useEffect(() => {
    const onPickFile = (ev: Event) => {
      const detail = (ev as CustomEvent<NearWorkspacePickFileDetail>).detail;
      if (!detail || detail.paneId !== pane.id) return;
      void insertWorkspaceFileReference(detail.taskspaceId, detail.path);
    };
    const onPickDir = (ev: Event) => {
      const detail = (ev as CustomEvent<NearWorkspacePickDirDetail>).detail;
      if (!detail || detail.paneId !== pane.id) return;
      void insertWorkspaceDirectoryReference(detail.taskspaceId, detail.relPath, detail.label);
    };
    window.addEventListener(NEAR_WORKSPACE_PICK_FILE, onPickFile);
    window.addEventListener(NEAR_WORKSPACE_PICK_DIR, onPickDir);
    return () => {
      window.removeEventListener(NEAR_WORKSPACE_PICK_FILE, onPickFile);
      window.removeEventListener(NEAR_WORKSPACE_PICK_DIR, onPickDir);
    };
  }, [pane.id, insertWorkspaceFileReference, insertWorkspaceDirectoryReference]);

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

      // Open the WorkPanel shell only — never switch to「工作区」file-tree tab.
      // File browsing lives in left-nav「文件管理」; previews are Trae-style tabs.
      if (!pane.taskspacePanelOpen) {
        openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
      }

      if (isInAppHtmlPreviewPath(normalized.absolutePath)) {
        void (async () => {
          const prepared = await loadPreparedHtmlSrcDoc(normalized.absolutePath);
          if (prepared.ok) {
            setWorkPanelFocus({
              kind: "browser",
              url: pathToFileUrl(normalized.absolutePath),
              title: artifactBaseName(normalized.absolutePath) || "HTML",
              srcDoc: prepared.srcDoc,
            });
            return;
          }
          setWorkPanelFocus({
            kind: "preview",
            absolutePath: normalized.absolutePath,
            title: artifactBaseName(normalized.absolutePath),
          });
        })();
        return;
      }

      setWorkPanelFocus({
        kind: "preview",
        absolutePath: normalized.absolutePath,
        title: artifactBaseName(normalized.absolutePath),
        ...(normalized.lineRange ? { lineRange: normalized.lineRange } : {}),
      });
    },
    [pane.id, pane.taskspacePanelOpen, paneWidth, openSidePanel],
  );

  /** Left-sidebar file-manage → Trae WorkPanel preview tab on the right. */
  useEffect(() => {
    const onOpenPreview = (ev: Event) => {
      const detail = (ev as CustomEvent<NearWorkspaceOpenPreviewDetail>).detail;
      if (!detail || detail.paneId !== pane.id) return;
      const abs = String(detail.absolutePath || "").trim();
      if (!abs) return;
      openWorkspaceFilePreview(abs);
    };
    window.addEventListener(NEAR_WORKSPACE_OPEN_PREVIEW, onOpenPreview);
    return () => window.removeEventListener(NEAR_WORKSPACE_OPEN_PREVIEW, onOpenPreview);
  }, [pane.id, openWorkspaceFilePreview]);

  const openFileReferencePreview = useCallback(
    (request: WorkspacePreviewOpenRequest) => {
      openWorkspaceFilePreview(request);
    },
    [openWorkspaceFilePreview],
  );

  const revealFileInTaskspace = useCallback(async (absPath: string) => {
    const path = String(absPath || "").trim();
    if (!path) return;

    if (!pane.taskspacePanelOpen) {
      openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
    }

    // HTML reports: Trae-style in-app browser tab (srcDoc), never shell-open Chrome.
    // Relative <img src="*.svg"> assets are inlined as data URLs for srcDoc.
    if (isInAppHtmlPreviewPath(path)) {
      const prepared = await loadPreparedHtmlSrcDoc(path);
      if (prepared.ok) {
        setWorkPanelFocus({
          kind: "browser",
          url: pathToFileUrl(path),
          title: artifactBaseName(path) || "HTML",
          srcDoc: prepared.srcDoc,
        });
        return;
      }
      console.warn("[ChatPane] read HTML failed:", prepared.error);
    }

    let isDirectory = looksLikeDirectoryPath(path);
    const resolve = window.agenticxDesktop?.resolveLocalPath;
    if (resolve) {
      try {
        const info = await resolve(path);
        if (info.ok) {
          if (info.isDirectory) isDirectory = true;
          else if (info.isFile) isDirectory = false;
        }
      } catch {
        // Keep heuristic fallback.
      }
    }

    if (isDirectory) {
      setWorkPanelFocus({
        kind: "summary",
        section: "artifacts",
        highlightPath: path,
      });
      const open = window.agenticxDesktop?.shellOpenPath;
      if (open) {
        const result = await open(path);
        if (!result.ok) console.warn("[ChatPane] open directory failed:", result.error);
      }
      return;
    }

    // PDF / Office / image / markdown / mermaid / code → Trae-style preview tab (not 工作区).
    if (isInAppArtifactPreviewPath(path)) {
      if (!pane.taskspacePanelOpen) {
        openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
      }
      setWorkPanelFocus({
        kind: "preview",
        absolutePath: path,
        title: artifactBaseName(path),
      });
      return;
    }

    // Unknown types: highlight in artifacts + locate in Finder (do not shell-open).
    setWorkPanelFocus({
      kind: "summary",
      section: "artifacts",
      highlightPath: path,
    });
    const reveal = window.agenticxDesktop?.shellShowItemInFolder;
    if (reveal) {
      const result = await reveal(path);
      if (!result.ok) console.warn("[ChatPane] reveal file failed:", result.error);
    }
  }, [pane.id, pane.taskspacePanelOpen, paneWidth, openSidePanel, openWorkspaceFilePreview]);

  const copyMessage = useCallback(async (message: Message) => {
    const raw = messagePlainTextForClipboard(message);
    const textToCopy =
      message.role === "user"
        ? canonicalizeUserReferenceMentions(raw, message.attachments)
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
      // Pair user question + following ReAct/assistant block as one turn (and vice versa).
      const linkedIds = collectTurnLinkedIds(
        message,
        useReActImLayout ? topLevelRowsIm : null,
        visibleMessages,
      );
      const allSelected = Array.from(linkedIds).every((id) => next.has(id));
      if (allSelected) {
        for (const id of linkedIds) next.delete(id);
      } else {
        for (const id of linkedIds) next.add(id);
      }
      return next;
    });
  }, [topLevelRowsIm, useReActImLayout, visibleMessages]);

  /** Toggle a full conversation turn: ReAct block + preceding user question. */
  const toggleSelectBlock = useCallback((messages: Message[]) => {
    setSelectedMessageIds((prev) => {
      const linkedIds = collectTurnLinkedIdsForBlock(
        messages,
        useReActImLayout ? topLevelRowsIm : null,
      );
      const allSelected = Array.from(linkedIds).every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of linkedIds) next.delete(id);
      } else {
        for (const id of linkedIds) next.add(id);
      }
      return next;
    });
  }, [topLevelRowsIm, useReActImLayout]);

  const selectUpTo = useCallback((targetMessage: Message) => {
    setSelectedMessageIds((prev) => {
      if (prev.size === 0) {
        return collectTurnLinkedIds(
          targetMessage,
          useReActImLayout ? topLevelRowsIm : null,
          visibleMessages,
        );
      }
      let lastSelectedIdx = -1;
      for (let i = visibleMessages.length - 1; i >= 0; i--) {
        if (prev.has(visibleMessages[i].id)) { lastSelectedIdx = i; break; }
      }
      const targetIdx = visibleMessages.findIndex((m) => m.id === targetMessage.id);
      if (targetIdx < 0) return prev;
      if (lastSelectedIdx < 0) {
        return collectTurnLinkedIds(
          targetMessage,
          useReActImLayout ? topLevelRowsIm : null,
          visibleMessages,
        );
      }
      const lo = Math.min(lastSelectedIdx, targetIdx);
      const hi = Math.max(lastSelectedIdx, targetIdx);
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(visibleMessages[i].id);
      return expandSelectionToCompleteTurns(
        next,
        useReActImLayout ? topLevelRowsIm : null,
        visibleMessages,
      );
    });
  }, [topLevelRowsIm, useReActImLayout, visibleMessages]);

  const selectedMessages = useMemo(
    () => visibleMessages.filter((m) => selectedMessageIds.has(m.id)),
    [visibleMessages, selectedMessageIds]
  );

  const selectedTurnCount = useMemo(
    () =>
      countSelectedConversationTurns(
        useReActImLayout ? topLevelRowsIm : null,
        selectedMessageIds,
        visibleMessages,
      ),
    [selectedMessageIds, topLevelRowsIm, useReActImLayout, visibleMessages],
  );

  const resolveForwardTarget = useCallback(
    async (payload: ForwardConfirmPayload): Promise<{ paneId: string; sessionId: string }> => {
      return resolveForwardTargetPayload(payload, {
        addPane,
        setActivePaneId,
        setActiveAvatarId,
        setPaneSessionId,
      });
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
    setPendingForwardMessages([buildForwardPendingMessage(message, userBubbleLabel, selectedText)]);
    setForwardPickerOpen(true);
  }, [userBubbleLabel]);

  const forwardSelectedMessages = useCallback(() => {
    if (selectedMessages.length === 0) return;
    setPendingForwardMessages(
      selectedMessages.map((message) => buildForwardPendingMessage(message, userBubbleLabel))
    );
    setForwardPickerOpen(true);
  }, [selectedMessages, userBubbleLabel]);

  const exportSelectedMessagesToPdf = useCallback(async () => {
    if (selectedMessages.length === 0) return;
    try {
      const now = Date.now();
      // Expand partial ReAct multi-select to the full turn so the final answer /
      // show_widget graphic cannot be omitted from the PDF.
      const messagesForExport = expandSelectionForCompletePdfExport(
        selectedMessages,
        visibleMessages,
      );
      const html = await buildMessagesPdfHtml({
        messages: messagesForExport,
        sessionTitle: paneAvatarMeta.name || pane?.avatarName || "对话记录",
        exportedAt: now,
        userBubbleLabel,
        appTheme: document.documentElement.getAttribute("data-theme") || "dark",
      });
      const stamp = new Date(now)
        .toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        .replace(":", "-");
      const sessionSlug = (paneAvatarMeta.name || pane?.avatarName || "对话")
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 32);
      const res = await window.agenticxDesktop.exportMessagesPdf({
        html,
        defaultFileName: `和创智派对话_${sessionSlug}_${stamp}.pdf`,
      });
      if (res.canceled) return;
      if (res.ok && res.path) {
        setStallHintToast(`已保存到 ${res.path}`);
        setSelectedMessageIds(new Set());
      } else {
        setStallHintToast(`导出失败：${res.error || "未知错误"}`);
      }
    } catch (e) {
      setStallHintToast(`导出失败：${String(e).slice(0, 120)}`);
    }
  }, [
    pane?.avatarName,
    paneAvatarMeta.name,
    selectedMessages,
    setSelectedMessageIds,
    userBubbleLabel,
    visibleMessages,
  ]);

  const shareSelectedAsText = useCallback(async () => {
    const exportable = messagesForShareExport(selectedMessages, visibleMessages);
    if (exportable.length === 0) return;
    const merged = exportable
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
      setStallHintToast("已复制文本");
    } catch {
      setStallHintToast("复制失败");
    }
  }, [selectedMessages, userBubbleLabel, visibleMessages]);

  const deleteSelectedMessages = useCallback(async () => {
    if (selectedMessages.length === 0 || !apiBase || !pane.sessionId) return;
    const desktop = window.agenticxDesktop;
    const deleteLabel =
      selectedTurnCount > 0
        ? `确认删除已选中的 ${selectedTurnCount} 轮对话？`
        : `确认删除已选中的 ${selectedMessages.length} 条消息？`;
    const confirmResult =
      typeof desktop.confirmDialog === "function"
        ? await desktop.confirmDialog({
            title: "确认删除消息",
            message: deleteLabel,
            detail: "删除后不可恢复。",
            confirmText: "删除",
            cancelText: "取消",
            destructive: true,
          })
        : {
            ok: true,
            confirmed: window.confirm(`${deleteLabel}删除后不可恢复。`),
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
  }, [
    apiBase,
    apiToken,
    pane.id,
    pane.messages,
    pane.sessionId,
    selectedMessages,
    selectedTurnCount,
    setPaneMessages,
  ]);

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
    // 骨架屏只在首次尝试点亮；失败/空会话的退避重试在后台静默进行，
    // 避免「正在加载会话…」与空态来回切换造成频闪。
    const showSkeleton = sessionBootstrapAttemptRef.current === 0;
    void (async () => {
      if (showSkeleton) setPaneLoadingMessages(pane.id, true);
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
        // Tail succeeded with an empty window and no older pages → session is
        // authoritatively empty (brand-new group / never chatted). Skip the
        // full-load fallback and do not schedule empty-session retries — both
        // previously kept the skeleton up for an extra IPC round-trip (and up
        // to ~8s of silent refetch) even though there was nothing to load.
        if (entry && !entry.hasOlder) {
          setPaneMessagePaging(pane.id, {
            oldestLoadedIndex: 0,
            hasOlderMessages: false,
            loadingOlderMessages: false,
          });
          sessionBootstrapRef.current = sid;
          return;
        }
        // Tail unavailable (null) or suspicious empty-with-older — full load so
        // a transient pagination miss never leaves the pane blank.
        const full = await window.agenticxDesktop.loadSessionMessages(sid);
        if (cancelled || !paneStillOnSid()) return;
        if (full.ok && Array.isArray(full.messages)) {
          if (full.messages.length > 0) {
            const mapped = full.messages.map((item, index) =>
              mapLoadedSessionMessage(item as LoadedSessionMessage, sid, index, sid)
            );
            setPaneMessages(pane.id, mapped);
          }
          setPaneMessagePaging(pane.id, {
            oldestLoadedIndex: 0,
            hasOlderMessages: false,
            loadingOlderMessages: false,
          });
          // Mark bootstrapped on authoritative empty too — otherwise the
          // finally-block retry loop keeps re-fetching an empty session.
          sessionBootstrapRef.current = sid;
        }
      } catch {
        /* schedule retry below */
      } finally {
        if (sessionBootstrapInflightRef.current === sid) {
          sessionBootstrapInflightRef.current = "";
        }
        if (!cancelled && paneStillOnSid()) {
          // Only retry when the load itself failed — not when the session is
          // confirmed empty (sessionBootstrapRef already set above).
          const bootstrapped = sessionBootstrapRef.current === sid;
          if (!bootstrapped && sessionBootstrapAttemptRef.current < 4) {
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
        if (!cancelled && showSkeleton) setPaneLoadingMessages(pane.id, false);
      }
    })();
    return () => {
      cancelled = true;
      if (sessionBootstrapInflightRef.current === sid) {
        sessionBootstrapInflightRef.current = "";
        if (showSkeleton) setPaneLoadingMessages(pane.id, false);
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
  const awaitingHuman = useMemo(
    () => paneHasPendingHumanGate(pane.messages),
    [pane.messages],
  );
  const silenceTier = useMemo(
    () =>
      awaitingHuman
        ? "thinking"
        : resolveSilenceTier(silentSeconds, stallThresholdSeconds),
    [awaitingHuman, silentSeconds, stallThresholdSeconds],
  );
  const sessionHealth = useMemo(
    () =>
      resolveSessionHealth(
        silentSeconds,
        stallThresholdSeconds,
        sessionExecutionState,
        stallState,
        awaitingHuman,
      ),
    [awaitingHuman, silentSeconds, stallThresholdSeconds, sessionExecutionState, stallState],
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
    async (sid: string, opts?: { allowDuringStream?: boolean }): Promise<boolean> => {
      // A foreground SSE stream is the single source of truth while it runs;
      // disk lags and uses a positional id scheme incompatible with the live
      // `uid()` rows, so merging mid-stream re-introduces the just-truncated
      // old reply (the retry "拼接"). Let the stream own the in-memory state.
      // Reattach may opt in via allowDuringStream for mid-turn group replies.
      if (!opts?.allowDuringStream && sessionStreamStateRef.current[sid]?.active) return false;
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
            if (p.type === "group_reply" || p.type === "group_skipped") {
              // Group replies are persisted mid-turn; merge via disk so ids stay
              // aligned instead of minting live rows. Debounce to avoid thrash.
              const prevTimer = reattachGroupMergeTimersRef.current[sid];
              if (prevTimer != null) window.clearTimeout(prevTimer);
              reattachGroupMergeTimersRef.current[sid] = window.setTimeout(() => {
                delete reattachGroupMergeTimersRef.current[sid];
                void mergeTailFromDisk(sid, { allowDuringStream: true });
              }, 300);
              continue;
            }
            // done/final/replay_gap/graph.*/group_typing: disk merge in finally.
          }
        }
      } catch {
        /* aborted or network error — disk merge below reconciles state */
      } finally {
        const mergeTimer = reattachGroupMergeTimersRef.current[sid];
        if (mergeTimer != null) {
          window.clearTimeout(mergeTimer);
          delete reattachGroupMergeTimersRef.current[sid];
        }
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
      setStallWait(null);
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
    const legacyUnattended = (pane.messages ?? []).filter(
      (m) =>
        m.role === "tool" &&
        typeof m.content === "string" &&
        (m.content.includes("无人值守续跑") || m.content.includes("自动续跑提醒")),
    ).length;
    const priorUnattended = Math.max(
      legacyUnattended,
      maxContinuationRound(pane.messages ?? []),
    );
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

  /**
   * Atomically claim the live stream buffer into pane.messages before any
   * interrupt/abort clears the overlay. Without this, Stop leaves a blank
   * transcript until the user switches sessions and reloads from disk.
   */
  const preserveUncommittedStreamPartial = useCallback(
    (sid: string, provider?: string, model?: string): boolean => {
      if (!sid) return false;
      const claimedRaw = streamCommitRegistryRef.current.claimUncommittedText(sid);
      let partial = (claimedRaw ?? "").trim().replace(/[：:]\s*$/, "").trimEnd();
      if (!partial && !streamCommitRegistryRef.current.isCommitted(sid)) {
        const fromRef = streamTextRef.current.trim();
        const fromState = String(sessionStreamStateRef.current[sid]?.text ?? "").trim();
        const fallback = (fromRef || fromState)
          .replace(/[：:]\s*$/, "")
          .trimEnd();
        if (
          fallback &&
          fallback !== "⏹ 正在中断..." &&
          !isThinkingPlaceholderText(fallback) &&
          !isStreamToolLabelOnlyText(fallback)
        ) {
          streamCommitRegistryRef.current.markCommitted(sid);
          partial = fallback;
        }
      }
      if (
        !partial ||
        isThinkingPlaceholderText(partial) ||
        isStreamToolLabelOnlyText(partial)
      ) {
        return false;
      }
      const parsed = parseReasoningContent(partial);
      const reasoningText = parsed.reasoning.trim();
      const bodyContent = parsed.response.replace(/[：:]\s*$/, "").trimEnd();
      const commitExtras: Record<string, unknown> = { ownerSessionId: sid };
      let commitContent = partial;
      if (reasoningText) {
        commitExtras.reasoning = reasoningText.slice(0, 16384);
        commitContent = bodyContent;
      }
      if (!commitContent.trim() || isStreamToolLabelOnlyText(commitContent)) {
        return false;
      }
      addPaneMessage(
        pane.id,
        "assistant",
        commitContent,
        "meta",
        provider,
        model,
        undefined,
        commitExtras,
      );
      streamCommitRegistryRef.current.setMidCommit(sid, partial);
      return true;
    },
    [addPaneMessage, pane.id],
  );

  const stopCurrentRun = useCallback(async () => {
    const sid = (streamingSessionId || pane.sessionId || "").trim();
    if (!sid) return;
    if (stopInFlightRef.current[sid]) return;

    stopInFlightRef.current[sid] = true;
    setStoppingSessionId(sid);
    userStoppedSessionRef.current[sid] = true;
    setRunGuardSessionId(sid);
    setStallState("none");

    // Commit visible partial BEFORE wiping overlay / aborting SSE. Lite ChatView
    // already does this; Pro previously only reloaded partial after session switch.
    preserveUncommittedStreamPartial(
      sid,
      streamingModel?.provider || chatProvider || undefined,
      streamingModel?.model || chatModel || undefined,
    );

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
        // Backend persists turn_interrupted asynchronously; retry disk merge so
        // the「已中断 / 恢复执行」card appears without requiring a session switch.
        invalidateSessionTail(sid);
        void (async () => {
          for (const delayMs of [150, 450, 1000]) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
            const latestSid = String(
              useAppStore.getState().panes.find((p) => p.id === pane.id)?.sessionId ?? "",
            ).trim();
            if (latestSid !== sid) return;
            await mergeTailFromDisk(sid);
          }
        })();
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
  }, [
    addPaneMessage,
    chatModel,
    chatProvider,
    mergeTailFromDisk,
    pane.id,
    pane.sessionId,
    preserveUncommittedStreamPartial,
    streamingModel?.model,
    streamingModel?.provider,
    streamingSessionId,
  ]);

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

      // Parked on an unanswered HITL card: silence is expected, not a stall.
      if (paneHasPendingHumanGate(msgs)) {
        setStallState("none");
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

  const resumeCurrentTask = useCallback(async (modelOverride?: { provider: string; model: string }) => {
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
      provider: modelOverride?.provider,
      model: modelOverride?.model,
      continuation: { reason, source: "desktop_manual" },
    });
  }, [addPaneMessage, beginResumeInFlight, interruptForResume, pane.avatarId, pane.id, pane.messages, pane.sessionId, sessionExecutionState, stallState]);

  const resumeWithModel = useCallback(
    async (provider: string, model: string) => {
      setPaneModel(pane.id, provider, model);
      void window.agenticxDesktop.saveConfig({ activeProvider: provider, activeModel: model }).then((result) => {
        if (!result.ok) {
          console.warn("[ChatPane] global model persistence failed", result.error);
        }
      });
      const sid = (pane.sessionId || "").trim();
      if (sid) {
        const persisted = await window.agenticxDesktop.setSessionModel({ sessionId: sid, provider, model });
        if (!persisted.ok) {
          console.warn("[ChatPane] session model persistence failed; continuing with explicit override", persisted.error);
        }
      }
      await resumeCurrentTask({ provider, model });
    },
    [pane.id, pane.sessionId, resumeCurrentTask, setPaneModel]
  );

  // Cursor-like: tool-arg truncation / stream timeout → auto-continue once or twice
  // without requiring「无人值守」. Manual user_interrupt is never auto-resumed.
  useEffect(() => {
    const sid = (pane.sessionId || "").trim();
    if (!sid) return;
    if (resumeInFlightRef.current[sid]) return;
    if (sessionAbortControllersRef.current[sid]) return;
    if (userStoppedSessionRef.current[sid]) return;
    if ((truncationAutoResumeCountRef.current[sid] ?? 0) >= 2) return;
    const msgs = pane.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (!m || !shouldAutoResumeTruncationInterruption(m)) continue;
      if (truncationAutoResumeNoticeRef.current[sid] === m.id) return;
      truncationAutoResumeNoticeRef.current[sid] = m.id;
      truncationAutoResumeCountRef.current[sid] =
        (truncationAutoResumeCountRef.current[sid] ?? 0) + 1;
      void resumeCurrentTask();
      return;
    }
  }, [pane.messages, pane.sessionId, resumeCurrentTask]);

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
        setWorkPanelFocus({ kind: "summary" });
        if (!pane.taskspacePanelOpen) {
          openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
        }
        setSelectedSubAgent(rid);
      } catch {
        // Ignore — cluster card stays interactive; user can retry click.
      }
    },
    [
      apiBase,
      apiToken,
      closeRunDrawer,
      openSidePanel,
      pane.id,
      pane.sessionId,
      pane.taskspacePanelOpen,
      paneSubAgents,
      paneWidth,
      setSelectedSubAgent,
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
    // 选中成员时打开工作台「任务摘要」，子智能体卡片在展开面板内展示。
    setWorkPanelFocus({ kind: "summary" });
    if (!pane.taskspacePanelOpen) {
      openWorkspaceSidebarForPane(pane.id, paneRef.current?.clientWidth ?? paneWidth, openSidePanel);
    }
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
            data-message-id={message.id}
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
                addQuoteTarget(msg, resolveQuoteBody(msg, selectedText))
              }
              onWebSearchMessage={(_msg, selectedText) => {
                const q = selectedText.trim();
                if (!q) return;
                if (!pane.taskspacePanelOpen) {
                  openWorkspaceSidebarForPane(
                    pane.id,
                    paneRef.current?.clientWidth ?? paneWidth,
                    openSidePanel,
                  );
                }
                setWorkPanelFocus({
                  kind: "browser",
                  url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                  title: `搜索：${q}`,
                });
              }}
              onQuoteToNewPane={(msg, selectedText) => {
                const body = resolveQuoteBody(msg, selectedText);
                const label =
                  msg.avatarName ||
                  msg.agentId ||
                  (msg.role === "user" ? userBubbleLabel || "我" : paneAvatarMeta.name || "AI");
                const newPaneId = addPane(pane.avatarId, pane.avatarName, "");
                markPaneAwaitingFreshSession(newPaneId);
                setPanePendingQuote(newPaneId, {
                  messageId: msg.id,
                  body,
                  label,
                });
                setActivePaneId(newPaneId);
              }}
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
              onResolveActionConfirmation={(confirmation, decision) =>
                void resolveActionConfirmation(confirmation, decision, "button")
              }
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
                          ? "border-[rgb(var(--theme-color-rgb,6,182,212))] bg-[rgb(var(--theme-color-rgb,6,182,212))] text-[var(--theme-color-text)]"
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

                      // 过程折叠：见 resolveProcessFoldRange —— 只折工具段，两头的正文不折。
                      const { start: processStart, end: processEnd } =
                        resolveProcessFoldRange(groupedWork);
                      const beforeProcessHeadRows = headRows.slice(0, processStart);
                      const processHeadRows = headRows.slice(processStart, processEnd);
                      const afterProcessHeadRows = headRows.slice(processEnd);
                      const processToolCount = processHeadRows.reduce(
                        (n, r) => n + (r.kind === "tool_group" ? r.messages.length : 0),
                        0,
                      );
                      const isLastBlock =
                        topLevelRowsIm !== null && segIdx === topLevelRowsIm.length - 1;
                      const collapseActive = hasStreamingRow || (isLastBlock && sessionWorkInProgress);

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
                                    addQuoteTarget(
                                      lastAssistantInBlock,
                                      resolveQuoteBody(lastAssistantInBlock, undefined)
                                    )
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
                                blockAnySelected
                                  ? "text-[rgb(var(--theme-color-fg-rgb,59,130,246))] hover:opacity-90"
                                  : "hover:text-text-strong"
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
                        peeledFollowupAssistant.suggestedQuestions.length > 0 &&
                        assistantVisibleBodyForUi(
                          String(peeledFollowupAssistant.content ?? ""),
                        ).trim() ? (
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
                          {beforeProcessHeadRows.map((r, i) => mapGroupedRow(r, i))}
                          <ReactWorkCollapse toolCount={processToolCount} active={collapseActive}>
                            {processHeadRows.map((r, i) => mapGroupedRow(r, processStart + i))}
                          </ReactWorkCollapse>
                          {afterProcessHeadRows.map((r, i) => mapGroupedRow(r, processEnd + i))}
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
        const activityHint = String(groupActivityHint[agentId] ?? "").trim();
        return (
          <ImBubble
            key={`typing-${agentId}`}
            message={{
              id: `typing-${agentId}`,
              role: "assistant",
              content: activityHint,
              avatarName: name,
              agentId,
            }}
            assistantName={typingSender.name}
            assistantAvatarUrl={typingSender.url}
            showSenderIdentity={isGroupPane}
            senderAvatarVariant="rounded-square"
            senderAvatarId={typingSender.avatarId}
          />
        );
      })}
      {((sessionWorkInProgress && !isStreamingCurrentSession) || midTurnStreamActivity) &&
      !isGroupPane &&
      (showToolCalls ||
        !(isStreamingCurrentSession
          ? lastTurnHasToolActivity(pane.messages)
          : lastTurnHasActiveToolActivity(pane.messages))) ? (
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
          allowResume={
            !(
              stallReason === "incomplete" &&
              lastTurnHasToolActivity(pane.messages)
            )
          }
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
  }, [autoNudgeCount, budgetExceededInfo, chatStyle, copyMessage, copyReActBlock, currentModelLabel, exhaustedRounds, favoriteMessage, forwardOneMessage, groupChatUserLabel, groupTyping, groupActivityHint, groupedVisibleMessages, openSubAgentDetailFromCluster, hideStreamOverlayAsDuplicate, isGroupPane, isRunGuardCurrentSession, isStreamingCurrentSession, lastAssistantMessageId, midTurnStreamActivity, openFileReferencePreview, pane.historySearchTerms, pane.messages, pane.sessionId, paneAvatarMeta, paneId, readyAttachments.length, resolveGroupInlineConfirm, resolveGroupSender, resolveQuoteBody, resumeCurrentTask, resumeInFlight, resumeWithModel, revealFileInTaskspace, retryUserMessage, selectUpTo, selectedMessageIds, sendFollowupChip, sessionBusy, sessionWorkInProgress, addQuoteTarget, showInlineAssistantModelBadge, showToolCalls, silentSeconds, stallModelOptions, stallRejectReason, stallRuntimeConfig.stall_auto_nudge_max_per_session, stallState, stopCurrentRun, streamTextForCurrentSession, streamingModel, toggleSelectBlock, toggleSelectMessage, topLevelRowsIm, userAvatarUrl, userBubbleLabel]);

  const removeAttachment = useCallback((key: string) => {
    setContextFiles((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const visionAttachBlocked =
    isKnownNonVisionChatModel(chatProvider, chatModel) && !visionFallback.available;
  const notifyImageAttach = () => {
    if (visionAttachBlocked) {
      setAttachToastMessage(VISION_UNSUPPORTED_TOAST);
      setAttachToastOpen(true);
      return;
    }
    if (isKnownNonVisionChatModel(chatProvider, chatModel) && visionFallback.available) {
      const key = `${paneId}:${chatProvider}/${chatModel}`;
      if (fallbackHintedRef.current !== key) {
        fallbackHintedRef.current = key;
        setAttachToastMessage(`当前模型不支持看图，将由 ${visionFallback.label || "视觉模型"} 解读图片`);
        setAttachToastOpen(true);
      }
    }
  };

  const parseLocalFile = useCallback((file: File, key: string) => {
    if (isImageFile(file) && isKnownNonVisionChatModel(chatProvider, chatModel)) {
      notifyImageAttach();
      if (visionAttachBlocked) return;
    }
    if (isVideoFile(file) && isKnownNonVisionChatModel(chatProvider, chatModel)) {
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
      const absolutePath = window.agenticxDesktop?.getPathForFile?.(file) || "";
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
            ...(absolutePath ? { sourcePath: absolutePath } : {}),
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
            ...(absolutePath ? { sourcePath: absolutePath } : {}),
          },
        }));
      };
      reader.readAsDataURL(file);
      return;
    }

    if (isLikelyTextFile(file)) {
      const absolutePath = window.agenticxDesktop?.getPathForFile?.(file) || "";
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
            ...(absolutePath ? { sourcePath: absolutePath } : {}),
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
            ...(absolutePath ? { sourcePath: absolutePath } : {}),
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

    if (isVideoFile(file)) {
      const absolutePath = window.agenticxDesktop?.getPathForFile?.(file) || "";
      if (absolutePath) {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "video/mp4",
            status: "ready",
            content: `[视频] ${file.name}（可用 video_understand 理解）`,
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
  }, [chatProvider, chatModel, notifyImageAttach, visionAttachBlocked]);

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
    composerEmpty: !composerHasText,
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
      queueDrain?: boolean;
      lockedSessionId?: string;
      provider?: string;
      model?: string;
      continuation?: { reason: ContinueReason; source: ContinueSource };
    }
  ) => Promise<void>>(
    async () => {}
  );
  const resumeInNewSessionRef = useRef<() => void>(() => {});

  /** Materialize a lazy session (fresh topic / no sessionId yet) with full create params. */
  const materializeLazySession = useCallback(async (): Promise<string | null> => {
    const existing = (pane.sessionId || "").trim();
    if (existing) return existing;

    try {
      const avatarId = sessionCreateAvatarId(pane.avatarId);
      const inheritFrom = peekPaneLazyInheritParent(pane.id);
      const pendingMode = peekPanePendingSessionMode(pane.id) ?? pane.sessionMode ?? "daily_office";
      const created = await window.agenticxDesktop.createSession({
        avatar_id: avatarId,
        session_mode: pendingMode,
        ...(inheritFrom ? { inherit_from_session_id: inheritFrom } : {}),
        ...(chatProvider && chatModel ? { provider: chatProvider, model: chatModel } : {}),
      });
      if (!created.ok || !created.session_id) {
        console.error("[ChatPane] materializeLazySession failed:", created.error);
        return null;
      }
      const newSessionId = created.session_id;
      migrateActiveComposerDraftToSession(newSessionId);
      migratePaneKbRetrievalModeToSession(pane.id, newSessionId);
      clearPaneLazyInheritParent(pane.id);
      clearPanePendingSessionMode(pane.id);
      setPaneSessionMode(pane.id, created.session_mode ?? pendingMode);
      if (created.inherited) {
        setPaneContextInherited(pane.id, true);
      }
      setPaneSessionId(pane.id, newSessionId, {
        provider: chatProvider || undefined,
        model: chatModel || undefined,
      });
      clearPaneAwaitingFreshSession(pane.id);
      useAppStore.getState().bumpSessionCatalogRevision();
      window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 450);
      return newSessionId;
    } catch (err) {
      console.error("[ChatPane] materializeLazySession threw:", err);
      return null;
    }
  }, [
    pane.id,
    pane.avatarId,
    pane.sessionId,
    pane.sessionMode,
    chatProvider,
    chatModel,
    setPaneSessionId,
    setPaneSessionMode,
    setPaneContextInherited,
    migrateActiveComposerDraftToSession,
  ]);

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
      queueDrain?: boolean;
      lockedSessionId?: string;
      /** Explicit model for a recovery/retry turn; avoids reading stale pane state. */
      provider?: string;
      model?: string;
      continuation?: { reason: ContinueReason; source: ContinueSource };
    }
  ) => {
    const continuation = options?.continuation;
    const isContinuation = !!continuation;
    const requestProvider = String(options?.provider ?? chatProvider ?? "").trim();
    const requestModel = String(options?.model ?? chatModel ?? "").trim();
    // Freeze the quote payload before any async session materialization or
    // composer cleanup. This keeps the exact selected sentence attached to
    // the request even if React processes clearQuoteTargets meanwhile.
    const quotePayloadAtSend = isContinuation ? {} : buildQuotedPayload();
    const composerDisplayText = buildComposerDisplayText();
    const text = userText.trim();
    const hasQuotePayloadEarly =
      quoteTargetsRef.current.length > 0 || Boolean(quotePayloadAtSend.quotedContent);
    // Quote-only turns: keep user_input empty (chips carry context); avoid "见附件" placeholder.
    const messageText = isContinuation
      ? " "
      : text || (hasQuotePayloadEarly ? "" : ATTACHMENT_ONLY_USER_PROMPT);
    const clientTurnId = isContinuation ? "" : crypto.randomUUID();
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
      htmlElementRef: file.htmlElementRef,
    }));
    const rawUserAttachments: MessageAttachment[] =
      retryAttachments && retryAttachments.length > 0
        ? retryAttachments.map((item) => ({ ...item }))
        : composerAttachments;
    // Do not drop reference/workspace attachments when the user asks a short follow-up without @文件名;
    // otherwise context_files never reaches the model and the file looks "invisible".
    const userAttachments: MessageAttachment[] = rawUserAttachments;
    const refAttachments = userAttachments.filter((item) => isWorkspaceReferenceAttachment(item));
    let outboundMessageText =
      refAttachments.length > 0
        ? canonicalizeUserReferenceMentions(messageText, refAttachments)
        : messageText;
    // Trae「评论到对话」: chip shows tag · comment; model must see the comment in user_input too.
    for (const att of refAttachments) {
      const comment = String(att.htmlElementRef?.comment || "").trim();
      if (comment && !outboundMessageText.includes(comment)) {
        outboundMessageText = `${outboundMessageText}\n${comment}`;
      }
    }
    const hasReadyAttachments = userAttachments.length > 0;
    const hasQuotePayload = Boolean(quotePayloadAtSend.quotedContent);
    if (!isContinuation && !text && !hasReadyAttachments && !hasQuotePayload) return;
    if (!apiBase) return;

    if (shouldPinScrollOnUserSend({ continuation, queueDrain: options?.queueDrain })) {
      pinChatListToLatestTurn();
    }

    // Exact 「确认/取消」 phrases resolve a unique pending action card without a new LLM turn.
    if (!isContinuation && text && !hasReadyAttachments) {
      const decision = matchActionConfirmationReply(text);
      if (decision) {
        const found = findResolvableActionConfirmation({
          messages: pane.messages ?? [],
          paneSessionId: (pane.sessionId || "").trim(),
        });
        if (found.kind === "hit") {
          setComposerText("");
          clearQuoteTargets();
          flushComposerDraftNowRef.current();
          await resolveActionConfirmation(found.confirmation, decision, "manual");
          return;
        }
      }
    }

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
          queueDrain: options?.queueDrain,
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
      clearQuoteTargets();
      contextFilesRef.current = {};
      setContextFiles({});
      flushComposerDraftNowRef.current();
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
      // Meta lazy-creates on first send; group/automation must also materialize
      // here (createNewTopic clears sessionId — previously bailed and looked stuck).
      const materializedSessionId = await materializeLazySession();
      if (!materializedSessionId) {
        addPaneMessage(
          pane.id,
          "tool",
          "⚠️ 无法创建会话：未知错误。请检查后端服务。",
          "meta"
        );
        releaseSendLock();
        return;
      }
      requestSessionId = materializedSessionId;
      // Defensive reset: a brand-new lazy session must never display any
      // residual messages from the previously-running session (which may
      // have been racily restored by poll/sync effects while sessionId
      // was transitioning from "" to the new id).
      useAppStore.getState().setPaneMessages(pane.id, []);
      lastPollCountRef.current = 0;
      pollSessionSidRef.current = requestSessionId;
    }
    const isStreamRunActive = resolveStreamRunActive(requestSessionId);

    if (
      shouldInterruptOnResend({
        isStreamRunActive,
        forceSend: options?.forceSend,
        queueDrain: options?.queueDrain,
      })
    ) {
      // Force-send while streaming: abort the current run, then start the new round.
      // Claim the visible partial before abort/overlay cleanup (same helper as Stop).
      const preservedVisiblePartial = preserveUncommittedStreamPartial(
        requestSessionId,
        requestProvider || undefined,
        requestModel || undefined,
      );
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

      // Close a turn that produced no visible assistant output. A claimed partial
      // is already in the pane and Studio persists the same interrupted partial
      // while completing the old runtime.
      const tailMsgs = (useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? [])
        .filter((m) => m.role !== "tool");
      const lastNonTool = tailMsgs[tailMsgs.length - 1];
      if (!preservedVisiblePartial && (!lastNonTool || lastNonTool.role === "user")) {
        const interruptedNote = "（已中断）";
        addPaneMessage(pane.id, "assistant", interruptedNote, "meta", requestProvider, requestModel);
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
        const avatarId = sessionCreateAvatarId(pane.avatarId);
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
    if (isGroupPane) {
      const metaLabel = metaLeaderDisplayName.trim() || META_AGENT_DISPLAY_NAME;
      for (const alias of [metaLabel, META_AGENT_DISPLAY_NAME, "组长", "Machi", "machi", "meta", "meta-agent"]) {
        const key = alias.trim().toLowerCase();
        if (key) mentionMap.set(key, "__meta__");
      }
    }
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
        userAttachments,
        clientTurnId,
      )
    ) {
      suppressUserEcho = true;
      skipUserHistory = true;
    }

    // Chat uploads (not workspace @file refs) → real files under <default>/attachments/.
    let sendAttachments: MessageAttachment[] = userAttachments;
    if (
      !isContinuation &&
      requestSessionId &&
      userAttachments.length > 0 &&
      typeof window.agenticxDesktop?.materializeSessionAttachments === "function"
    ) {
      const materializeIdx: number[] = [];
      const filesPayload: Array<{ name?: string; path?: string; dataUrl?: string }> = [];
      userAttachments.forEach((att, idx) => {
        if (isWorkspaceReferenceAttachment(att)) return;
        if (!att.dataUrl && !String(att.sourcePath || "").trim()) return;
        materializeIdx.push(idx);
        filesPayload.push({
          name: att.name,
          path: att.sourcePath,
          dataUrl: att.dataUrl,
        });
      });
      if (filesPayload.length > 0) {
        try {
          const materialized = await window.agenticxDesktop.materializeSessionAttachments({
            sessionId: requestSessionId,
            files: filesPayload,
          });
          if (materialized.ok && Array.isArray(materialized.files)) {
            const next = userAttachments.map((att) => ({ ...att }));
            materialized.files.forEach((row, i) => {
              const at = materializeIdx[i];
              if (at === undefined || !row?.path) return;
              next[at] = { ...next[at], sourcePath: row.path };
            });
            sendAttachments = next;
            window.dispatchEvent(
              new CustomEvent(NEAR_ARTIFACT_TASKSPACES_SYNCED, {
                detail: { sessionId: requestSessionId, added: materialized.files.length },
              }),
            );
          }
        } catch (err) {
          console.warn("[ChatPane] materializeSessionAttachments failed:", err);
        }
      }
    }

    if (targetAgentId === "meta") {
      if (!suppressUserEcho) {
        const userEchoContent =
          quoteTargetsRef.current.length > 0 ? composerDisplayText : messageText;
        addPaneMessage(
          pane.id,
          "user",
          userEchoContent,
          "meta",
          undefined,
          undefined,
          sendAttachments,
          {
            ownerSessionId: requestSessionId,
            metadata: { client_turn_id: clientTurnId },
            ...(() => {
              if (!quotePayloadAtSend.quotedContent) return {};
              return {
                quotedMessageId: quotePayloadAtSend.quotedMessageId,
                quotedContent: quotePayloadAtSend.quotedContent,
              };
            })(),
          }
        );
        pinChatListToLatestTurn();
      }
    } else {
      addSubAgentEvent(targetAgentId, { type: "user", content: messageText });
      addPaneMessage(pane.id, "tool", `🗣 发送给 ${targetAgentId}: ${messageText}`, "meta");
    }
    setComposerText("");
    clearQuoteTargets();
    // Clear attachments immediately so chips do not linger until the stream ends (finally also clears).
    contextFilesRef.current = {};
    setContextFiles({});
    flushComposerDraftNowRef.current();
    sessionStreamStateRef.current[requestSessionId] = {
      active: true,
      text: "",
      provider: requestProvider,
      model: requestModel,
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
    const pendingToolResults: Record<string, PendingToolResult> = {};
    const showWidgetDeltaTimers = new Map<string, number>();
    const showWidgetDeltaPending = new Map<
      string,
      { argumentsRaw: string; title?: string; widgetCode?: string }
    >();
    const toolCallMetadata = new Map<
      string,
      Pick<PendingToolResult, "toolName" | "toolArgs" | "toolGroupId">
    >();
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
    const mergeLastAssistantIfSessionActive = (patch: Partial<Message>) => {
      if (!isTargetSessionStillActive()) return false;
      return useAppStore
        .getState()
        .mergeLastPaneMessageByRole(pane.id, "assistant", patch);
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
    const addGroupWorkflowMessage = ({
      content,
      agentId = "__meta__",
      avatarName,
      avatarUrl,
      workflowRole = "leader",
      taskId = "",
      attempt = 0,
      status = "",
      event = "",
    }: {
      content: string;
      agentId?: string;
      avatarName?: string;
      avatarUrl?: string;
      workflowRole?: "leader" | "executor" | "reviewer" | "system";
      taskId?: string;
      attempt?: number;
      status?: string;
      event?: string;
    }) => {
      const text = String(content || "").trim();
      if (!text) return;
      addPaneMessageIfSessionActive(
        pane.id,
        "assistant",
        text,
        agentId,
        chatProvider,
        chatModel,
        undefined,
        {
          avatarName: avatarName || undefined,
          avatarUrl: avatarUrl || undefined,
          metadata: {
            kind: "group_workflow_event",
            workflow_role: workflowRole,
            workflow_task_id: taskId,
            workflow_attempt: Math.max(0, Number(attempt) || 0),
            workflow_status: status,
            workflow_event: event,
          },
        },
      );
    };
    const updatePaneToolMessageForSession = (
      toolCallId: string,
      patch: Parameters<typeof updatePaneMessageByToolCallId>[2],
    ) => updatePaneMessageByToolCallId(pane.id, toolCallId, patch, requestSessionId);
    const mergePendingToolResultIntoDeferred = (pending: PendingToolResult): boolean => {
      const deferred = deferredSessionMessagesRef.current[requestSessionId] ?? [];
      const resolution = buildDeferredToolResultResolution(
        deferred.map((args) => ({ role: args[1], extras: args[7] })),
        pending,
      );
      if (!resolution) return false;
      const next = [...deferred];
      const merged = [...next[resolution.index]] as Parameters<typeof addPaneMessage>;
      merged[2] = resolution.content;
      merged[7] = {
        ...resolution.extras,
        ownerSessionId: requestSessionId,
      };
      next[resolution.index] = merged;
      deferredSessionMessagesRef.current[requestSessionId] = next;
      return true;
    };
    const flushPendingToolResults = () => {
      const pendingEntries = drainPendingToolResults(pendingToolResults);
      const sessionActive = isTargetSessionStillActive();
      for (const pending of pendingEntries) {
        if (!pending.patch.content.trim()) continue;
        if (sessionActive) {
          if (updatePaneToolMessageForSession(pending.callId, pending.patch)) continue;
          const currentPane = useAppStore.getState().panes.find((item) => item.id === pane.id);
          if (hasMatchingToolCall(currentPane?.messages ?? [], pending.callId, requestSessionId)) continue;
        } else if (mergePendingToolResultIntoDeferred(pending)) {
          continue;
        }
        addPaneMessageIfSessionActive(
          pane.id,
          "tool",
          pending.patch.content,
          "meta",
          undefined,
          undefined,
          undefined,
          buildPendingToolFallback(pending),
        );
      }
    };
    const flushShowWidgetDelta = (toolCallId: string) => {
      const pending = showWidgetDeltaPending.get(toolCallId);
      showWidgetDeltaPending.delete(toolCallId);
      const timer = showWidgetDeltaTimers.get(toolCallId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        showWidgetDeltaTimers.delete(toolCallId);
      }
      if (!pending) return;
      const partialPayload = {
        argumentsRaw: pending.argumentsRaw,
        title: pending.title,
        widgetCode: pending.widgetCode,
      };
      const partialToolArgs = pending.title ? { title: pending.title } : undefined;
      const merged = updatePaneToolMessageForSession(toolCallId, {
        toolName: "show_widget",
        toolStatus: "running",
        ...(partialToolArgs ? { toolArgs: partialToolArgs } : {}),
        toolArgsPartial: partialPayload,
      });
      if (merged) return;
      const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
      const lastMsg = pan?.messages.length ? pan.messages[pan.messages.length - 1] : undefined;
      const toolGroupId =
        lastMsg?.role === "tool" && lastMsg.toolGroupId
          ? lastMsg.toolGroupId
          : crypto.randomUUID();
      addPaneMessageIfSessionActive(pane.id, "tool", "", "meta", undefined, undefined, undefined, {
        toolCallId,
        toolName: "show_widget",
        toolStatus: "running",
        toolGroupId,
        ...(partialToolArgs ? { toolArgs: partialToolArgs } : {}),
        toolArgsPartial: partialPayload,
      });
    };
    const scheduleShowWidgetDelta = (
      toolCallId: string,
      nextPartial: { argumentsRaw: string; title?: string; widgetCode?: string }
    ) => {
      const prev = showWidgetDeltaPending.get(toolCallId);
      if (prev && nextPartial.argumentsRaw.length < prev.argumentsRaw.length) {
        return;
      }
      showWidgetDeltaPending.set(toolCallId, nextPartial);
      if (showWidgetDeltaTimers.has(toolCallId)) return;
      const timer = window.setTimeout(() => flushShowWidgetDelta(toolCallId), 100);
      showWidgetDeltaTimers.set(toolCallId, timer);
    };
    let streamReasoningStartedAt: number | null = null;
    /**
     * FR-F1 keeps tool-preface body out of chat, but still persist the closed
     * think segment so the streaming ReasoningBlock does not vanish when
     * resetTurnSegment clears the overlay. Does NOT mark the stream committed —
     * the terminal answer still needs its own assistant row.
     */
    const preserveStreamReasoningAtToolBoundary = () => {
      const raw = streamCommitRegistryRef.current.getText(requestSessionId).trim();
      if (!raw || isThinkingPlaceholderText(raw)) return false;
      const parsed = parseReasoningContent(raw);
      const reasoningText = parsed.reasoning.trim();
      if (!reasoningText) return false;
      const bodyContent = parsed.response.replace(/[：:]\s*$/, "").trimEnd();
      // Same-text echo belongs on the final body, not a mid-turn think card.
      if (reasoningDuplicatesVisibleBody(reasoningText, bodyContent)) return false;
      const commitExtras: Record<string, unknown> = {
        reasoning: reasoningText.slice(0, 16384),
      };
      let seconds = getCachedReasoningDuration(reasoningText);
      if (seconds === undefined && streamReasoningStartedAt !== null) {
        seconds = measureReasoningSeconds(streamReasoningStartedAt, Date.now());
        setCachedReasoningDuration(reasoningText, seconds);
      }
      if (seconds !== undefined && seconds >= 1) {
        commitExtras.reasoningSeconds = seconds;
      }
      addPaneMessageIfSessionActive(
        pane.id,
        "assistant",
        "",
        "meta",
        requestProvider,
        requestModel,
        undefined,
        commitExtras,
      );
      streamReasoningStartedAt = null;
      return true;
    };
    const commitCurrentStreamIfNeeded = () => {
      const raw = streamCommitRegistryRef.current.getText(requestSessionId).trim();
      // Trim trailing colon ("：" or ":") that model writes just before calling a tool
      // — prevents orphaned "检查文件：" bubbles before a ToolCallCard.
      const partial = raw.replace(/[：:]\s*$/, "").trimEnd();
      if (
        !partial ||
        isThinkingPlaceholderText(partial) ||
        isStreamToolLabelOnlyText(partial) ||
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
        if (!reasoningDuplicatesVisibleBody(reasoningText, bodyContent)) {
          commitExtras.reasoning = reasoningText.slice(0, 16384);
          let seconds = getCachedReasoningDuration(reasoningText);
          if (seconds === undefined && streamReasoningStartedAt !== null) {
            seconds = measureReasoningSeconds(streamReasoningStartedAt, Date.now());
            setCachedReasoningDuration(reasoningText, seconds);
          }
          if (seconds !== undefined && seconds >= 1) {
            commitExtras.reasoningSeconds = seconds;
          }
        }
        commitContent = bodyContent;
      }
      if (!commitContent.trim() || isStreamToolLabelOnlyText(commitContent)) {
        return false;
      }
      addPaneMessageIfSessionActive(
        pane.id,
        "assistant",
        commitContent,
        "meta",
        requestProvider,
        requestModel,
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
      // Keep backend turn alive across brief SSE drops (network blip / sleep).
      // Without this, streamed tool-arg truncation retries get cancelled mid-flight.
      body.keep_runtime_after_disconnect = true;
      // Idempotency key: backend short-circuits a duplicate POST (double-click /
      // chip burst / retry race) so it never appends a second user row.
      body.client_turn_id = clientTurnId;
      if (skipUserHistory) body.skip_user_history = true;
      const ats = (pane.activeTaskspaceId || "").trim();
      if (ats) body.active_taskspace_id = ats;
      {
        if (quotePayloadAtSend.quotedContent) {
          body.quoted_message_id = quotePayloadAtSend.quotedMessageId;
          body.quoted_content = quotePayloadAtSend.quotedContent;
          body.user_display_content = composerDisplayText;
        }
      }
      if (requestProvider) body.provider = requestProvider;
      if (requestModel) body.model = requestModel;
      // 管理员在企业后台声明的上下文窗口；未声明时不带该字段，由后端按模型名兜底。
      {
        const declaredWindow = resolveManagedContextWindow(
          useAppStore.getState().settings.providers,
          requestProvider,
          requestModel,
        );
        if (declaredWindow) body.context_window = declaredWindow;
      }
      if (requestModel && supportsKimiK3ReasoningEffort(requestModel)) {
        body.reasoning_effort = normalizeKimiReasoningEffort(
          pane.reasoningEffort ?? DEFAULT_KIMI_REASONING_EFFORT,
        );
      } else if (chatModel && supportsDeepSeekV4Thinking(chatModel)) {
        const thinkingOn = pane.thinkingEnabled !== false;
        body.thinking_enabled = thinkingOn;
        if (thinkingOn) {
          body.reasoning_effort = normalizeDeepSeekReasoningEffort(pane.reasoningEffort);
        }
      }
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
      // 提到外层：sticky 判定必须**每轮**都跑，包括本轮没带任何附件的时候——否则
      // 已经锁定的会话下一轮就溜回云端模型了。
      const routedAttachmentNames: Record<string, string> = {};
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
      if (sendAttachments.length > 0) {
        const imageInputs = sendAttachments
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
        const contextFilePayload: Record<string, string> = routedAttachmentNames;
        for (const file of sendAttachments) {
          const key = buildContextFileKeyFromAttachment(file);
          if (!key) continue;
          const ready = resolveReadyAttachment(file, readyEntries);
          const isImage = !!file.dataUrl || file.mimeType.startsWith("image/") || !!ready?.dataUrl || ready?.mimeType.startsWith("image/");
          // Chat-uploaded images are carried via image_inputs / persisted attachments only.
          // Do not mirror them into context_files (bare filenames like image.png confuse
          // the model into calling view_image on non-existent workspace paths).
          if (isImage) continue;
          // Prefer body already on the MessageAttachment (HTML element chips copy snippetContent).
          const fromFile =
            String(file.snippetContent || "").trim() ||
            String(ready?.snippetContent || "").trim() ||
            String(ready?.content || "").trim();
          if (fromFile) {
            contextFilePayload[key] = fromFile;
          } else {
            // materializeSessionAttachments rewrote sourcePath after parse;
            // resolveReadyAttachment then misses readyEntries and the body is
            // lost. Warn so this silent degradation is observable in devtools.
            console.warn(
              "[ChatPane] attachment body lost after materialize, key=",
              key,
              "sourcePath=",
              file.sourcePath,
            );
            contextFilePayload[key] = `[附件] ${file.name}`;
          }
        }
        if (Object.keys(contextFilePayload).length > 0) {
          body.context_files = contextFilePayload;
        }
      }
      // 附件自动路由：本轮带文档时把会话锁到私有部署的多模态模型。
      //
      // 服务端也会判一遍（那边才是权威，CLI / 定时任务 / 子智能体都只经过它）。这里
      // 判的目的是**即时反馈**：用户一挂上文档，选择器就该灰掉并给出理由，而不是发完
      // 才发现被切走了。两边用同一份下发策略，判定逻辑逐条对齐。
      try {
        const routingDecision = decideAttachmentRouting({
          policy: attachmentRoutingPolicy,
          filenames: Object.keys(routedAttachmentNames),
          lockedTarget: attachmentRoutingLock,
        });
        if (routingDecision.action === "lock") {
          const addressed = addressForSession(
            { provider: String(body.provider ?? storeActiveProvider ?? "") },
            routingDecision.target,
          );
          body.provider = addressed.provider;
          body.model = addressed.model;
          // 客户端选的窗口是跟着它自己那个模型来的，换了模型就是错的。
          delete (body as Record<string, unknown>).context_window;
          if (!attachmentRoutingLock) setAttachmentRoutingLock(routingDecision.target);
          if (routingDecision.announce && !routingNoticeDismissed()) {
            setRoutingNotice(routingDecision.target);
          }
        }
      } catch (error) {
        // 路由判定不该挡住发送——服务端还会再判一次。
        console.warn("[ChatPane] attachment routing skipped", error);
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
              ...(requestProvider ? { provider: requestProvider } : {}),
              ...(requestModel ? { model: requestModel } : {}),
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
          avatar_id: sessionCreateAvatarId(pane.avatarId),
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
      let receivedBudgetExceededEvent = false;
      // 本轮是不是只读讨论。workforce.started 带下来之后，后续阶段的旁白都要跟着变，
      // 否则界面会一边说「讨论」一边预告「执行」。
      let groupDiscussionMode = false;
      let pendingSuggestedQuestions: string[] = [];
      let pendingFinalTurnTerminal = false;
      let pendingFinalTerminalReason: string | undefined;
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
              const continuationRound = Number(payload.data?.continuation_round ?? 0);
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
              if (Number.isFinite(continuationRound) && continuationRound > 0) {
                const nextRound = Math.max(
                  unattendedContinueTriggeredRef.current[requestSessionId] ?? 0,
                  Math.floor(continuationRound),
                );
                unattendedContinueTriggeredRef.current[requestSessionId] = nextRound;
                if (sessionStillActive) {
                  setUnattendedContinueCount(nextRound);
                }
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
              setGroupMemberPhase((prev) => {
                if (!(eventAgentId in prev)) return prev;
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              continue;
            }
            if (payload.type === "group_progress") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const workflowRole = String(payload.data?.workflow_role ?? "").trim();
              const nodeId = String(payload.data?.graph_node_id ?? "").trim();
              const callId = String(payload.data?.tool_call_id ?? "").trim();
              const toolName = String(payload.data?.tool_name ?? "").trim();
              const phase = String(payload.data?.tool_phase ?? "").trim();
              const progressText = String(payload.data?.content ?? "").trim();
              const workflowPrefix =
                workflowRole === "reviewer" ? "审核中：" : workflowRole === "executor" ? "执行中：" : "";

              // Light status: one row per member, in-place update (not a chat message).
              setGroupTyping((prev) => ({ ...prev, [eventAgentId]: avatarName }));
              // Round-start chatter is covered by expert label + stream dots.
              if (
                progressText &&
                !/^开始处理任务/.test(progressText) &&
                !/^已接收任务/.test(progressText)
              ) {
                setGroupActivityHint((prev) => ({
                  ...prev,
                  [eventAgentId]: `${workflowPrefix}${progressText}`,
                }));
              }

              // Detail: write graph store for member activity side panel / run graph.
              if (nodeId && callId && (phase === "calling" || phase === "done")) {
                const now = Date.now();
                useGraphRunStore.getState().applyToolStep(pane.id, nodeId, {
                  callId,
                  toolName,
                  phase,
                  startedAt: now,
                  updatedAt: now,
                });
              }
              setGroupMemberPhase((prev) => {
                if (!(eventAgentId in prev)) return prev;
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              continue;
            }
            if (payload.type === "group_blocked") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const blockedText =
                String(payload.data?.content ?? "").trim() || "等待确认后继续执行";
              const requestId = String(payload.data?.confirm_request_id ?? "").trim();
              const rawConfirmContext = payload.data?.confirm_context;
              const confirmContext =
                rawConfirmContext &&
                typeof rawConfirmContext === "object" &&
                !Array.isArray(rawConfirmContext)
                  ? (rawConfirmContext as Record<string, unknown>)
                  : undefined;
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              setGroupActivityHint((prev) => {
                if (!(eventAgentId in prev)) return prev;
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              setGroupMemberPhase((prev) => ({ ...prev, [eventAgentId]: "waiting" }));
              if (!blockedText) continue;
              const prevText = lastGroupProgressRef.current[eventAgentId] ?? "";
              if (prevText === blockedText) continue;
              lastGroupProgressRef.current[eventAgentId] = blockedText;
              const strategy = useAppStore.getState().confirmStrategy;
              if (requestId && shouldAutoApproveConfirm(strategy, false, confirmContext)) {
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
                        context: confirmContext,
                      }
                    : undefined,
                }
              );
              continue;
            }
            if (payload.type === "group_clarification") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const prompt =
                String(payload.data?.content ?? "").trim() || "等待你的输入后继续";
              const requestId = String(payload.data?.confirm_request_id ?? "").trim();
              const rawOptions = payload.data?.clarify_options;
              const options = Array.isArray(rawOptions)
                ? rawOptions.map((o) => String(o)).filter(Boolean)
                : [];
              const allowFreeText = payload.data?.clarify_allow_free_text !== false;
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              setGroupActivityHint((prev) => {
                if (!(eventAgentId in prev)) return prev;
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (!prompt || !requestId) continue;
              const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
              const dup = (pan?.messages ?? []).some(
                (m) => m.clarificationPrompt?.requestId === requestId,
              );
              if (dup) continue;
              lastGroupProgressRef.current[eventAgentId] = prompt;
              const promptPayload = {
                requestId,
                prompt,
                options,
                allowFreeText,
                agentId: eventAgentId,
                sessionId: requestSessionId,
              };
              addPaneMessageIfSessionActive(
                pane.id,
                "tool",
                prompt,
                eventAgentId,
                chatProvider,
                chatModel,
                undefined,
                {
                  avatarName,
                  avatarUrl: avatarUrl || undefined,
                  toolName: "request_clarification",
                  toolStatus: "running",
                  clarificationPrompt: promptPayload,
                  metadata: {
                    kind: "clarification",
                    request_id: requestId,
                    prompt,
                    options,
                    allow_free_text: allowFreeText,
                  },
                },
              );
              continue;
            }
            if (payload.type === "group_reply") {
              const avatarName = String(payload.data?.avatar_name ?? eventAgentId);
              const avatarUrl = String(payload.data?.avatar_url ?? "");
              const content = String(payload.data?.content ?? "");
              const errorText = String(payload.data?.error ?? "");
              const workflowRole = String(payload.data?.workflow_role ?? "").trim();
              const workflowTaskId = String(payload.data?.workflow_task_id ?? "").trim();
              const workflowAttempt = Number(payload.data?.workflow_attempt ?? 0);
              const workflowAttemptSafe = Number.isFinite(workflowAttempt) ? workflowAttempt : 0;
              const workflowStatus = String(payload.data?.workflow_status ?? "").trim();
              const workflowExtras = workflowRole
                ? {
                    metadata: {
                      kind: "group_workflow_event",
                      workflow_role: workflowRole,
                      workflow_task_id: workflowTaskId,
                      workflow_attempt: workflowAttemptSafe,
                      workflow_status: workflowStatus,
                      workflow_event: "group_reply",
                    },
                  }
                : {};
              updatePaneToolMessageForSession(`${groupProgressRunId}:group-progress:${eventAgentId}`, {
                toolStatus: errorText.trim() ? "error" : "done",
              });
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              setGroupActivityHint((prev) => {
                if (!(eventAgentId in prev)) return prev;
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              if (errorText.trim()) {
                setGroupMemberPhase((prev) => ({ ...prev, [eventAgentId]: "failed" }));
              } else {
                setGroupMemberPhase((prev) => {
                  if (!(eventAgentId in prev)) return prev;
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
              }
              if (content.trim()) {
                addPaneMessageIfSessionActive(
                  pane.id,
                  "assistant",
                  content,
                  eventAgentId,
                  chatProvider,
                  chatModel,
                  undefined,
                  { avatarName, avatarUrl: avatarUrl || undefined, ...workflowExtras }
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
                  { avatarName, avatarUrl: avatarUrl || undefined, ...workflowExtras }
                );
              }
              if (workflowRole === "reviewer" && workflowStatus.toLowerCase() === "revise") {
                addGroupWorkflowMessage({
                  content: `审核意见已返回：这个工作项需要返工，我安排原执行成员重新处理（第 ${Math.max(1, workflowAttemptSafe + 1)} 轮）。`,
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  taskId: workflowTaskId,
                  attempt: workflowAttemptSafe + 1,
                  status: "rework",
                  event: "review_rework",
                });
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
              updatePaneToolMessageForSession(`${groupProgressRunId}:group-progress:${eventAgentId}`, {
                toolStatus: "cancelled",
              });
              setGroupTyping((prev) => {
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              setGroupActivityHint((prev) => {
                if (!(eventAgentId in prev)) return prev;
                const next = { ...prev };
                delete next[eventAgentId];
                return next;
              });
              continue;
            }
            // Graph Runtime events → Run Graph panel store (do not render as chat bubbles).
            // Group SSE wraps graph payloads as { type, data: { content: "<json>" } }.
            if (typeof payload.type === "string" && payload.type.startsWith("graph.")) {
              let graphPayload: Record<string, unknown> = { type: payload.type };
              const rawContent = payload.data?.content;
              if (typeof rawContent === "string" && rawContent.trim().startsWith("{")) {
                try {
                  const inner = JSON.parse(rawContent) as Record<string, unknown>;
                  graphPayload = { ...inner, type: payload.type || inner.type };
                } catch {
                  graphPayload = { type: payload.type, content: rawContent };
                }
              } else if (payload.data && typeof payload.data === "object") {
                graphPayload = { type: payload.type, ...(payload.data as Record<string, unknown>) };
              }
              useGraphRunStore.getState().applyEvent(pane.id, graphPayload);
              const rid = String(graphPayload.run_id || "").trim();
              if (payload.type === "graph.run_created" && rid) {
                useAppStore.setState((s) => ({
                  panes: s.panes.map((row) =>
                    row.id === pane.id ? { ...row, activeGraphRunId: rid } : row,
                  ),
                }));
              }
              // Autopen only when a real task DAG exists — presence-only graphs
              // (human + agent nodes) must not steal focus in ordinary group chat.
              if (
                SHOW_DESKTOP_RUN_GRAPH &&
                (payload.type === "graph.node_updated" || payload.type === "graph.run_created") &&
                graphHasTaskNodes(useGraphRunStore.getState().byPane[pane.id]?.nodes)
              ) {
                try {
                  if (localStorage.getItem("agx-graph-panel-autopen-v1") !== "done") {
                    openWorkspaceSidebarForPane(
                      pane.id,
                      paneRef.current?.clientWidth ?? paneWidth,
                      openSidePanel,
                    );
                    setWorkPanelFocus({ kind: "graph" });
                    localStorage.setItem("agx-graph-panel-autopen-v1", "done");
                  }
                } catch {
                  /* ignore */
                }
              }
              if (payload.type === "graph.debate_nudge") {
                const tip = String(payload.data?.content ?? "").trim();
                if (tip) setDebateNudgeText(tip);
              }
              continue;
            }
            // ── workforce.* events (routing="team") ──────────────────────
            if (typeof payload.type === "string" && payload.type.startsWith("workforce.")) {
              const wfAction = payload.type.replace("workforce.", "").replace(/\./g, "_");
              const wfContent = String(payload.data?.content || "").trim();
              const wfData = payload.data || {};
              const wfRole = String(wfData.workflow_role ?? "").trim();
              const wfTaskId = String(
                wfData.workflow_task_id ?? wfData.task_id ?? "",
              ).trim();
              const wfAttempt = Number(wfData.workflow_attempt ?? 0);
              const wfStatus = String(wfData.workflow_status ?? wfAction).trim();
              const memberName = String(wfData.avatar_name ?? eventAgentId).trim() || eventAgentId;
              const memberUrl = String(wfData.avatar_url ?? "").trim();
              const description = String(
                wfData.task_description ?? wfData.description ?? wfData.content ?? "",
              ).trim();

              if (wfAction === "workforce_started") {
                // 讨论轮和执行轮的开场白必须不同。之前不论哪种模式都说「我先拆解
                // 任务、再安排执行」，用户看到的就是「明明让讨论，它却要动手」——
                // 后端已经进了只读讨论模式，界面却还在预告执行。
                groupDiscussionMode = String(wfData.mode ?? "").trim() === "discussion";
                // 模式是模型判的，把它判的理由一并显示：自动判断如果不给理由，
                // 用户就只能等它跑偏了才发现判错了。
                const modeReason = String(wfData.mode_reason ?? "").trim();
                const modeLine = groupDiscussionMode
                  ? "这轮是讨论：我请各位分别给出分析，只查资料不动手，最后由我汇总分歧和结论。"
                  : "这轮要动手：我先拆解任务，再按成员职责安排执行，最后由我汇总并收口。";
                addGroupWorkflowMessage({
                  content: modeReason ? `${modeLine}（判断依据：${modeReason}）` : modeLine,
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  status: wfStatus,
                  event: wfAction,
                });
              } else if (wfAction === "decompose_start") {
                addGroupWorkflowMessage({
                  content: groupDiscussionMode
                    ? "我正在把问题拆成几个可比的维度，分给各位分别看。"
                    : "我正在拆解任务，确认每个阶段的交付边界。",
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  taskId: wfTaskId,
                  status: wfStatus,
                  event: wfAction,
                });
              } else if (wfAction === "decompose_complete") {
                const rawSubtasks = wfData.sub_tasks ?? wfData.subtasks;
                const subtaskCount = Array.isArray(rawSubtasks)
                  ? rawSubtasks.length
                  : Number(wfData.subtasks_count ?? 0);
                addGroupWorkflowMessage({
                  content: `任务已拆为 ${Math.max(1, subtaskCount || 1)} 个工作项，接下来按成员职责执行。`,
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  taskId: wfTaskId,
                  status: wfStatus,
                  event: wfAction,
                });
              } else if (wfAction === "decompose_failed") {
                const errorText = String(wfData.error || wfContent || "无法拆解").trim();
                addGroupWorkflowMessage({
                  content: `任务拆解失败：${errorText.slice(0, 240)}`,
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  taskId: wfTaskId,
                  attempt: wfAttempt,
                  status: "failed",
                  event: wfAction,
                });
              } else if (wfAction === "task_created") {
                if (description) {
                  addGroupWorkflowMessage({
                    content: `已建立工作项：${description.slice(0, 180)}`,
                    avatarName: metaLeaderDisplayName,
                    workflowRole: "leader",
                    taskId: wfTaskId,
                    status: wfStatus,
                    event: wfAction,
                  });
                }
              } else if (wfAction === "task_assigned") {
                if (description) {
                  addGroupWorkflowMessage({
                    content: `我把这项工作交给 ${memberName}：${description.slice(0, 220)}`,
                    avatarName: metaLeaderDisplayName,
                    workflowRole: "leader",
                    taskId: wfTaskId,
                    status: wfStatus,
                    event: wfAction,
                  });
                }
              } else if (wfAction === "task_started") {
                setGroupTyping((prev) => ({ ...prev, [eventAgentId]: memberName }));
                setGroupActivityHint((prev) => ({
                  ...prev,
                  [eventAgentId]: description ? `执行中：${description.slice(0, 180)}` : "执行中",
                }));
                setGroupMemberPhase((prev) => {
                  if (!(eventAgentId in prev)) return prev;
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
              } else if (wfAction === "task_completed") {
                setGroupTyping((prev) => {
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
                setGroupActivityHint((prev) => {
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
                addGroupWorkflowMessage({
                  content: `${memberName} 已完成工作项，审核通过，进入下一阶段。`,
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  taskId: wfTaskId,
                  attempt: wfAttempt,
                  status: wfStatus,
                  event: wfAction,
                });
              } else if (wfAction === "task_failed" || wfAction === "task_skipped") {
                setGroupTyping((prev) => {
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
                setGroupActivityHint((prev) => {
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
                const reason = String(wfData.error || wfContent || "未完成").trim();
                addGroupWorkflowMessage({
                  content: `${memberName} 的工作项${wfAction === "task_skipped" ? "已跳过" : "失败"}：${reason.slice(0, 220)}`,
                  avatarName: metaLeaderDisplayName,
                  workflowRole: "leader",
                  taskId: wfTaskId,
                  attempt: wfAttempt,
                  status: wfAction === "task_skipped" ? "skipped" : "failed",
                  event: wfAction,
                });
              } else if (wfAction === "assistant_message" || wfAction === "message_assistant") {
                setGroupTyping((prev) => {
                  const next = { ...prev };
                  delete next[eventAgentId];
                  return next;
                });
                if (wfContent) {
                  const messageRole =
                    wfRole === "executor" ? "executor" :
                    wfRole === "reviewer" ? "reviewer" :
                    wfRole === "leader" ? "leader" : "system";
                  addGroupWorkflowMessage({
                    content: wfContent,
                    agentId: eventAgentId,
                    avatarName: memberName,
                    avatarUrl: memberUrl,
                    workflowRole: messageRole,
                    taskId: wfTaskId,
                    attempt: wfAttempt,
                    status: wfStatus,
                    event: wfAction,
                  });
                }
              } else if (wfAction === "workforce_stopped") {
                setGroupTyping({});
                setGroupActivityHint({});
              }
              continue;
            }
            if (payload.type === "tool_progress") {
              recordProgressActivity(requestSessionId);
              const progressPhase = String(payload.data?.phase ?? "");
              if (progressPhase === "stall_patient_wait") {
                if (sessionStillActive) {
                  const info = parseStallWaitPayload(payload.data, Date.now());
                  if (info) setStallWait(info);
                }
                continue;
              }
              if (progressPhase === "stall_patient_recovered") {
                if (sessionStillActive) setStallWait(null);
                continue;
              }
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
                updatePaneToolMessageForSession(progressCallId, patch);
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
                setStallWait(null);
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
              setStallWait(null);
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
                  if (toolCallId) {
                    toolCallMetadata.set(toolCallId, {
                      toolName: toolNameStr,
                      toolArgs,
                      toolGroupId,
                    });
                  }
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
                      preserveStreamReasoningAtToolBoundary();
                      full = "";
                      streamReasoningStartedAt = null;
                      streamCommitRegistryRef.current.resetTurnSegment(requestSessionId);
                      cancelStreamRenderFrame();
                      scheduleStreamTextUpdate("");
                      continue;
                    }
                  }
                  preserveStreamReasoningAtToolBoundary();
                  full = "";
                  streamReasoningStartedAt = null;
                  streamCommitRegistryRef.current.resetTurnSegment(requestSessionId);
                  cancelStreamRenderFrame();
                  scheduleStreamTextUpdate("");
                  if (toolCallId) {
                    const merged = updatePaneToolMessageForSession(toolCallId, {
                      content,
                      toolName: toolNameStr,
                      toolArgs,
                      toolStatus: "running",
                    });
                    if (!merged) {
                      addPaneMessageIfSessionActive(
                        pane.id,
                        "tool",
                        content,
                        "meta",
                        undefined,
                        undefined,
                        undefined,
                        {
                          toolCallId,
                          toolName: toolNameStr,
                          toolArgs,
                          toolStatus: "running",
                          toolGroupId,
                        }
                      );
                    }
                    const pendingPatch = pendingToolResults[toolCallId];
                    if (pendingPatch) {
                      const reconciled = isTargetSessionStillActive()
                        ? updatePaneToolMessageForSession(toolCallId, pendingPatch.patch)
                        : mergePendingToolResultIntoDeferred(pendingPatch);
                      if (reconciled) delete pendingToolResults[toolCallId];
                    }
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
            if (payload.type === "tool_call_delta") {
              if (eventAgentId !== "meta") continue;
              const toolNameStr = String(payload.data?.name ?? "").trim();
              if (toolNameStr !== "show_widget") continue;
              const toolCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              if (!toolCallId) continue;
              const argumentsRaw = String(payload.data?.arguments_raw ?? "");
              const partial = extractPartialShowWidgetArgs(argumentsRaw);
              if (!partial) continue;
              scheduleShowWidgetDelta(toolCallId, {
                argumentsRaw,
                title: partial.title || undefined,
                widgetCode: partial.widgetCode || undefined,
              });
              continue;
            }
            if (payload.type === "tool_result") {
              const toolName = String(payload.data?.name ?? payload.data?.tool_name ?? "");
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
              if (toolName === "create_avatar") {
                try {
                  const rawResult = payload.data?.result;
                  const parsed =
                    typeof rawResult === "string"
                      ? (JSON.parse(rawResult) as Record<string, unknown>)
                      : (rawResult as Record<string, unknown> | null | undefined);
                  const avatarId = String(parsed?.avatar_id ?? "").trim();
                  if (parsed && parsed.ok && avatarId) {
                    window.dispatchEvent(
                      new CustomEvent("agenticx:avatars:changed", {
                        detail: {
                          avatarId,
                          name: String(parsed.name ?? "").trim(),
                          openPane: true,
                        },
                      })
                    );
                  }
                } catch {
                  // Ignore parse errors; tool card still renders via formatter.
                }
              }
              if (toolName === "create_group_chat") {
                try {
                  const rawResult = payload.data?.result;
                  const parsed =
                    typeof rawResult === "string"
                      ? (JSON.parse(rawResult) as Record<string, unknown>)
                      : (rawResult as Record<string, unknown> | null | undefined);
                  if (parsed && parsed.ok) {
                    const group = parsed.group as Record<string, unknown> | undefined;
                    window.dispatchEvent(
                      new CustomEvent("agenticx:groups:changed", {
                        detail: { groupId: String(group?.id ?? "").trim() },
                      })
                    );
                  }
                } catch {
                  // Ignore parse errors; tool card still renders via formatter.
                }
              }
              const formatted = formatToolResultMessage(toolName, payload.data?.result, settings.providers);
              if (formatted.silent) continue;
              const resultCallId = String(payload.data?.tool_call_id ?? payload.data?.id ?? "").trim();
              const rawContent = serializeToolResultRaw(payload.data?.result);
              const preview = formatted.content.replace(/\s+/g, " ").trim().slice(0, 160);
              const mergedStatus = payload.data?.is_error === true
                ? "error"
                : deriveToolStatusFromResult(payload.data?.result);
              if (eventAgentId === "meta") {
                const resultPatch = {
                  content: rawContent,
                  toolStatus: mergedStatus,
                  toolResultPreview: preview,
                  toolStreamLines: [],
                };
                let merged = resultCallId
                  ? updatePaneToolMessageForSession(resultCallId, resultPatch)
                  : false;
                if (!merged) {
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
                    merged = updatePaneToolMessageForSession(fallbackCallId, resultPatch);
                  }
                }
                if (!merged && resultCallId) {
                  const callMetadata = toolCallMetadata.get(resultCallId);
                  pendingToolResults[resultCallId] = {
                    callId: resultCallId,
                    toolName: resolvePendingToolName(
                      callMetadata?.toolName,
                      toolName,
                      resultCallId,
                    ),
                    toolArgs: callMetadata?.toolArgs,
                    toolGroupId: callMetadata?.toolGroupId,
                    patch: resultPatch,
                  };
                  merged = true;
                }
                if (!merged && !shouldSkipFormattedToolResultFallback(formatted.content, rawContent)) {
                  addPaneMessageIfSessionActive(
                    pane.id,
                    "tool",
                    rawContent || formatted.content,
                    "meta",
                    undefined,
                    undefined,
                    undefined,
                    {
                      toolCallId: resultCallId || undefined,
                      toolName: toolName || undefined,
                      toolStatus: mergedStatus,
                      toolResultPreview: preview,
                    },
                  );
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
              const actionConfirm =
                clarifyContext && typeof clarifyContext === "object"
                  ? parseActionConfirmationContext({
                      requestId: clarifyReqId,
                      sessionId: requestSessionId,
                      agentId: eventAgentId === "meta" ? "meta" : eventAgentId,
                      context: clarifyContext,
                      status: "pending",
                    })
                  : null;

              // Generic action confirmation: dedicated card, do not open ClarificationDialog.
              if (actionConfirm && eventAgentId === "meta" && clarifyReqId) {
                const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
                const running = findRunningActionConfirmationToolMessage(pan?.messages ?? []);
                const metaPatch = {
                  content: actionConfirm.title,
                  actionConfirmation: actionConfirm,
                  clarificationPrompt: undefined,
                  metadata: {
                    kind: "clarification",
                    request_id: clarifyReqId,
                    prompt: actionConfirm.title,
                    options: [actionConfirm.approveLabel, actionConfirm.rejectLabel],
                    allow_free_text: true,
                    context: {
                      kind: "action_confirmation",
                      title: actionConfirm.title,
                      summary: actionConfirm.summary,
                      approve_label: actionConfirm.approveLabel,
                      reject_label: actionConfirm.rejectLabel,
                      expires_at_ms: actionConfirm.expiresAtMs,
                      ...(actionConfirm.source ? { source: actionConfirm.source } : {}),
                    },
                  },
                };
                if (running?.toolCallId) {
                  updatePaneToolMessageForSession(running.toolCallId, metaPatch);
                } else {
                  const dup = (pan?.messages ?? []).some(
                    (m) => m.actionConfirmation?.requestId === clarifyReqId,
                  );
                  if (!dup) {
                    addPaneMessageIfSessionActive(
                      pane.id,
                      "tool",
                      actionConfirm.title,
                      "meta",
                      undefined,
                      undefined,
                      undefined,
                      {
                        toolName: "request_action_confirmation",
                        toolStatus: "running",
                        toolArgs: {
                          title: actionConfirm.title,
                          summary: actionConfirm.summary,
                          approve_label: actionConfirm.approveLabel,
                          reject_label: actionConfirm.rejectLabel,
                          source: actionConfirm.source,
                        },
                        actionConfirmation: actionConfirm,
                        metadata: metaPatch.metadata,
                      },
                    );
                  }
                }
                continue;
              }

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
                  updatePaneToolMessageForSession(running.toolCallId, metaPatch);
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
              setStallWait(null);
              if (eventAgentId === "meta") {
                useAppStore.getState().clearSessionHistoryHint(requestSessionId);
                const normalizedFinal = normalizeFinalAssistantPayload(
                  payload.data?.text,
                  payload.data?.suggested_questions,
                  payload.data?.turn_terminal,
                  payload.data?.terminal_reason,
                );
                const finalText = normalizedFinal.text;
                pendingSuggestedQuestions = normalizedFinal.suggestedQuestions;
                pendingFinalTurnTerminal = normalizedFinal.turnTerminal;
                pendingFinalTerminalReason = normalizedFinal.terminalReason;
                const appliedRefs = applyFinalReferencePayload(
                  pendingReferences,
                  pendingSearchedQueries,
                  payload.data,
                );
                pendingReferences = appliedRefs.references;
                pendingSearchedQueries = appliedRefs.queries;
                const finalReasoningRaw = payload.data?.reasoning;
                if (typeof finalReasoningRaw === "string" && finalReasoningRaw.trim()) {
                  const candidate = finalReasoningRaw.trim().slice(0, 16384);
                  // GLM may echo the public answer into reasoning_content; drop it.
                  if (!reasoningDuplicatesVisibleBody(candidate, finalText)) {
                    pendingReasoning = candidate;
                  }
                }
                const finalReasoningSecondsRaw = payload.data?.reasoning_seconds;
                if (
                  typeof finalReasoningSecondsRaw === "number" &&
                  finalReasoningSecondsRaw >= 1 &&
                  pendingReasoning
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
                } else if (!assistantVisibleBodyForUi(full).trim()) {
                  full = "";
                  cumulativeFull = "";
                  pendingSuggestedQuestions = [];
                  void mergeTailFromDisk(requestSessionId);
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
              if ((inp > 0 || out > 0) && isTargetSessionStillActive()) {
                useAppStore.getState().accumulatePaneTokens(pane.id, inp, out);
              }
            }
            if (payload.type === "compaction") {
              // FR-3: surface context compaction so users do not learn about it
              // only when the model later "explains" it as a failure cause.
              const count = Number(payload.data?.compacted_count ?? 0) || 0;
              const reactive = Boolean(payload.data?.reactive);
              const summary = typeof payload.data?.summary === "string" ? payload.data.summary : "";
              const notice = buildCompactionEventNotice(count, reactive, summary);
              addPaneMessageIfSessionActive(pane.id, "tool", notice.text, eventAgentId || "meta", undefined, undefined, undefined, {
                noticeKind: notice.noticeKind,
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
              setStallWait(null);
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
                receivedBudgetExceededEvent = true;
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
                const warningLevel = String(payload.data?.warning_level ?? "").trim();
                const noticeKind = noticeKindForRuntimeWarning(detector, warningLevel);
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
                // Merge tool-scoped errors into the existing ToolCallCard when possible
                // (hook-block / not-loaded / permission deny all share tool_call_id).
                const errToolCallId = String(payload.data?.tool_call_id ?? "").trim();
                if (errToolCallId) {
                  const merged = updatePaneToolMessageForSession(errToolCallId, {
                    content: errText,
                    toolStatus: "error",
                    toolResultPreview: errText.slice(0, 120),
                    toolStreamLines: [],
                  });
                  if (!merged) {
                    addPaneMessageIfSessionActive(pane.id, "tool", `❌ ${errText}`, "meta");
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

      // Reconcile every tool result before committing the terminal assistant row.
      // This keeps the live message order identical to messages.json after reload.
      flushPendingToolResults();
      const trimmedFull = full.trim();
      syncTurnRefsSnapshot();
      const refExtras = referenceExtrasFromTurn(pendingReferences, pendingSearchedQueries);
      const sugExtras =
        pendingSuggestedQuestions.length > 0
          ? { suggestedQuestions: pendingSuggestedQuestions.slice(0, 3) }
          : undefined;
      const reasoningExtras: Record<string, unknown> = {};
      if (
        pendingReasoning &&
        !reasoningDuplicatesVisibleBody(pendingReasoning, full)
      ) {
        reasoningExtras.reasoning = pendingReasoning;
        if (pendingReasoningSeconds !== undefined)
          reasoningExtras.reasoningSeconds = pendingReasoningSeconds;
      }
      const terminalMetaExtras: Record<string, unknown> = receivedFinalEvent
        ? {
            metadata: {
              turn_terminal: pendingFinalTurnTerminal,
              ...(pendingFinalTerminalReason
                ? { terminal_reason: pendingFinalTerminalReason }
                : {}),
            },
          }
        : { metadata: { turn_terminal: false } };
      const turnExtras =
        refExtras || sugExtras || Object.keys(reasoningExtras).length > 0 || receivedFinalEvent
          ? { ...refExtras, ...sugExtras, ...reasoningExtras, ...terminalMetaExtras }
          : undefined;
      const completedAt = Date.now();
      const stampLastAssistantCompletedAt = () => {
        mergeLastAssistantIfSessionActive({
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
          mergeLastAssistantIfSessionActive({
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
        const committedPatch = buildCommittedAssistantPatch(
          full,
          turnExtras,
          receivedFinalEvent,
        );
        if (committedPatch) {
          mergeLastAssistantIfSessionActive({
            ...committedPatch,
            timestamp: completedAt,
          });
        } else {
          stampLastAssistantCompletedAt();
        }
      } else if (
        !abortController.signal.aborted &&
        !receivedFinalEvent &&
        !receivedBudgetExceededEvent
      ) {
        // Backend persists turn_interrupted to messages.json; toast is ephemeral.
        setStallHintToast(TURN_INTERRUPTED_TOAST);
        await mergeTailFromDisk(requestSessionId);
      }
    } catch (error) {
      if (isContinuation) {
        clearResumeInFlight(requestSessionId);
      }
      // Keep terminal ordering stable on exceptional exits as well: any real
      // tool result belongs before the request-level failure notice.
      flushPendingToolResults();
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        addPaneMessageIfSessionActive(pane.id, "tool", `❌ 请求失败: ${String(error)}`, "meta");
      }
    } finally {
      // Safety net for malformed/aborted streams. The normal completion path
      // already drains this before FINAL, so this is an idempotent no-op there.
      flushPendingToolResults();
      for (const timer of showWidgetDeltaTimers.values()) {
        window.clearTimeout(timer);
      }
      showWidgetDeltaTimers.clear();
      showWidgetDeltaPending.clear();
      releaseSendLock();

      // Barge-in replaces this run's AbortController with a newer one for the
      // same session_id. Only the owner of the current controller may clear
      // stream state / registry / queue — otherwise the old finally clobbers
      // the new force-send turn.
      const stillOwnsStream =
        sessionAbortControllersRef.current[requestSessionId] === abortController;

      let nextQueued: QueuedMessage | null = null;
      if (stillOwnsStream) {
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
        nextQueued = useAppStore.getState().dequeuePaneMessageForSession(
          pane.id,
          requestSessionId,
        );

        if (isTargetSessionStillActive()) {
          const refPatch = referenceExtrasFromTurn(
            turnRefsSnapshot.references,
            turnRefsSnapshot.queries,
          );
          if (refPatch && !abortController.signal.aborted) {
            mergeLastAssistantIfSessionActive(refPatch);
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
          streamTextRef.current = "";
        }
        setGroupTyping({});
        setGroupActivityHint({});
        setGroupMemberPhase({});
        const displayedSessionId =
          useAppStore.getState().panes.find((item) => item.id === pane.id)?.sessionId?.trim() ?? "";
        if (displayedSessionId === requestSessionId) {
          contextFilesRef.current = {};
          setContextFiles({});
        }
        if (!abortController.signal.aborted) {
          useAppStore.getState().clearSessionHistoryHint(requestSessionId);
        }
        invalidateSessionTail(requestSessionId);
        useAppStore.getState().dropCachedSessionMessages(requestSessionId);
        void mergeTailFromDisk(requestSessionId);
      }

      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
      cancelStreamRenderFrame();
      useAppStore.getState().bumpSessionCatalogRevision();
      window.setTimeout(() => useAppStore.getState().bumpSessionCatalogRevision(), 500);

      if (nextQueued) {
        requestAnimationFrame(() => {
          void sendChatRef.current(nextQueued.text, {
            lockedSessionId: requestSessionId,
            retryAttachments: nextQueued.attachments,
            queueDrain: true,
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
    const avatarId = sessionCreateAvatarId(pane.avatarId);
    const pendingMode = peekPanePendingSessionMode(pane.id) ?? pane.sessionMode ?? "daily_office";
    try {
      const result = await window.agenticxDesktop.createSession({
        avatar_id: avatarId,
        session_mode: pendingMode,
        ...(inherit && prevSessionId ? { inherit_from_session_id: prevSessionId } : {}),
        ...(chatProvider && chatModel ? { provider: chatProvider, model: chatModel } : {}),
      });
      if (result.ok && result.session_id) {
        migrateActiveComposerDraftToSession(result.session_id);
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

  const createNewTopic = (
    inherit = true,
    sessionMode: PaneSessionMode = "daily_office",
    initialDraft = "",
  ) => {
    const prevSessionId = (pane.sessionId || "").trim();
    activateFreshComposerDraft(initialDraft);
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
    if (isGroupPane || isAutomationTaskPane) {
      // Group/automation UI requires a bound session_id (no lazy empty composer).
      // Eager create with the pane's group:/automation: avatar_id.
      void initSession(inherit, prevSessionId || undefined);
      return;
    }
    // Meta/avatar: defer createSession until the first send so an empty session
    // never appears in the history sidebar with an id-only title.
  };

  resumeInNewSessionRef.current = () => {
    const draft = buildBudgetResumeDraft(pane.messages ?? []);
    createNewTopic(false, pane.sessionMode ?? "daily_office", draft);
    setBudgetExceededInfo(null);
  };

  // "新建任务" nav button dispatches this event to start a fresh conversation
  // in the targeted (meta) pane. Use a ref so the listener always calls the
  // latest createNewTopic closure without re-subscribing each render.
  const createNewTopicRef = useRef(createNewTopic);
  createNewTopicRef.current = createNewTopic;
  useEffect(() => {
    const onNewTopic = (e: Event) => {
      const detail = (e as CustomEvent).detail as { paneId?: string; draftText?: string } | undefined;
      if (detail?.paneId && detail.paneId !== pane.id) return;
      createNewTopicRef.current(
        false,
        pane.sessionMode ?? "daily_office",
        detail?.draftText ?? "",
      );
    };
    window.addEventListener("agenticx:pane:new-topic", onNewTopic);
    return () => window.removeEventListener("agenticx:pane:new-topic", onNewTopic);
  }, [pane.id, pane.sessionMode]);

  const insertGlobalSearchFileReference = useCallback(
    async (filePath: string, mode: "current" | "new") => {
      const trimmed = filePath.trim();
      if (!trimmed) return;

      if (mode === "new") {
        activateFreshComposerDraft();
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
      activateFreshComposerDraft,
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

  const maxTaskspaceWidth =
    paneWidth > 0
      ? Math.max(
          240,
          Math.min(
            Math.floor(paneWidth * TASKSPACE_MAX_WIDTH_RATIO),
            paneWidth - CHAT_COLUMN_MIN_WIDTH,
          ),
        )
      : 720;
  const minTaskspaceWidth = 220;
  /**
   * Trae Work expand: work panel becomes the main canvas (flex-1);
   * chat collapses to a floating bottom composer — not a squeezed left column.
   */
  const workExpandedLayout = workPanelExpanded && workspacePanelOpen;
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

  async function resolveActionConfirmation(
    confirmation: PendingActionConfirmation,
    decision: ActionConfirmationDecision,
    _source: "button" | "manual" = "button",
  ): Promise<void> {
    if (!apiBase || !apiToken) return;
    const paneSessionId = (pane.sessionId || "").trim();
    if (!paneSessionId || paneSessionId !== String(confirmation.sessionId || "").trim()) return;

    const patchAction = (status: PendingActionConfirmation["status"], error?: string) => {
      const pan = useAppStore.getState().panes.find((p) => p.id === pane.id);
      if (!pan) return;
      setPaneMessages(
        pane.id,
        (pan.messages ?? []).map((msg) => {
          if (msg.actionConfirmation?.requestId !== confirmation.requestId) return msg;
          return {
            ...msg,
            actionConfirmation: {
              ...msg.actionConfirmation!,
              status,
              ...(error !== undefined ? { error } : { error: undefined }),
            },
            ...(status === "approved" || status === "rejected" || status === "expired"
              ? { toolStatus: "done" as const }
              : {}),
          };
        }),
      );
    };

    const current = (useAppStore.getState().panes.find((p) => p.id === pane.id)?.messages ?? []).find(
      (m) => m.actionConfirmation?.requestId === confirmation.requestId,
    )?.actionConfirmation;
    if (!current || current.status === "resolving" || current.status === "approved" || current.status === "rejected") {
      return;
    }
    if (current.status === "uncertain" || current.status === "expired") return;

    patchAction("resolving");
    const answer = buildActionConfirmationAnswer(confirmation, decision);
    try {
      const res = await fetch(`${apiBase}/api/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({
          session_id: confirmation.sessionId,
          request_id: confirmation.requestId,
          agent_id: confirmation.agentId || "meta",
          answer_text: answer.answerText,
          selected_options: answer.selectedOptions,
        }),
      });
      if (res.status === 404) {
        patchAction("expired", "确认请求已失效或不存在");
        return;
      }
      if (!res.ok) {
        patchAction("uncertain", `确认提交失败（HTTP ${res.status}）`);
        return;
      }
      patchAction(decision === "approved" ? "approved" : "rejected");
      useAppStore.getState().markClarificationAnswered(confirmation.requestId, answer);
    } catch {
      patchAction("uncertain", "网络异常，请求可能已送达");
    }
  }

  const paneTint = (() => {
    if (!pane.avatarId) return undefined;
    // Group chat: same as Meta — page surface, no per-group tint wash.
    if (pane.avatarId.startsWith("group:")) return undefined;
    const avatarColor = avatars.find((a) => a.id === pane.avatarId)?.color;
    return avatarTintBg(pane.avatarId, avatarColor);
  })();

  useEffect(() => {
    // 历史面板已改为不挤占布局的锚定浮层（不再计入互斥占位），此处仅在工作区/记忆图谱/
    // 运行图/Spawns/落盘 drawer 之间做单选互斥（窄窗格 overlay 模式）。
    // 群成员已迁入工作台 tab，不再占用独立右侧面板。
    if (!compactSidePanels) return;
    const p = pane;
    const stacked =
      Number(!!p.taskspacePanelOpen) +
      Number(!!p.memoryGraphOpen) +
      Number(!!p.graphPanelOpen) +
      Number(!!p.spawnsColumnOpen) +
      Number(!!p.runDrawerOpen);
    if (stacked <= 1) return;
    let keep:
      | "workspace"
      | "memory-graph"
      | "graph"
      | "spawns"
      | "run-drawer" = "run-drawer";
    if (p.runDrawerOpen) keep = "run-drawer";
    else if (p.graphPanelOpen) keep = "graph";
    else if (p.taskspacePanelOpen) keep = "workspace";
    else if (p.memoryGraphOpen) keep = "memory-graph";
    else keep = "spawns";
    const desired = {
      taskspacePanelOpen: keep === "workspace",
      memoryGraphOpen: keep === "memory-graph",
      graphPanelOpen: keep === "graph",
      spawnsColumnOpen: keep === "spawns",
      runDrawerOpen: keep === "run-drawer",
    };
    useAppStore.setState((s) => {
      const row = s.panes.find((r) => r.id === p.id);
      if (!row) return s;
      if (
        row.taskspacePanelOpen === desired.taskspacePanelOpen &&
        row.memoryGraphOpen === desired.memoryGraphOpen &&
        !!row.graphPanelOpen === desired.graphPanelOpen &&
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
    pane.graphPanelOpen,
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
              graphPanelOpen: false,
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
    setWorkPanelExpanded(false);
    useAppStore.setState((s) => ({
      panes: s.panes.map((row) => (row.id !== pane.id ? row : { ...row, taskspacePanelOpen: false })),
    }));
  };

  const toggleWorkPanelExpand = () => {
    setWorkPanelExpanded((prev) => !prev);
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
      else setWorkPanelExpanded(false);
      cycleSidePanel(pane.id, "workspace");
      return;
    }
    const opening = !pane.taskspacePanelOpen;
    if (!opening) setWorkPanelExpanded(false);
    useAppStore.setState((s) => ({
      panes: s.panes.map((p) => {
        if (p.id !== pane.id) return p;
        return opening
          ? {
              ...p,
              taskspacePanelOpen: true,
              sidePanelTab: "workspace",
              historyOpen: false,
              memoryGraphOpen: false,
              membersPanelOpen: false,
              graphPanelOpen: false,
              spawnsColumnOpen: false,
            }
          : { ...p, taskspacePanelOpen: false };
      }),
    }));
  };

  /** Trae-aligned: ⌘⌃B toggles the work expansion panel for the active pane. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.key === "b" || event.key === "B") ||
        !event.metaKey ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const activePaneId = useAppStore.getState().activePaneId;
      if (activePaneId !== pane.id) return;
      event.preventDefault();
      const current = useAppStore.getState().panes.find((p) => p.id === pane.id);
      if (!current) return;
      const paneOuter = paneRef.current?.clientWidth ?? 0;
      const compact = paneOuter > 0 && paneOuter < CHATPANE_SIDE_OVERLAY_BREAK;
      if (!compact) {
        if (!current.taskspacePanelOpen) {
          useAppStore.setState((s) => ({
            panes: s.panes.map((row) =>
              row.id !== pane.id ? row : { ...row, historyOpen: false }
            ),
          }));
        } else {
          setWorkPanelExpanded(false);
        }
        useAppStore.getState().cycleSidePanel(pane.id, "workspace");
        return;
      }
      const opening = !current.taskspacePanelOpen;
      if (!opening) setWorkPanelExpanded(false);
      useAppStore.setState((s) => ({
        panes: s.panes.map((p) => {
          if (p.id !== pane.id) return p;
          return opening
            ? {
                ...p,
                taskspacePanelOpen: true,
                sidePanelTab: "workspace" as const,
                historyOpen: false,
                memoryGraphOpen: false,
                membersPanelOpen: false,
                graphPanelOpen: false,
                spawnsColumnOpen: false,
              }
            : { ...p, taskspacePanelOpen: false };
        }),
      }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pane.id]);

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

  const integratedToolbarNode = integratedToolbar && focused ? (
    <div className="agx-pane-toolbar agx-pane-toolbar--integrated relative flex shrink-0 items-center justify-between gap-3 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {onToggleSidebar ? (
          <div className="agx-topbar-left shrink-0">
            <TopbarContextControls
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={onToggleSidebar}
            />
          </div>
        ) : null}
        {pane.contextInherited ? (
          <span className="shrink-0 rounded bg-emerald-500/20 px-1 text-[10px] text-emerald-400">
            已继承
          </span>
        ) : null}
      </div>
      <div className="agx-pane-toolbar-actions no-drag flex shrink-0 items-center gap-1">
        {sessionFindOpen ? (
          <div
            className="agx-pane-session-find flex h-8 items-center gap-1 rounded-lg border border-border bg-surface-card px-1.5 shadow-sm"
            role="search"
            aria-label="会话内搜索"
          >
            <TextSearch className="ml-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
            <input
              ref={sessionFindInputRef}
              type="search"
              value={sessionFindQuery}
              onChange={(event) => {
                sessionFindActiveIndexRef.current = 0;
                setSessionFindMatchIndex(0);
                setSessionFindQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  stepSessionFindMatch(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeSessionFind();
                }
              }}
              placeholder="搜索…"
              className="w-[112px] bg-transparent text-[12px] text-text-strong outline-none placeholder:text-text-faint"
              aria-label="在当前会话中搜索"
            />
            <span className="min-w-[2.25rem] shrink-0 text-center text-[11px] tabular-nums text-text-faint">
              {sessionFindQuery.trim()
                ? sessionFindMatchCount > 0
                  ? `${sessionFindMatchIndex + 1}/${sessionFindMatchCount}`
                  : "0/0"
                : ""}
            </span>
            <button
              type="button"
              className="rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-30"
              disabled={sessionFindMatchCount <= 0}
              onClick={() => stepSessionFindMatch(-1)}
              title="上一个匹配"
              aria-label="上一个匹配"
            >
              <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-30"
              disabled={sessionFindMatchCount <= 0}
              onClick={() => stepSessionFindMatch(1)}
              title="下一个匹配"
              aria-label="下一个匹配"
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
              onClick={closeSessionFind}
              title="关闭搜索"
              aria-label="关闭搜索"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="agx-topbar-btn !px-[5px]"
            onClick={openSessionFind}
            title={
              typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
                ? "会话内搜索 (⌘F)"
                : "会话内搜索 (Ctrl+F)"
            }
            aria-label="会话内搜索"
          >
            <TextSearch className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        )}
        <button
          ref={historyButtonRef}
          type="button"
          className={`agx-topbar-btn !px-[5px] ${pane.historyOpen ? "agx-topbar-btn--active" : ""}`}
          onClick={toggleHistorySidePanel}
          title="本对话提问目录"
          aria-label="本对话提问目录"
        >
          <ListTree className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <HoverTip label="工作台 · ⌘⌃B">
          <button
            type="button"
            className={`agx-topbar-btn !px-[5px] ${workspacePanelOpen ? "agx-topbar-btn--active" : ""}`}
            onClick={toggleWorkspaceSidePanel}
            title="工作台"
            aria-label="工作台"
            aria-pressed={workspacePanelOpen}
          >
            <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </HoverTip>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
        <TopbarGlobalActions showUsageDashboard={false} />
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={paneRef}
      className={`relative agx-chatpane flex h-full min-w-0 flex-1 bg-surface-base ${
        integratedToolbar ? "flex-col" : ""
      } ${
        workExpandedLayout ? "agx-chatpane--work-expanded" : ""
      }`}
      onMouseDown={onFocus}
    >
      {routingNotice ? (
        <div
          role="status"
          className="pointer-events-auto absolute inset-x-0 top-3 z-[70] mx-auto w-full max-w-md rounded-xl border border-border bg-surface-card px-4 py-3 shadow-lg"
        >
          <div className="text-sm font-medium text-text-primary">已切换到私有部署模型</div>
          <p className="mt-1 text-xs leading-5 text-text-subtle">
            {routingLockReason(routingNotice)}
            本会话后续对话都会留在这个模型上。
          </p>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            {/* 「不再显示」只静音这个弹窗；模型选择器仍然是灰的、hover 仍然给理由。
                被切走的是数据流向，不是一个 UI 偏好。 */}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-faint">
              <input
                type="checkbox"
                className="h-3 w-3 accent-[var(--settings-accent-fg)]"
                onChange={(event) => {
                  if (event.target.checked) dismissRoutingNotice();
                }}
              />
              不再显示此提示
            </label>
            <button
              type="button"
              className="rounded-lg bg-surface-hover px-3 py-1 text-xs text-text-standard transition-colors hover:bg-surface-card-strong"
              onClick={() => setRoutingNotice(null)}
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}
      {integratedToolbarNode}
      <div className={integratedToolbar ? "relative flex min-h-0 min-w-0 flex-1" : "contents"}>
      <div
        className={
          workExpandedLayout
            ? "pointer-events-none absolute inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-3 sm:px-6"
            : "agx-chatpane-main-column flex h-full min-w-0 flex-1 flex-col"
        }
        style={workExpandedLayout ? undefined : { minWidth: CHAT_COLUMN_MIN_WIDTH }}
      >
        <div
          className={
            workExpandedLayout
              ? "pointer-events-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-card/95 shadow-[0_16px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl"
              : "contents"
          }
        >
        {!workExpandedLayout && !integratedToolbar ? (
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
                {isGroupPane ? (
                  groupMembers.length > 0 ? (
                    <span className="flex shrink-0 -space-x-1" aria-hidden>
                      {groupMembers.slice(0, 3).map((member) => (
                        <GroupMemberAvatar
                          key={member.id}
                          avatar={member}
                          size="xs"
                          className="ring-2 ring-surface-base"
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--theme-color-rgb,59,130,246),0.14)] text-[rgb(var(--theme-color-fg-rgb,59,130,246))]" aria-hidden>
                      <UsersRound className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                  )
                ) : null}
                <span className="shrink-0">{paneAvatarMeta.name}</span>
                {isGroupPane && activeGroup ? (
                  <span className="shrink-0 rounded-full bg-surface-card px-1.5 py-0.5 text-[9px] font-normal text-text-faint">
                    {activeGroup.avatarIds.length} 位成员
                  </span>
                ) : null}
                {(pane.sessionId || "").trim() ? (
                  <span
                    className="select-all font-mono text-[9px] font-normal leading-snug text-text-faint"
                    title="会话 ID（便于排查）"
                  >
                    {(pane.sessionId || "").trim()}
                  </span>
                ) : null}
                {SHOW_DESKTOP_EXTERNAL_IM && shouldShowFeishuBadge && (
                  <FeishuBadge variant="topbar" />
                )}
                {SHOW_DESKTOP_EXTERNAL_IM && shouldShowWechatBadge && (
                  <span
                    className="inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium leading-tight"
                    style={{ backgroundColor: "rgba(37,211,102,0.15)", color: "#25D366" }}
                  >
                    微信
                  </span>
                )}
              </div>
              {isGroupPane && activeGroup ? (
                <div className="flex items-center gap-1.5 truncate text-[10px] text-text-faint">
                  <span className="text-text-subtle">自动协作</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">
                    {groupMembers
                      .slice(0, 3)
                      .map((member) => member.name)
                      .join("、") || "等待加入成员"}
                    {groupMembers.length > 3 ? ` 等 ${groupMembers.length} 人` : ""}
                  </span>
                </div>
              ) : null}
              {pane.contextInherited ? (
                <div className="flex items-center gap-1.5 truncate text-[10px] text-text-faint">
                  <span className="rounded bg-emerald-500/20 px-1 text-emerald-400">已继承</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            {SHOW_DESKTOP_MULTI_PANE ? (
              <NewTopicButton onNewTopic={createNewTopic} triggerLabel={newTopicLabel} />
            ) : null}
            {sessionFindOpen ? (
              <div
                className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface-card px-1.5 shadow-sm"
                role="search"
                aria-label="会话内搜索"
              >
                <Search className="ml-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
                <input
                  ref={sessionFindInputRef}
                  type="search"
                  value={sessionFindQuery}
                  onChange={(e) => {
                    sessionFindActiveIndexRef.current = 0;
                    setSessionFindMatchIndex(0);
                    setSessionFindQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      stepSessionFindMatch(e.shiftKey ? -1 : 1);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      closeSessionFind();
                    }
                  }}
                  placeholder="搜索…"
                  className="w-[112px] bg-transparent text-[12px] text-text-strong outline-none placeholder:text-text-faint"
                  aria-label="在当前会话中搜索"
                />
                <span className="min-w-[2.25rem] shrink-0 text-center text-[11px] tabular-nums text-text-faint">
                  {sessionFindQuery.trim()
                    ? sessionFindMatchCount > 0
                      ? `${sessionFindMatchIndex + 1}/${sessionFindMatchCount}`
                      : "0/0"
                    : ""}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-30"
                  disabled={sessionFindMatchCount <= 0}
                  onClick={() => stepSessionFindMatch(-1)}
                  title="上一个匹配"
                  aria-label="上一个匹配"
                >
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-30"
                  disabled={sessionFindMatchCount <= 0}
                  onClick={() => stepSessionFindMatch(1)}
                  title="下一个匹配"
                  aria-label="下一个匹配"
                >
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
                  onClick={closeSessionFind}
                  title="关闭搜索"
                  aria-label="关闭搜索"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="agx-topbar-btn !px-[5px]"
                onClick={openSessionFind}
                title={
                  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
                    ? "会话内搜索 (⌘F)"
                    : "会话内搜索 (Ctrl+F)"
                }
                aria-label="会话内搜索"
              >
                <TextSearch className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            )}
            {paneSettingsAvatar ? (
              <button
                type="button"
                className="agx-topbar-btn !px-[5px]"
                onClick={() => setAvatarSettingsOpen(true)}
                title="分身设置"
                aria-label="打开分身设置"
              >
                <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            ) : null}
            {VOICE_UI_ENABLED && !isGroupPane && (
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
              ref={historyButtonRef}
              className={`agx-topbar-btn !px-[5px] ${pane.historyOpen ? "agx-topbar-btn--active" : ""}`}
              onClick={toggleHistorySidePanel}
              title="本对话提问目录"
              aria-label="本对话提问目录"
            >
              <ListTree className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            <HoverTip label="工作台 · ⌘⌃B">
              <button
                type="button"
                className={`agx-topbar-btn !px-[5px] ${workspacePanelOpen ? "agx-topbar-btn--active" : ""}`}
                onClick={toggleWorkspaceSidePanel}
                title="工作台"
                aria-label="工作台"
                aria-pressed={workspacePanelOpen}
              >
                <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            </HoverTip>
            <button
              className="agx-topbar-btn !px-[5px] hover:text-status-error"
              onClick={closePaneAndCleanupEmptySession}
              title="关闭窗格"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </div>
        </div>
        ) : null}

        {!workExpandedLayout ? (
        <>
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
                src={DEFAULT_META_AVATAR_URL}
                alt={`${APP_DISPLAY_NAME} Empty State`}
                className="w-[10.5rem] max-w-[36vw] select-none object-contain drop-shadow-[0_18px_44px_rgba(30,166,214,0.36)]"
                draggable={false}
              />
              <div className="space-y-2 select-none">
                <div className="text-[22px] font-semibold text-text-primary tracking-[0.14em]">
                  {APP_DISPLAY_NAME}
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
          {SHOW_DESKTOP_RUN_GRAPH && debateNudgeText ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-4">
              <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border border-amber-500/35 bg-surface-card-strong/95 px-3 py-2 text-[11px] text-amber-700 shadow-lg backdrop-blur-sm dark:text-amber-200">
                <span className="min-w-0 flex-1 leading-relaxed">{debateNudgeText}</span>
                <button
                  type="button"
                  className="shrink-0 rounded px-2 py-1 text-[11px] text-white"
                  style={{ background: "var(--ui-btn-primary-bg)" }}
                  onClick={() => {
                    setDebateNudgeText("");
                    openWorkspaceSidebarForPane(
                      pane.id,
                      paneRef.current?.clientWidth ?? paneWidth,
                      openSidePanel,
                    );
                    setWorkPanelFocus({ kind: "graph" });
                  }}
                >
                  打开运行图
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-hover"
                  aria-label="关闭提示"
                  onClick={() => setDebateNudgeText("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}
          <Toast
            placement="inline-bottom-center"
            variant="warning"
            open={attachToastOpen}
            message={attachToastMessage}
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
                  pinChatListToLatestTurn();
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
        </>
        ) : null}

        {/* 外层 px 与列表 agx-pane-message-list 一致，内层 max-w-4xl 单独一层，避免「padding 吃进 max-width」导致输入框比气泡窄一截 */}
        <div className={`shrink-0 ${workExpandedLayout ? "px-3 pt-2.5 pb-3" : "px-4 pt-2.5 pb-4"}`}>
          <div
            className={`agx-pane-composer-shell mx-auto min-w-0 w-full ${
              workExpandedLayout ? "max-w-none" : "max-w-4xl"
            }`}
          >
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
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 [html[data-theme=light]_&]:border-amber-600/50 [html[data-theme=light]_&]:bg-amber-500/15 [html[data-theme=light]_&]:text-amber-900">
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
          {selectedMessageIds.size > 0 ? (
            <div className="mb-1.5 flex items-center gap-1 rounded-2xl border border-transparent bg-surface-card px-3 py-2 text-xs text-text-muted">
              <span className="mr-1 shrink-0">已多选 {selectedTurnCount} 轮</span>
              <button
                type="button"
                className="rounded-xl px-2 py-1 text-text-strong transition-colors hover:bg-surface-hover"
                onClick={forwardSelectedMessages}
              >
                转发
              </button>
              <button
                ref={shareBtnRef}
                type="button"
                className="rounded-xl px-2 py-1 text-text-strong transition-colors hover:bg-surface-hover"
                aria-expanded={shareMenuOpen}
                aria-haspopup="menu"
                onClick={() => setShareMenuOpen((open) => !open)}
              >
                分享
              </button>
              <button
                type="button"
                className="rounded-xl px-2 py-1 text-rose-300 transition-colors hover:bg-surface-hover"
                onClick={() => void deleteSelectedMessages()}
              >
                删除
              </button>
              <button
                type="button"
                className="rounded-xl px-2 py-1 text-text-strong transition-colors hover:bg-surface-hover"
                onClick={() => setSelectedMessageIds(new Set())}
              >
                取消
              </button>
              {shareMenuOpen && shareBtnRef.current
                ? createPortal(
                    <div
                      ref={shareMenuRef}
                      role="menu"
                      aria-label="分享"
                      className="agx-menu-pop fixed z-[9999] flex min-w-[148px] flex-col gap-0.5 rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
                      style={{
                        left: shareBtnRef.current.getBoundingClientRect().left,
                        bottom: window.innerHeight - shareBtnRef.current.getBoundingClientRect().top + 6,
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition-colors hover:bg-surface-hover"
                        onClick={() => {
                          setShareMenuOpen(false);
                          void shareSelectedAsText();
                        }}
                      >
                        复制文本
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition-colors hover:bg-surface-hover"
                        onClick={() => {
                          setShareMenuOpen(false);
                          setShareImageOpen(true);
                        }}
                      >
                        分享为图片
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="rounded-lg px-2.5 py-2 text-left text-[13px] text-text-strong transition-colors hover:bg-surface-hover"
                        onClick={() => {
                          setShareMenuOpen(false);
                          void exportSelectedMessagesToPdf();
                        }}
                      >
                        保存为 PDF
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
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
              {stallWait ? <StallWaitChip info={stallWait} /> : null}
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
          <div className="agx-pane-composer-body agx-theme-focus-ring relative rounded-2xl border border-transparent bg-surface-card transition-[border-color,box-shadow] duration-200 ease-out">
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
                syncQuoteTargetsFromComposer();
                if (imeComposingRef.current) {
                  setComposerHasText((prev) => {
                    const next = domTextLooksNonEmpty(composerRef.current?.textContent);
                    return prev === next ? prev : next;
                  });
                  saveComposerCaret();
                  return;
                }
                const live = (composerRef.current?.innerText || "").replace(/\u00a0/g, " ");
                syncComposerFromValue(live, readLiveComposerCaretOffset(live));
                saveComposerCaret();
                scheduleComposerDraftSaveRef.current();
              }}
              onKeyUp={() => {
                saveComposerCaret();
                const live = (composerRef.current?.innerText || "").replace(/\u00a0/g, " ");
                updateAtStateFromText(live, readLiveComposerCaretOffset(live));
              }}
              onMouseUp={() => {
                saveComposerCaret();
                const live = (composerRef.current?.innerText || "").replace(/\u00a0/g, " ");
                updateAtStateFromText(live, readLiveComposerCaretOffset(live));
              }}
              onCompositionStart={() => {
                imeComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                const live = (composerRef.current?.innerText || "").replace(/\u00a0/g, " ");
                syncComposerFromValue(live, readLiveComposerCaretOffset(live));
                saveComposerCaret();
                scheduleComposerDraftSaveRef.current();
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
                      notifyImageAttach();
                      showedVisionToast = true;
                    }
                    if (visionAttachBlocked) continue;
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
                    notifyImageAttach();
                    if (visionAttachBlocked) return;
                  }
                  e.preventDefault();
                  const files = withClipboardImageNames(raw);
                  if (plainText) {
                    document.execCommand("insertText", false, plainText);
                    syncComposerFromValue(extractComposerSendText());
                    scheduleComposerDraftSaveRef.current();
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
                syncComposerFromValue(extractComposerSendText());
                scheduleComposerDraftSaveRef.current();
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
                    // Same semantics as clicking the row: folders drill in, others insert.
                    pickAtMentionCandidate(atCandidates[0]);
                    return;
                  }
                  if (composerExpanded) {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      lastComposerEnterAtRef.current = 0;
                      void sendChat(extractComposerSendText());
                    }
                    return;
                  }
                  e.preventDefault();
                  const composerText = extractComposerSendText();
                  const trimmedComposer = composerText.trim();
                  const hasComposerPayload =
                    !!trimmedComposer || readyAttachments.length > 0 || quoteTargets.length > 0;
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
            {!composerHasText && quoteTargets.length === 0 ? (
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
                          notifyImageAttach();
                          showedVisionToast = true;
                        }
                        if (visionAttachBlocked) continue;
                      }
                      const key = `${file.name}:${file.size}:${file.lastModified}`;
                      parseLocalFile(file, key);
                    }
                    e.target.value = "";
                  }}
                />
                <ComposerMoreActionsButton
                  onPickFile={() => fileInputRef.current?.click()}
                  renderSkillPicker={() => (
                    <SkillPickerButton apiBase={apiBase} apiToken={apiToken} onSelect={handleSkillSelect} embedded />
                  )}
                  renderKbRetrieval={
                    LOCAL_KNOWLEDGE_ENABLED
                      ? () => (
                          <PaneKnowledgeRetrievalModeSwitch
                            apiToken={apiToken}
                            apiBase={apiBase}
                            sessionId={pane.sessionId}
                            paneId={paneId}
                            globalDefaultMode={kbGlobalDefaultMode}
                            onNewSessionDefaultChange={onKbNewSessionDefaultChange}
                            embedded
                          />
                        )
                      : undefined
                  }
                  renderConnectors={() => (
                    <ConnectorsMenuButton sessionId={pane.sessionId} embedded />
                  )}
                />
                {hasStartedChat || showNewTopicContext ? (
                  <ComposerContextControls
                    active={focused}
                    mode={showNewTopicContext ? "new-topic" : "conversation"}
                    workspaces={composerTaskspaces}
                    activeTaskspaceId={pane.activeTaskspaceId}
                    workspacePanelOpen={workspacePanelOpen}
                    workspaceLoading={composerWorkspaceLoading}
                    workspaceActionBusy={composerWorkspaceActionBusy}
                    workspaceError={composerWorkspaceError}
                    onWorkspaceMenuOpen={() => {
                      void prepareComposerWorkspaceMenu();
                    }}
                    onWorkspaceSelect={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
                    onCreateWorkspace={addComposerWorkspace}
                    onOpenLocalFolder={openComposerLocalFolder}
                    confirmStrategy={confirmStrategy}
                    permissionSaving={composerPermissionSaving}
                    permissionError={composerPermissionError}
                    onConfirmStrategyChange={changeComposerConfirmStrategy}
                  />
                ) : null}
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
                <div className="flex min-w-0 items-center gap-0.5">
                  {hasStartedChat ? (
                    <ContextUsageButton
                      paneId={pane.id}
                      sessionId={pane.sessionId ?? ""}
                      apiBase={apiBase}
                      apiToken={apiToken}
                    />
                  ) : null}
                  <PaneModelPicker paneId={pane.id} />
                </div>
                <ActionCircleButton
                  hasInput={
                    (!!composerHasText || readyAttachments.length > 0 || quoteTargets.length > 0)
                  }
                  /* `canInterruptCurrentSession` 只覆盖"当前 pane 自己发起 SSE"的场景。
                   * 分身被 Meta 委派时，分身 pane 自己没有 SSE，但任务确实在跑。
                   * 用 `hasDelegation` 兜底，让分身/Meta 视角下都能看到 stop 按钮，
                   * 后端 `interruptSession` 对任意 session_id 生效。 */
                  streaming={showStopButton}
                  recording={recording}
                  transcribing={voiceTranscribing}
                  onSend={() => {
                    lastComposerEnterAtRef.current = 0;
                    void sendChat(extractComposerSendText());
                  }}
                  onMic={onMicClick}
                  onStop={stopCurrentRun}
                />
              </div>
            </div>
            {atOpen ? (
              <AtMentionPicker
                query={atQuery}
                candidates={atCandidates}
                browse={atBrowse}
                onPick={pickAtMentionCandidate}
                onEnterDir={enterAtMentionDir}
                onInsertDir={insertAtMentionDir}
                onLeaveBrowse={leaveAtMentionBrowse}
              />
            ) : null}
          </div>
          {/* AI 免责声明：仅非空会话显示（对齐 Work Buddy，空新建会话不打扰） */}
          {(pane.messages ?? []).some(
            (m) => m.role === "user" || m.role === "assistant"
          ) ? (
            <div className="mt-1.5 flex justify-center px-0.5">
              <p className="select-none text-[11px] leading-none text-text-faint">
                内容由 AI 生成，请核实重要信息
              </p>
            </div>
          ) : null}
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
          </div>
        </div>
        </div>
      </div>

      {!compactSidePanels && workspacePanelOpen ? (
        <div
          className={
            workExpandedLayout
              ? "relative h-full min-w-0 flex-1 overflow-hidden"
              : "relative h-full shrink-0 overflow-hidden"
          }
          style={workExpandedLayout ? undefined : { width: taskspaceWidth }}
        >
          {!workExpandedLayout ? (
            <div
              className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
              onMouseDown={startResizeTaskspace}
              title="拖拽调整工作台面板宽度"
            >
              <div className="mx-auto h-full w-px bg-[var(--border-strong)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
            </div>
          ) : null}
          <WorkPanel
            paneId={pane.id}
            sessionId={pane.sessionId}
            activeTaskspaceId={pane.activeTaskspaceId}
            onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
            autoRefreshKey={taskspaceAutoRefreshKey}
            onClose={closeWorkspacePanelOnly}
            expanded={workPanelExpanded}
            onToggleExpand={toggleWorkPanelExpand}
            tintColor={paneTint}
            focusRequest={workPanelFocus}
            onFocusRequestHandled={() => setWorkPanelFocus(null)}
            onPickFileForReference={(taskspaceId, path) => {
              void insertWorkspaceFileReference(taskspaceId, path);
            }}
            onPickDirectoryForReference={({ taskspaceId, relPath, label }) => {
              void insertWorkspaceDirectoryReference(taskspaceId, relPath, label);
            }}
            onQuotePreviewSnippet={insertWorkspaceSnippetReference}
            onQuoteBrowserSelection={(payload) => {
              const text = String(payload.text || "").trim();
              if (!text) return;
              let host = "";
              try {
                host = new URL(payload.url).hostname;
              } catch {
                /* ignore */
              }
              const label = (payload.title || host || "网页").trim().slice(0, 48);
              addQuoteTarget(
                {
                  id: `web-${crypto.randomUUID()}`,
                  role: "assistant",
                  content: text,
                  avatarName: label,
                },
                text,
              );
            }}
            onSearchBrowserSelection={(text) => {
              const q = String(text || "").trim();
              if (!q) return;
              if (!pane.taskspacePanelOpen) {
                openWorkspaceSidebarForPane(
                  pane.id,
                  paneRef.current?.clientWidth ?? paneWidth,
                  openSidePanel,
                );
              }
              setWorkPanelFocus({
                kind: "browser",
                url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                title: `搜索：${q}`,
              });
            }}
            previewOpenRequest={pendingWorkspacePreviewRequest}
            onPreviewOpenRequestHandled={() => setPendingWorkspacePreviewRequest(null)}
            onEnsureSessionForWorkspace={materializeLazySession}
            subAgents={paneSubAgents}
            selectedSubAgent={selectedSubAgent}
            onCancelSubAgent={(agentId) => void cancelPaneSubAgent(agentId)}
            onRetrySubAgent={(agentId) => void retryPaneSubAgent(agentId)}
            onChatSubAgent={togglePaneSubAgentChat}
            onModelChangeSubAgent={(agentId, provider, model) =>
              void changePaneSubAgentModel(agentId, provider, model)
            }
            onConfirmResolveSubAgent={(agentId, approved) =>
              void resolvePaneSubAgentConfirm(agentId, approved)
            }
            todoLiveness={taskLiveness}
            todoExecutionState={sessionExecutionState}
            groupId={isGroupPane ? groupChatId : null}
            avatarList={avatars}
            metaLeaderLabel={metaLeaderDisplayName}
            groupActiveAgentIds={groupActiveAgentIds}
            groupActivityHint={groupActivityHint}
            groupMemberPhase={groupMemberPhase}
            onCrewAppendDirective={handleCrewAppendDirective}
            onCrewSwitchModel={handleCrewSwitchModel}
            onCrewInterrupt={handleCrewInterrupt}
          />
        </div>
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
        <div className="relative h-full shrink-0 overflow-hidden" style={{ width: historyWidth }}>
          <div
            className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
            onMouseDown={startResizeHistory}
            title="拖拽调整记忆图谱面板宽度"
          >
            <div className="mx-auto h-full w-px bg-[var(--border-strong)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
          </div>
          <MemoryGraphPanel pane={pane} onClose={closeMemoryGraphPanelOnly} tintColor={paneTint} />
        </div>
      ) : null}
      {compactSidePanels &&
      (workspacePanelOpen ||
        pane.memoryGraphOpen ||
        pane.spawnsColumnOpen ||
        pane.runDrawerOpen) ? (
        <>
          <div
            aria-hidden
            role="presentation"
            className={`pointer-events-auto absolute inset-x-0 bottom-0 z-[45] bg-black/35 backdrop-blur-[1px] ${
              integratedToolbar ? "top-0" : "top-10"
            }`}
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            onClick={dismissAuxiliaryOverlays}
          />
          {workspacePanelOpen ? (
            <div
              className={
                workExpandedLayout
                  ? "pointer-events-auto absolute inset-0 z-50 overflow-hidden bg-surface-base"
                  : `pointer-events-auto absolute bottom-0 right-0 z-50 shrink-0 overflow-hidden bg-surface-base shadow-[6px_0_24px_rgba(0,0,0,0.28)] ${
                      integratedToolbar ? "top-0" : "top-10"
                    }`
              }
              style={
                workExpandedLayout
                  ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
                  : ({ width: overlayTaskspaceWidth, WebkitAppRegion: "no-drag" } as CSSProperties)
              }
            >
              {!workExpandedLayout ? (
                <div
                  className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
                  onMouseDown={startResizeTaskspace}
                  title="拖拽调整工作台面板宽度"
                >
                  <div className="mx-auto h-full w-px bg-[var(--border-strong)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
                </div>
              ) : null}
              <WorkPanel
                paneId={pane.id}
                sessionId={pane.sessionId}
                activeTaskspaceId={pane.activeTaskspaceId}
                onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(pane.id, taskspaceId)}
                autoRefreshKey={taskspaceAutoRefreshKey}
                onClose={closeWorkspacePanelOnly}
                expanded={workPanelExpanded}
                onToggleExpand={toggleWorkPanelExpand}
                tintColor={paneTint}
                focusRequest={workPanelFocus}
                onFocusRequestHandled={() => setWorkPanelFocus(null)}
                onPickFileForReference={(taskspaceId, path) => {
                  void insertWorkspaceFileReference(taskspaceId, path);
                }}
                onPickDirectoryForReference={({ taskspaceId, relPath, label }) => {
                  void insertWorkspaceDirectoryReference(taskspaceId, relPath, label);
                }}
                onQuotePreviewSnippet={insertWorkspaceSnippetReference}
                onQuoteBrowserSelection={(payload) => {
                  const text = String(payload.text || "").trim();
                  if (!text) return;
                  let host = "";
                  try {
                    host = new URL(payload.url).hostname;
                  } catch {
                    /* ignore */
                  }
                  const label = (payload.title || host || "网页").trim().slice(0, 48);
                  addQuoteTarget(
                    {
                      id: `web-${crypto.randomUUID()}`,
                      role: "assistant",
                      content: text,
                      avatarName: label,
                    },
                    text,
                  );
                }}
                onSearchBrowserSelection={(text) => {
                  const q = String(text || "").trim();
                  if (!q) return;
                  if (!pane.taskspacePanelOpen) {
                    openWorkspaceSidebarForPane(
                      pane.id,
                      paneRef.current?.clientWidth ?? paneWidth,
                      openSidePanel,
                    );
                  }
                  setWorkPanelFocus({
                    kind: "browser",
                    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                    title: `搜索：${q}`,
                  });
                }}
                previewOpenRequest={pendingWorkspacePreviewRequest}
                onPreviewOpenRequestHandled={() => setPendingWorkspacePreviewRequest(null)}
                onEnsureSessionForWorkspace={materializeLazySession}
                subAgents={paneSubAgents}
                selectedSubAgent={selectedSubAgent}
                onCancelSubAgent={(agentId) => void cancelPaneSubAgent(agentId)}
                onRetrySubAgent={(agentId) => void retryPaneSubAgent(agentId)}
                onChatSubAgent={togglePaneSubAgentChat}
                onModelChangeSubAgent={(agentId, provider, model) =>
                  void changePaneSubAgentModel(agentId, provider, model)
                }
                onConfirmResolveSubAgent={(agentId, approved) =>
                  void resolvePaneSubAgentConfirm(agentId, approved)
                }
                todoLiveness={taskLiveness}
                todoExecutionState={sessionExecutionState}
                groupId={isGroupPane ? groupChatId : null}
                avatarList={avatars}
                metaLeaderLabel={metaLeaderDisplayName}
                groupActiveAgentIds={groupActiveAgentIds}
                groupActivityHint={groupActivityHint}
                groupMemberPhase={groupMemberPhase}
                onCrewAppendDirective={handleCrewAppendDirective}
                onCrewSwitchModel={handleCrewSwitchModel}
                onCrewInterrupt={handleCrewInterrupt}
              />
            </div>
          ) : null}
          {pane.runDrawerOpen && pane.runDrawerRunId && pane.sessionId ? (
            <div
              className={`pointer-events-auto absolute bottom-0 right-0 z-50 shrink-0 overflow-hidden shadow-[6px_0_24px_rgba(0,0,0,0.28)] ${
                integratedToolbar ? "top-0" : "top-10"
              }`}
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
              className={`pointer-events-auto absolute bottom-0 right-0 z-50 shrink-0 overflow-hidden bg-surface-base shadow-[6px_0_24px_rgba(0,0,0,0.28)] ${
                integratedToolbar ? "top-0" : "top-10"
              }`}
              style={{ width: overlayHistoryWidth, WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <div
                className="group absolute -left-[3px] top-0 z-20 h-full w-2 cursor-col-resize"
                onMouseDown={startResizeHistory}
                title="拖拽调整记忆图谱面板宽度"
              >
                <div className="mx-auto h-full w-px bg-[var(--border-strong)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
              </div>
              <MemoryGraphPanel pane={pane} onClose={closeMemoryGraphPanelOnly} tintColor={paneTint} />
            </div>
          ) : null}
        </>
      ) : null}
      </div>
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
      <ShareImagePreviewModal
        open={shareImageOpen}
        messages={messagesForShareExport(selectedMessages, visibleMessages)}
        sessionTitle={paneAvatarMeta.name || pane?.avatarName || "对话记录"}
        userBubbleLabel={userBubbleLabel}
        onClose={() => setShareImageOpen(false)}
        onToast={(msg) => setStallHintToast(msg)}
      />
      {avatarSettingsOpen && paneSettingsAvatar ? (
        <AvatarSettingsPanel
          mode="avatar"
          avatar={paneSettingsAvatar}
          onClose={() => {
            setAvatarSettingsOpen(false);
            setCrewSettingsAvatarId(null);
          }}
          onSaved={() => {
            window.dispatchEvent(
              new CustomEvent("agenticx:avatars:changed", { detail: { openPane: false } })
            );
          }}
        />
      ) : null}
    </div>
  );
}
