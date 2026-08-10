"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  DeepResearchFilesPanel,
  type DeepResearchPanelLane,
  DeepResearchRecoverBanner,
  AttachmentContentPanel,
  DOCUMENT_ACCEPT,
  InputArea,
  MessageList,
  MessageQueuePanel,
  classifyAttachment,
  STREAM_UPDATE_DEPTH_ERROR,
  probeNote,
  useChatStore,
  useComposerAttachments,
  extractClipboardImageFiles,
  withClipboardImageNames,
  modelSupportsVision,
  consumeDeepResearchReconnectStream,
  type ActiveDeepResearchRun,
} from "@agenticx/feature-chat";
import { type ChatClient } from "@agenticx/sdk-ts";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import {
  Activity,
  Check,
  ChevronDown,
  Cpu,
  Microscope,
  Paperclip,
  Pencil,
  Share,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@agenticx/ui";
import { NearEmptyWordmark } from "./NearEmptyWordmark";
import { QuotaLimitNotice } from "./QuotaLimitNotice";
import { ShareDialog } from "./share/ShareDialog";
import { downloadShareImage } from "./share/share-image";
import { navigateToExternalLink } from "../lib/external-link";
import {
  CapabilityHoverTip,
  ComposerPlusMenu,
  hintLines,
  type WebSearchMode,
} from "./ComposerPlusMenu";
import { ENTERPRISE_PRODUCT_NAME } from "./EnterpriseBrandMark";
import {
  expandChatShareTurnSelection,
  toChatShareMessage,
  type ChatShareMessage,
  type ChatShareSnapshot,
} from "../lib/chat-share-types";

// 模型清单从 /api/me/models 动态获取（admin 配置 + 用户可见性）。
// 没有任何分配时为空，UI 会提示「请联系管理员分配模型」。
type PortalModelOption = {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  route: "local" | "private-cloud" | "third-party";
  isDefault: boolean;
  capabilities?: string[];
};

/** 会话 active_model（provider/model）在可见列表为空时的展示兜底。 */
function formatActiveModelFallback(modelId: string): string {
  const slash = modelId.indexOf("/");
  if (slash <= 0) return modelId;
  const provider = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  if (!model) return modelId;
  return `${model} · ${provider}`;
}

type MachiChatViewProps = {
  client: ChatClient;
  deepResearchMode?: boolean;
  onDeepResearchModeChange?: (next: boolean) => void;
};

function isComplianceError(message: string): boolean {
  return (/合规|策略|compliance|policy/i.test(message) && !/Gateway/i.test(message));
}

function isQuotaExhaustedError(message: string | null): boolean {
  if (!message) return false;
  return /(?:token\s*(?:配额|quota)|(?:配额|quota)).*(?:用尽|超出|exhausted|exceeded)/i.test(message);
}

export function MachiChatView({
  client,
  deepResearchMode = false,
  onDeepResearchModeChange,
}: MachiChatViewProps) {
  const t = useTranslations("chat");
  const tw = useTranslations("workspace");
  // Selector split: avoid bare useChatStore() so stream message/token ticks do not
  // re-run model-menu / switchModel fallback logic on every delta.
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const activeModel = useChatStore((s) => s.activeModel);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const responseVersionsByUserMessageId = useChatStore((s) => s.responseVersionsByUserMessageId);
  const hydrateSessions = useChatStore((s) => s.hydrateSessions);
  const historyError = useChatStore((s) => s.historyError);
  const historySyncBySessionId = useChatStore((s) => s.historySyncBySessionId);
  const retryHistorySync = useChatStore((s) => s.retryHistorySync);
  const sessionMessagesLoading = useChatStore((s) => s.sessionMessagesLoading);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const switchModel = useChatStore((s) => s.switchModel);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendQueuedMessageNow = useChatStore((s) => s.sendQueuedMessageNow);
  const removePendingMessage = useChatStore((s) => s.removePendingMessage);
  const editPendingMessage = useChatStore((s) => s.editPendingMessage);
  const pendingMessages = useChatStore((s) => s.pendingMessages);
  const editUserMessageAndResend = useChatStore((s) => s.editUserMessageAndResend);
  const regenerateAssistantResponse = useChatStore((s) => s.regenerateAssistantResponse);
  const showPreviousResponseVersion = useChatStore((s) => s.showPreviousResponseVersion);
  const showNextResponseVersion = useChatStore((s) => s.showNextResponseVersion);
  const showPreviousRetryVersion = useChatStore((s) => s.showPreviousRetryVersion);
  const showNextRetryVersion = useChatStore((s) => s.showNextRetryVersion);
  const cancel = useChatStore((s) => s.cancel);
  const displayErrorMessage =
    errorMessage === STREAM_UPDATE_DEPTH_ERROR ? t("updateDepthError") : errorMessage;
  const quotaError = isQuotaExhaustedError(errorMessage);
  const [draft, setDraft] = React.useState("");
  /** Default auto (on) — aligned with product expectation for portal chat. */
  const [webSearchMode, setWebSearchMode] = React.useState<WebSearchMode>("auto");
  const [filesPanelSessionId, setFilesPanelSessionId] = React.useState<string | null>(null);
  const [filesPanelFocusId, setFilesPanelFocusId] = React.useState<string | null>(null);
  const [filesPanelLane, setFilesPanelLane] = React.useState<DeepResearchPanelLane | null>(
    null,
  );
  const [attachmentPreview, setAttachmentPreview] = React.useState<ChatMessageAttachment | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [shareInitialSelectedIds, setShareInitialSelectedIds] = React.useState<string[]>([]);

  // Stable identities: MessageList folds these into memo dependencies that decide whether
  // the assistant markdown component map is rebuilt, so inline arrows here would rebuild
  // (and visibly re-mount) every rendered citation chip on each composer keystroke.
  const requestDeepResearchFiles = React.useCallback(
    (sessionId: string, focusArtifactId?: string | null) => {
      setAttachmentPreview(null);
      setFilesPanelSessionId(sessionId);
      setFilesPanelLane(null);
      setFilesPanelFocusId(focusArtifactId ?? null);
    },
    [],
  );
  const requestDeepResearchLaneSources = React.useCallback(
    (sessionId: string, lane: DeepResearchPanelLane) => {
      setAttachmentPreview(null);
      setFilesPanelSessionId(sessionId);
      setFilesPanelFocusId(null);
      setFilesPanelLane(lane);
    },
    [],
  );
  const requestAttachmentPreview = React.useCallback((attachment: ChatMessageAttachment) => {
    setFilesPanelSessionId(null);
    setFilesPanelFocusId(null);
    setFilesPanelLane(null);
    setAttachmentPreview(attachment);
  }, []);
  const requestExternalLink = React.useCallback((url: string, title?: string) => {
    navigateToExternalLink(url, title);
  }, []);

  React.useEffect(() => {
    setFilesPanelSessionId(null);
    setFilesPanelFocusId(null);
  }, [activeSessionId]);

  const handleDeepResearchRecover = React.useCallback((run: ActiveDeepResearchRun) => {
    const sessionId = run.sessionId;
    const state = useChatStore.getState();
    const existing = [...state.messages]
      .reverse()
      .find(
        (m) =>
          m.session_id === sessionId &&
          m.role === "assistant" &&
          m.deep_research?.runId === run.runId,
      );
    const targetId = existing?.id;
    if (!targetId) {
      // No matching bubble yet — stream still reconnects into a local placeholder via content only.
      console.info("[deep-research] reconnect: no assistant bubble for", run.runId);
    } else {
      useChatStore.setState((prev) => ({
        messages: prev.messages.map((m) =>
          m.id === targetId
            ? {
                ...m,
                content: "",
                deep_research: {
                  runId: run.runId,
                  status: run.status === "awaiting_clarify" ? "awaiting_clarify" : "running",
                  events: [],
                  artifactIds: [],
                  clarifyAnswers: m.deep_research?.clarifyAnswers,
                },
              }
            : m,
        ),
      }));
    }

    void consumeDeepResearchReconnectStream(run.runId, {
      onEvent: (event) => {
        if (!targetId) return;
        useChatStore.setState((prev) => ({
          messages: prev.messages.map((m) => {
            if (m.id !== targetId) return m;
            const prevDr = m.deep_research;
            let status: NonNullable<typeof prevDr>["status"] = prevDr?.status ?? "running";
            if (event.type === "clarify") status = "awaiting_clarify";
            else if (event.type === "phase" && event.phase === "done") status = "completed";
            else if (status === "awaiting_clarify") status = "running";
            const events = [...(prevDr?.events ?? []), event].slice(-400);
            const artifactIds = [...(prevDr?.artifactIds ?? [])];
            if (event.type === "artifact" && !artifactIds.includes(event.id)) {
              artifactIds.push(event.id);
            }
            return {
              ...m,
              deep_research: {
                runId: run.runId,
                status,
                events,
                artifactIds,
                clarifyAnswers: prevDr?.clarifyAnswers,
              },
            };
          }),
        }));
      },
      onDelta: (text) => {
        if (!targetId) return;
        useChatStore.setState((prev) => ({
          messages: prev.messages.map((m) =>
            m.id === targetId ? { ...m, content: `${m.content ?? ""}${text}` } : m,
          ),
        }));
      },
      onDone: () => {
        if (!targetId) return;
        useChatStore.setState((prev) => ({
          messages: prev.messages.map((m) =>
            m.id === targetId && m.deep_research
              ? {
                  ...m,
                  deep_research: {
                    ...m.deep_research,
                    status:
                      m.deep_research.status === "awaiting_clarify"
                        ? "awaiting_clarify"
                        : "completed",
                  },
                }
              : m,
          ),
        }));
      },
    }).catch((error) => {
      console.warn("[deep-research] reconnect failed:", error);
    });
  }, []);

  const filesPanelSources = React.useMemo(() => {
    if (!filesPanelSessionId) return [];
    const sessionMsgs = messages.filter((m) => m.session_id === filesPanelSessionId);
    for (let i = sessionMsgs.length - 1; i >= 0; i -= 1) {
      const sources = sessionMsgs[i]?.web_search_sources;
      if (sources && sources.length > 0) return sources;
    }
    return [];
  }, [messages, filesPanelSessionId]);

  const setDeepResearchMode = React.useCallback(
    (next: boolean) => {
      onDeepResearchModeChange?.(next);
    },
    [onDeepResearchModeChange],
  );
  const [visionWarning, setVisionWarning] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const {
    attachments,
    attachmentError,
    addFiles,
    removeAttachment,
    clearAttachments,
    toMessageAttachments,
  } = useComposerAttachments();
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const modelMenuRef = React.useRef<HTMLDivElement>(null);
  const modelTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [modelMenuPosition, setModelMenuPosition] = React.useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({
    top: 0,
    left: 0,
    width: 320,
    maxHeight: 320,
  });

  // 动态拉取当前用户可见的模型清单。
  // 管理员随时可能改变部门/用户的可见模型分配，因此这里不能只在挂载时拉一次：
  // 定期轮询 + 页面重新可见/聚焦时立即刷新，让列表与实际权限自动保持同步，无需用户手动刷新整页。
  const [availableModels, setAvailableModels] = React.useState<PortalModelOption[]>([]);
  const [modelsLoaded, setModelsLoaded] = React.useState(false);

  const refreshAvailableModels = React.useCallback(async () => {
    try {
      const res = await fetch("/api/me/models", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { models: PortalModelOption[] } };
      setAvailableModels(json.data?.models ?? []);
    } catch {
      // 开发服过载 / 本机代理劫持 localhost 时 fetch 会抛 TypeError: Failed to fetch。
      // 轮询失败不应打到 Next 运行时错误浮层；保留上一份 models，等下次轮询。
    } finally {
      setModelsLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void refreshAvailableModels();
    const intervalId = window.setInterval(() => void refreshAvailableModels(), 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAvailableModels();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshAvailableModels]);

  // 收到模型列表后兜底选默认：优先 isDefault，否则首项。
  // 依赖模型 id 序列而非 availableModels 数组引用，避免轮询刷新单独触发无意义 switchModel。
  const availableModelIdsKey = availableModels.map((m) => m.id).join("|");
  React.useEffect(() => {
    if (!modelsLoaded) return;
    if (!availableModelIdsKey) return;
    const exists = availableModels.some((m) => m.id === activeModel);
    if (exists) return;
    const next = availableModels.find((m) => m.isDefault) ?? availableModels[0];
    if (!next) return;
    if (useChatStore.getState().activeModel === next.id) return;
    probeNote("MachiChatView.switchModelFallback", { from: activeModel, to: next.id });
    switchModel(next.id);
    // availableModels read from latest render when ids key / activeModel changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- availableModelIdsKey proxies list identity
  }, [modelsLoaded, availableModelIdsKey, activeModel, switchModel]);

  // 若发送因「模型已不在可见范围内」被服务端拒绝（管理员刚收窄了权限，轮询尚未来得及刷新），
  // 立即补拉一次最新列表，让下拉框与兜底选择马上纠正，不必等下一个轮询周期或用户手动刷新整页。
  React.useEffect(() => {
    if (errorMessage && errorMessage.includes("不在您的可见范围内")) {
      void refreshAvailableModels();
    }
  }, [errorMessage, refreshAvailableModels]);

  React.useEffect(() => {
    void hydrateSessions();
  }, [hydrateSessions]);

  React.useEffect(() => {
    if (!modelMenuOpen) return;
    const updatePosition = () => {
      const trigger = modelTriggerRef.current;
      if (!trigger) return;
      const margin = 8;
      const minMaxHeight = 120;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(360, Math.max(280, rect.width + 88));
      const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.right - width));
      // 菜单向上展开（translateY(-100%)），CSS top 即视觉底边；上方可用高度 = top - margin
      const top = Math.max(margin, rect.top - margin);
      const maxHeight = Math.max(minMaxHeight, top - margin);
      setModelMenuPosition({ top, left, width, maxHeight });
    };
    updatePosition();

    const onClickOutside = (event: MouseEvent) => {
      const el = modelMenuRef.current;
      if (!el) return;
      if (!el.contains(event.target as Node)) setModelMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [modelMenuOpen]);

  const activeOption = React.useMemo(
    () => availableModels.find((m) => m.id === activeModel) ?? null,
    [availableModels, activeModel],
  );

  const modelTriggerLabel = React.useMemo(() => {
    if (activeOption) return activeOption.label;
    if (!modelsLoaded) return t("loading");
    if (activeModel && activeModel !== "mock-model-v1") {
      return formatActiveModelFallback(activeModel);
    }
    return availableModels.length === 0 ? t("noAvailableModel") : t("selectModel");
  }, [activeOption, modelsLoaded, activeModel, availableModels.length, t]);

  const modelMenuEmptyHint = React.useMemo(() => {
    if (availableModels.length > 0) return null;
    if (activeModel && activeModel !== "mock-model-v1") {
      return t("modelNotAssignedHint", { model: formatActiveModelFallback(activeModel) });
    }
    return t("noModelsHint");
  }, [availableModels.length, activeModel, t]);

  const visibleMessages = React.useMemo(() => {
    if (!activeSessionId) return [];
    return messages.filter((message) => message.session_id === activeSessionId);
  }, [messages, activeSessionId]);

  const shareableMessages = React.useMemo(
    () => visibleMessages.map(toChatShareMessage).filter((message): message is ChatShareMessage => message !== null),
    [visibleMessages],
  );

  const openShareDialog = React.useCallback(
    (messageSelection?: string) => {
      const allIds = shareableMessages.map((message) => message.id);
      const requestedIds = (messageSelection ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => allIds.includes(id));
      if (requestedIds.length === 0) {
        setShareInitialSelectedIds(allIds);
      } else {
        const selectedIds = new Set<string>();
        requestedIds.forEach((id) => {
          expandChatShareTurnSelection(shareableMessages, id).forEach((selectedId) => selectedIds.add(selectedId));
        });
        setShareInitialSelectedIds(allIds.filter((id) => selectedIds.has(id)));
      }
      setShareDialogOpen(true);
    },
    [shareableMessages],
  );

  const userIdsInActiveSession = React.useMemo(() => {
    return new Set(visibleMessages.filter((message) => message.role === "user").map((message) => message.id));
  }, [visibleMessages]);

  const isEmpty = visibleMessages.length === 0;
  React.useEffect(() => {
    setModelMenuOpen(false);
  }, [isEmpty]);
  const { responseVersionMetaByUserMessageId, retryVersionMetaByUserMessageId } = React.useMemo(() => {
    const queryMeta: Record<string, { activeIndex: number; total: number }> = {};
    const retryMeta: Record<string, { activeIndex: number; total: number }> = {};

    Object.entries(responseVersionsByUserMessageId).forEach(([userMessageId, versionState]) => {
      if (!userIdsInActiveSession.has(userMessageId)) return;
      const versions = versionState.versions ?? [];
      if (versions.length === 0) {
        queryMeta[userMessageId] = { activeIndex: 0, total: 0 };
        retryMeta[userMessageId] = { activeIndex: 0, total: 0 };
        return;
      }

      const queryVersionIndices = Array.from(new Set(versions.map((version) => version.queryVersionIndex ?? 0))).sort((a, b) => a - b);
      const activeVersion = versions[versionState.activeIndex] ?? versions[versions.length - 1];
      const activeQueryVersionIndex = activeVersion?.queryVersionIndex ?? 0;
      const activeQueryPosition = Math.max(0, queryVersionIndices.indexOf(activeQueryVersionIndex));
      queryMeta[userMessageId] = {
        activeIndex: activeQueryPosition,
        total: queryVersionIndices.length,
      };

      const activeRetryVersions = versions
        .map((version, index) => ({ version, index }))
        .filter(({ version }) => (version.queryVersionIndex ?? 0) === activeQueryVersionIndex)
        .sort((a, b) => ((a.version.retryAttempt ?? 0) - (b.version.retryAttempt ?? 0)) || (a.index - b.index));
      const activeRetryIndices = activeRetryVersions.map(({ index }) => index);
      const activeRetryPosition = Math.max(0, activeRetryIndices.indexOf(versionState.activeIndex));
      retryMeta[userMessageId] = {
        activeIndex: activeRetryPosition,
        total: activeRetryIndices.length,
      };
    });

    return {
      responseVersionMetaByUserMessageId: queryMeta,
      retryVersionMetaByUserMessageId: retryMeta,
    };
  }, [responseVersionsByUserMessageId, userIdsInActiveSession]);
  const activeSession = React.useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const [sessionTitle, setSessionTitle] = React.useState(t("newConversation"));
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setIsEditingTitle(false);
    if (activeSession) {
      setSessionTitle(activeSession.title);
      return;
    }
    setSessionTitle(t("newConversation"));
  }, [activeSession?.id, activeSession?.title, activeSessionId, t]);

  const createShareLink = React.useCallback(
    async (messageIds: string[]) => {
      if (!activeSessionId) throw new Error(t("shareFailed"));
      const response = await fetch("/api/chat/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: activeSessionId, message_ids: messageIds }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { path?: string; share_url?: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.path) {
        const message = payload.error?.message;
        if (message === "select at least one message to share") {
          throw new Error(t("shareSyncError"));
        }
        throw new Error(message ?? t("shareFailed"));
      }
      return payload.data.share_url ?? new URL(payload.data.path, window.location.origin).toString();
    },
    [activeSessionId, t],
  );

  const generateShareImage = React.useCallback(
    async (selectedMessages: ChatShareMessage[]) => {
      const snapshot: ChatShareSnapshot = {
        token: "preview",
        session_id: activeSessionId ?? "preview",
        title: sessionTitle,
        messages: selectedMessages,
        created_at: new Date().toISOString(),
      };
      const safeTitle = (sessionTitle || t("newConversation"))
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 80);
      await downloadShareImage(snapshot, `${safeTitle}.png`);
    },
    [activeSessionId, sessionTitle, t],
  );

  const deleteCurrentSession = React.useCallback(() => {
    if (!activeSessionId) return;
    if (!window.confirm(tw("deleteSessionConfirm"))) return;
    void deleteSession(activeSessionId);
  }, [activeSessionId, deleteSession, tw]);

  const activeModelOption = React.useMemo(
    () => availableModels.find((item) => item.id === activeModel),
    [availableModels, activeModel],
  );

  const visionSupported = React.useMemo(
    () =>
      modelSupportsVision(
        activeModelOption?.provider ?? "",
        activeModelOption?.model ?? activeModel,
        activeModelOption?.capabilities,
      ),
    [activeModelOption, activeModel],
  );

  const warnIfNonVision = React.useCallback(() => {
    if (visionSupported) return false;
    setVisionWarning("模型不支持该文件类型");
    window.setTimeout(() => setVisionWarning(null), 3200);
    return true;
  }, [visionSupported]);

  const handleAddFiles = React.useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const hasImages = files.some((file) => classifyAttachment(file) === "image");
      if (hasImages && warnIfNonVision()) {
        const nonImages = files.filter((file) => classifyAttachment(file) !== "image");
        if (nonImages.length === 0) return;
        addFiles(nonImages);
        return;
      }
      addFiles(files);
    },
    [addFiles, warnIfNonVision],
  );

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const raw = extractClipboardImageFiles(event.clipboardData);
      if (raw.length === 0) return;
      event.preventDefault();
      if (warnIfNonVision()) return;
      handleAddFiles(withClipboardImageNames(raw));
    },
    [handleAddFiles, warnIfNonVision],
  );

  const handleSend = React.useCallback(
    (opts?: { forceSend?: boolean }) => {
      const trimmed = draft.trim();
      const messageAttachments = toMessageAttachments();
      if (!trimmed && messageAttachments.length === 0) return;
      void sendMessage(
        client,
        {
          content: trimmed,
          attachments: messageAttachments,
          webSearch: webSearchMode === "auto",
          deepResearch: deepResearchMode,
        },
        opts?.forceSend ? { forceSend: true } : undefined,
      );
      setDraft("");
      clearAttachments();
    },
    [
      clearAttachments,
      client,
      deepResearchMode,
      draft,
      sendMessage,
      toMessageAttachments,
      webSearchMode,
    ],
  );

  const queuedForSession = React.useMemo(() => {
    if (!activeSessionId) return [];
    return pendingMessages.filter((message) => message.sessionId === activeSessionId);
  }, [activeSessionId, pendingMessages]);

  const activeHistorySync = activeSessionId
    ? historySyncBySessionId[activeSessionId]
    : undefined;
  const showSessionHistorySync =
    !!activeHistorySync &&
    activeHistorySync.state !== "idle" &&
    (activeHistorySync.pendingCount > 0 ||
      activeHistorySync.state === "dead_letter" ||
      activeHistorySync.state === "paused");

  const composer = (
    <div className={cn("mx-auto w-full space-y-3", isEmpty ? "max-w-[46rem]" : "max-w-4xl")}>
      <QuotaLimitNotice forceOpen={quotaError} />
      {historyError && (
        <Alert variant="warning" className="border-warning/30 bg-warning-soft/80 shadow-sm">
          <ShieldAlert className="h-5 w-5" />
          <div>
            <AlertTitle>{t("historySyncTitle")}</AlertTitle>
            <AlertDescription>{historyError}</AlertDescription>
          </div>
        </Alert>
      )}
      {showSessionHistorySync && activeHistorySync && (
        <Alert
          variant="warning"
          className="border-warning/30 bg-warning-soft/80 shadow-sm"
          aria-live={
            activeHistorySync.state === "dead_letter" || activeHistorySync.state === "paused"
              ? "assertive"
              : "polite"
          }
        >
          <ShieldAlert className="h-5 w-5" />
          <div className="flex flex-1 items-start justify-between gap-3">
            <div>
              <AlertTitle>{t("historySyncTitle")}</AlertTitle>
              <AlertDescription>
                {activeHistorySync.message || t("historySyncPending")}
              </AlertDescription>
            </div>
            {activeHistorySync.state === "dead_letter" &&
              activeHistorySync.pendingCount > 0 &&
              activeSessionId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  void retryHistorySync(activeSessionId);
                }}
              >
                {t("historySyncRetry")}
              </Button>
            )}
          </div>
        </Alert>
      )}
      {displayErrorMessage && !quotaError && (
        <Alert variant="warning" className="border-warning/30 bg-warning-soft/80 shadow-sm">
          <ShieldAlert className="h-5 w-5" />
          <div>
            <AlertTitle>
              {errorMessage === STREAM_UPDATE_DEPTH_ERROR
                ? t("updateDepthTitle")
                : isComplianceError(errorMessage ?? "")
                  ? t("complianceTitle")
                  : t("chatErrorTitle")}
            </AlertTitle>
            <AlertDescription>{displayErrorMessage}</AlertDescription>
          </div>
        </Alert>
      )}
      {(visionWarning || attachmentError) && (
        <Alert variant="warning" className="border-amber-300/60 bg-amber-50/90 text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <ShieldAlert className="h-5 w-5" />
          <AlertDescription>{visionWarning ?? attachmentError}</AlertDescription>
        </Alert>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          if (files.length > 0) handleAddFiles(files);
          event.target.value = "";
        }}
      />

      <MessageQueuePanel
        messages={queuedForSession}
        onEdit={editPendingMessage}
        onRemove={removePendingMessage}
        onSendNow={(id) => void sendQueuedMessageNow(client, id)}
      />

      <InputArea
        value={draft}
        status={status}
        onChange={setDraft}
        onSend={() => handleSend()}
        onForceSend={() => handleSend({ forceSend: true })}
        onCancel={() => void cancel(client)}
        appearance="portal"
        minTextareaHeight={isEmpty ? 96 : undefined}
        className={
          isEmpty
            ? "min-h-[9.75rem] !rounded-[1.75rem] !px-4 !pb-3 !pt-3.5 shadow-[0_10px_40px_-18px_rgba(15,23,42,0.18)]"
            : undefined
        }
        placeholder={
          deepResearchMode ? tw("deepResearchPlaceholder") : `发送消息给${ENTERPRISE_PRODUCT_NAME}...`
        }
        attachments={Object.values(attachments)}
        onAddFiles={handleAddFiles}
        onRemoveAttachment={removeAttachment}
        onPaste={handlePaste}
        leftToolbar={
          <>
            <ComposerPlusMenu
              key="composer-plus"
              webSearchMode={webSearchMode}
              onWebSearchModeChange={setWebSearchMode}
              onPickFiles={() => fileInputRef.current?.click()}
              showFileEntry={false}
              menuSide={isEmpty ? "bottom" : "top"}
            />
            <CapabilityHoverTip
              key="composer-upload"
              label={t("filesAndImages")}
              lines={hintLines(t("filesAndImagesHint"))}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("filesAndImages")}
                className="h-8 w-8 rounded-full text-muted-foreground hover:bg-primary-soft hover:text-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </CapabilityHoverTip>
            {deepResearchMode ? (
              <span
                key="deep-research-chip"
                className="group/dr-chip inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-soft/70 px-2.5 text-xs font-medium text-primary"
                aria-label={tw("deepResearchChip")}
              >
                <button
                  type="button"
                  onClick={() => setDeepResearchMode(false)}
                  className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                  aria-label={tw("exitDeepResearch")}
                  title={tw("exitDeepResearch")}
                >
                  <Microscope className="h-3.5 w-3.5 group-hover/dr-chip:hidden" />
                  <X className="hidden h-3.5 w-3.5 group-hover/dr-chip:block" strokeWidth={2.5} />
                </button>
                <span>{tw("deepResearchChip")}</span>
              </span>
            ) : null}
          </>
        }
        rightToolbar={
          <div ref={modelMenuRef} className="relative">
            {modelMenuOpen ? (
              <div
                className="fixed z-[80] overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-popover/95 p-1 shadow-2xl backdrop-blur"
                style={{
                  width: modelMenuPosition.width,
                  left: modelMenuPosition.left,
                  top: modelMenuPosition.top,
                  maxHeight: modelMenuPosition.maxHeight,
                  transform: "translateY(-100%)",
                }}
              >
                {availableModels.length === 0 ? (
                  <div className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                    {modelMenuEmptyHint}
                  </div>
                ) : (
                  availableModels.map((opt) => {
                    const isSelected = opt.id === activeModel;
                    const icon = opt.route === "local"
                      ? <Cpu className="h-4 w-4" />
                      : opt.route === "private-cloud"
                        ? <Microscope className="h-4 w-4" />
                        : <Sparkles className="h-4 w-4" />;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          switchModel(opt.id);
                          setModelMenuOpen(false);
                        }}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${isSelected ? "bg-primary-soft/70" : "hover:bg-muted/70"}`}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 text-primary">{icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold leading-5 text-foreground">
                            {opt.label}
                          </span>
                          <span className="block truncate text-[11px] leading-4 text-muted-foreground mt-0.5">
                            {opt.providerLabel} · <span className="font-mono">{opt.model}</span>
                          </span>
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" />}
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
            <button
              ref={modelTriggerRef}
              type="button"
              onClick={() => setModelMenuOpen((prev) => !prev)}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              <span>{modelTriggerLabel}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        }
      />
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部 - 对话标题 */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 pl-14 lg:pl-6">
          <div className="flex items-center gap-2">
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                onBlur={() => {
                  setIsEditingTitle(false);
                  if (activeSessionId) {
                    void renameSession(activeSessionId, sessionTitle.trim() || tw("newChat"));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    if (activeSession) setSessionTitle(activeSession.title);
                    setIsEditingTitle(false);
                  }
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm font-medium outline-none focus:border-ring"
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingTitle(true)}
                className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
              >
                <span className="text-base font-semibold tracking-tight">{sessionTitle}</span>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="success" className="mr-2 gap-1 px-2.5 py-0.5 text-[11px] font-medium">
              <Activity className="h-3 w-3" />
              <span className="hidden sm:inline">{t("gatewayOnline")}</span>
              <span className="sm:hidden">{t("gatewayOnlineShort")}</span>
            </Badge>
            {!isEmpty && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    aria-label={t("shareConversation")}
                    onClick={() => openShareDialog()}
                  >
                    <Share className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("shareConversation")}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label={t("deleteConversation")}
                  disabled={!activeSessionId}
                  onClick={deleteCurrentSession}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("deleteConversation")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 主对话区 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {isEmpty ? (
            /* 空态：品牌字标靠上 + 收窄加高输入区（深度研究入口暂走侧栏） */
            <div className="relative flex h-full flex-col items-center justify-start gap-10 overflow-y-auto px-4 pt-14 pb-10 md:gap-12 md:pt-16 md:pb-16">
              <NearEmptyWordmark
                caption={deepResearchMode ? tw("deepResearchEmptySubtitle") : undefined}
                badgeLabel={t("beta")}
              />

              <div className="w-full max-w-[46rem]">{composer}</div>
            </div>
          ) : (
            <div className="relative h-full min-h-0">
              {sessionMessagesLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-sm text-muted-foreground backdrop-blur-[1px]">
                  {t("loadingMessages")}
                </div>
              )}
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 px-4 pt-2">
                  <DeepResearchRecoverBanner
                    sessionId={activeSessionId}
                    onRecover={handleDeepResearchRecover}
                  />
                </div>
                <MessageList
                  messages={visibleMessages}
                  className="min-h-0 flex-1"
                  styleVariant="im"
                  assistantFrameless
                  scrollToBottomLabel={t("scrollToBottom")}
                  responseVersionMetaByUserMessageId={responseVersionMetaByUserMessageId}
                  retryVersionMetaByUserMessageId={retryVersionMetaByUserMessageId}
                  onShowPreviousResponseVersion={showPreviousResponseVersion}
                  onShowNextResponseVersion={showNextResponseVersion}
                  onShowPreviousRetryVersion={showPreviousRetryVersion}
                  onShowNextRetryVersion={showNextRetryVersion}
                  onRequestDeepResearchFiles={requestDeepResearchFiles}
                  onRequestDeepResearchLaneSources={requestDeepResearchLaneSources}
                  onOpenExternalUrl={requestExternalLink}
                  onRequestAttachmentPreview={requestAttachmentPreview}
                  onCopy={(content) => {
                    console.log("Copied:", content);
                  }}
                  onRetry={(messageId) => {
                    void regenerateAssistantResponse(client, messageId);
                  }}
                  onUserEditResend={(messageId, content) => {
                    if (!content.trim()) return;
                    void editUserMessageAndResend(client, { messageId, content });
                  }}
                  onShare={(messageId) => {
                    openShareDialog(messageId);
                  }}
                  onFeedback={(messageId, type) => {
                    console.log(`Feedback ${type} for message ${messageId}`);
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {!isEmpty && (
          <div className="relative z-10 shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-6 pt-4 sm:px-6 sm:pb-8">
            {composer}
          </div>
        )}
      </div>
      <DeepResearchFilesPanel
        open={filesPanelSessionId != null}
        onOpenChange={(open) => {
          if (!open) {
            setFilesPanelSessionId(null);
            setFilesPanelFocusId(null);
            setFilesPanelLane(null);
          }
        }}
        sessionId={filesPanelSessionId}
        focusArtifactId={filesPanelFocusId}
        focusLane={filesPanelLane}
        sources={filesPanelSources}
        onOpenExternalUrl={requestExternalLink}
      />
      <AttachmentContentPanel
        open={attachmentPreview != null}
        onOpenChange={(open) => {
          if (!open) setAttachmentPreview(null);
        }}
        attachment={attachmentPreview}
      />
      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        title={sessionTitle}
        messages={visibleMessages}
        initialSelectedIds={shareInitialSelectedIds}
        onCreateLink={createShareLink}
        onGenerateImage={generateShareImage}
      />
      </div>
    </TooltipProvider>
  );
}
