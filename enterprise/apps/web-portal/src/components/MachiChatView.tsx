"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  DeepResearchFilesPanel,
  InputArea,
  MessageList,
  MessageQueuePanel,
  useChatStore,
  useComposerAttachments,
  extractClipboardImageFiles,
  withClipboardImageNames,
  modelSupportsVision,
} from "@agenticx/feature-chat";
import { type ChatClient } from "@agenticx/sdk-ts";
import {
  Activity,
  Check,
  ChevronDown,
  Cpu,
  Globe,
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

export function MachiChatView({
  client,
  deepResearchMode = false,
  onDeepResearchModeChange,
}: MachiChatViewProps) {
  const t = useTranslations("chat");
  const tw = useTranslations("workspace");
  const {
    sessions,
    activeSessionId,
    messages,
    status,
    activeModel,
    errorMessage,
    sessionTokens,
    responseVersionsByUserMessageId,
    hydrateSessions,
    historyError,
    sessionMessagesLoading,
    renameSession,
    switchModel,
    sendMessage,
    sendQueuedMessageNow,
    removePendingMessage,
    editPendingMessage,
    pendingMessages,
    editUserMessageAndResend,
    regenerateAssistantResponse,
    showPreviousResponseVersion,
    showNextResponseVersion,
    showPreviousRetryVersion,
    showNextRetryVersion,
    cancel,
  } = useChatStore();
  const [draft, setDraft] = React.useState("");
  const [webSearch, setWebSearch] = React.useState(false);
  const [filesPanelSessionId, setFilesPanelSessionId] = React.useState<string | null>(null);
  const [filesPanelFocusId, setFilesPanelFocusId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFilesPanelSessionId(null);
    setFilesPanelFocusId(null);
  }, [activeSessionId]);

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
  const [modelMenuPosition, setModelMenuPosition] = React.useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320,
  });

  // 动态拉取当前用户可见的模型清单。
  // 管理员随时可能改变部门/用户的可见模型分配，因此这里不能只在挂载时拉一次：
  // 定期轮询 + 页面重新可见/聚焦时立即刷新，让列表与实际权限自动保持同步，无需用户手动刷新整页。
  const [availableModels, setAvailableModels] = React.useState<PortalModelOption[]>([]);
  const [modelsLoaded, setModelsLoaded] = React.useState(false);

  const refreshAvailableModels = React.useCallback(async () => {
    try {
      const res = await fetch("/api/me/models", { cache: "no-store" });
      const json = (await res.json()) as { data?: { models: PortalModelOption[] } };
      setAvailableModels(json.data?.models ?? []);
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

  // 收到模型列表后兜底选默认：优先 isDefault，否则首项
  React.useEffect(() => {
    if (!modelsLoaded) return;
    if (availableModels.length === 0) return;
    const exists = availableModels.find((m) => m.id === activeModel);
    if (exists) return;
    const next = availableModels.find((m) => m.isDefault) ?? availableModels[0];
    if (next) switchModel(next.id);
  }, [modelsLoaded, availableModels, activeModel, switchModel]);

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
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(360, Math.max(280, rect.width + 88));
      const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
      const top = Math.max(8, rect.top - 8);
      setModelMenuPosition({ top, left, width });
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
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      if (warnIfNonVision()) return;
      addFiles(imageFiles);
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
          webSearch,
          deepResearch: deepResearchMode,
        },
        opts?.forceSend ? { forceSend: true } : undefined,
      );
      setDraft("");
      clearAttachments();
    },
    [clearAttachments, client, deepResearchMode, draft, sendMessage, toMessageAttachments, webSearch],
  );

  const queuedForSession = React.useMemo(() => {
    if (!activeSessionId) return [];
    return pendingMessages.filter((message) => message.sessionId === activeSessionId);
  }, [activeSessionId, pendingMessages]);

  const composer = (
    <div className={cn("mx-auto w-full space-y-3", isEmpty ? "max-w-[46rem]" : "max-w-4xl")}>
      {historyError && (
        <Alert variant="warning" className="border-warning/30 bg-warning-soft/80 shadow-sm">
          <ShieldAlert className="h-5 w-5" />
          <div>
            <AlertTitle>{t("historySyncTitle")}</AlertTitle>
            <AlertDescription>{historyError}</AlertDescription>
          </div>
        </Alert>
      )}
      {errorMessage && (
        <Alert variant="warning" className="border-warning/30 bg-warning-soft/80 shadow-sm">
          <ShieldAlert className="h-5 w-5" />
          <div>
            <AlertTitle>
              {isComplianceError(errorMessage) ? t("complianceTitle") : t("chatErrorTitle")}
            </AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
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
        accept="image/*"
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
          deepResearchMode ? tw("deepResearchPlaceholder") : "发送消息给 Near..."
        }
        attachments={Object.values(attachments)}
        onAddFiles={handleAddFiles}
        onRemoveAttachment={removeAttachment}
        onPaste={handlePaste}
        leftToolbar={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("attachment")}
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (warnIfNonVision()) return;
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("uploadImage")}</TooltipContent>
            </Tooltip>
            <Button
              variant={webSearch ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setWebSearch((prev) => !prev)}
              className={`h-8 w-8 rounded-full ${webSearch ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Globe className="h-4 w-4" />
            </Button>
            {deepResearchMode ? (
              <span
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
                className="fixed z-[80] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-1 shadow-2xl backdrop-blur"
                style={{
                  width: modelMenuPosition.width,
                  left: modelMenuPosition.left,
                  top: modelMenuPosition.top,
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
            {sessionTokens.totalTokens > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="soft" className="mr-2 gap-1 px-2.5 py-0.5 font-mono text-[11px]">
                    <span aria-hidden>↑</span>
                    {sessionTokens.inputTokens.toLocaleString()}
                    <span className="opacity-50" aria-hidden>·</span>
                    <span aria-hidden>↓</span>
                    {sessionTokens.outputTokens.toLocaleString()}
                    <span className="opacity-50" aria-hidden>·</span>
                    Σ {sessionTokens.totalTokens.toLocaleString()}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {t("tokenTooltip", {
                    input: sessionTokens.inputTokens.toLocaleString(),
                    output: sessionTokens.outputTokens.toLocaleString(),
                    total: sessionTokens.totalTokens.toLocaleString(),
                  })}
                </TooltipContent>
              </Tooltip>
            )}
            {!isEmpty && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                    <Share className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("shareConversation")}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
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
            /* 空态：NEAR 字标靠上 + 收窄加高输入区（深度研究入口暂走侧栏） */
            <div className="relative flex h-full flex-col items-center justify-start gap-10 overflow-y-auto px-4 pt-14 pb-10 md:gap-12 md:pt-16 md:pb-16">
              <NearEmptyWordmark
                caption={deepResearchMode ? tw("deepResearchEmptySubtitle") : undefined}
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
              <MessageList
                messages={visibleMessages}
                className="h-full"
                styleVariant="im"
                assistantFrameless
                scrollToBottomLabel={t("scrollToBottom")}
                responseVersionMetaByUserMessageId={responseVersionMetaByUserMessageId}
                retryVersionMetaByUserMessageId={retryVersionMetaByUserMessageId}
                onShowPreviousResponseVersion={showPreviousResponseVersion}
                onShowNextResponseVersion={showNextResponseVersion}
                onShowPreviousRetryVersion={showPreviousRetryVersion}
                onShowNextRetryVersion={showNextRetryVersion}
                onRequestDeepResearchFiles={(sessionId, focusArtifactId) => {
                  setFilesPanelSessionId(sessionId);
                  setFilesPanelFocusId(focusArtifactId ?? null);
                }}
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
                  const url = `${window.location.origin}/workspace?share=${messageId}`;
                  navigator.clipboard.writeText(url);
                  console.log("Shared:", url);
                }}
                onFeedback={(messageId, type) => {
                  console.log(`Feedback ${type} for message ${messageId}`);
                }}
              />
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
          }
        }}
        sessionId={filesPanelSessionId}
        focusArtifactId={filesPanelFocusId}
        sources={filesPanelSources}
      />
      </div>
    </TooltipProvider>
  );
}
