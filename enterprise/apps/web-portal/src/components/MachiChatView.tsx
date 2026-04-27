"use client";

import * as React from "react";
import { InputArea, MessageList, useChatStore } from "@agenticx/feature-chat";
import { type ChatClient } from "@agenticx/sdk-ts";
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  FileText,
  Globe,
  Link,
  Microscope,
  Paperclip,
  Pencil,
  RefreshCw,
  Share,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  MachiAvatar,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agenticx/ui";
import { usePortalCopy } from "../lib/portal-copy";

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
};

type MachiChatViewProps = {
  client: ChatClient;
};


const SUGGESTIONS = [
  {
    icon: <Sparkles className="h-4 w-4" />,
    title: "产品设计头脑风暴",
    description: "给我 5 个改善员工入职体验的创意",
    prompt: "帮我头脑风暴 5 个改善员工入职体验的创意，并给出可落地的第一步",
  },
  {
    icon: <FileText className="h-4 w-4" />,
    title: "文档摘要",
    description: "把刚才那段内容改写得更简洁",
    prompt: "请把以下内容改写得更简洁、更有条理（保持原意）：\n\n",
  },
  {
    icon: <Wand2 className="h-4 w-4" />,
    title: "对话格式美化",
    description: "把会议纪要整理成可分发的日报",
    prompt: "把下面的会议纪要整理为可分发的日报（含决定/行动项/截止）：\n\n",
  },
];

export function MachiChatView({ client }: MachiChatViewProps) {
  const t = usePortalCopy();
  const {
    activeSessionId,
    messages,
    status,
    activeModel,
    errorMessage,
    sessionTokens,
    responseVersionsByUserMessageId,
    bootstrap,
    switchModel,
    sendMessage,
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
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const modelMenuRef = React.useRef<HTMLDivElement>(null);
  const modelTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [modelMenuPosition, setModelMenuPosition] = React.useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320,
  });

  // 动态拉取当前用户可见的模型清单
  const [availableModels, setAvailableModels] = React.useState<PortalModelOption[]>([]);
  const [modelsLoaded, setModelsLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/me/models", { cache: "no-store" });
        const json = (await res.json()) as { data?: { models: PortalModelOption[] } };
        if (alive) {
          setAvailableModels(json.data?.models ?? []);
          setModelsLoaded(true);
        }
      } catch {
        if (alive) setModelsLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 收到模型列表后兜底选默认：优先 isDefault，否则首项
  React.useEffect(() => {
    if (!modelsLoaded) return;
    if (availableModels.length === 0) return;
    const exists = availableModels.find((m) => m.id === activeModel);
    if (exists) return;
    const next = availableModels.find((m) => m.isDefault) ?? availableModels[0];
    if (next) switchModel(next.id);
  }, [modelsLoaded, availableModels, activeModel, switchModel]);

  React.useEffect(() => {
    if (!activeSessionId) {
      const initial = availableModels.find((m) => m.isDefault) ?? availableModels[0];
      bootstrap({ defaultModel: initial?.id });
    }
  }, [activeSessionId, bootstrap, availableModels]);

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
    [availableModels, activeModel]
  );
  const isEmpty = messages.length === 0;
  React.useEffect(() => {
    setModelMenuOpen(false);
  }, [isEmpty]);
  const { responseVersionMetaByUserMessageId, retryVersionMetaByUserMessageId } = React.useMemo(() => {
    const queryMeta: Record<string, { activeIndex: number; total: number }> = {};
    const retryMeta: Record<string, { activeIndex: number; total: number }> = {};

    Object.entries(responseVersionsByUserMessageId).forEach(([userMessageId, versionState]) => {
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
  }, [responseVersionsByUserMessageId]);
  const [sessionTitle, setSessionTitle] = React.useState("新对话");
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    void sendMessage(client, { content: text });
    setDraft("");
  };

  const composer = (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      {errorMessage && (
        <Alert variant="warning" className="border-warning/30 bg-warning-soft/80 shadow-sm">
          <ShieldAlert className="h-5 w-5" />
          <AlertTitle>{t.complianceTitle}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <InputArea
        value={draft}
        status={status}
        onChange={setDraft}
        onSend={() => handleSend(draft)}
        onCancel={() => void cancel(client)}
        appearance="portal"
        leftToolbar={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="附件" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                  <Paperclip className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>上传文件（即将上线）</TooltipContent>
            </Tooltip>
            <Button
              variant={webSearch ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setWebSearch((prev) => !prev)}
              className={`h-8 w-8 rounded-full ${webSearch ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Globe className="h-4 w-4" />
            </Button>
            <Button
              variant={deepResearch ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setDeepResearch((prev) => !prev)}
              className={`h-8 w-8 rounded-full ${deepResearch ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Microscope className="h-4 w-4" />
            </Button>
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
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    暂无可用模型，请联系管理员在「平台配置 · 模型服务」启用并分配。
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
              <span>{activeOption?.label ?? (modelsLoaded ? "无可用模型" : "加载中...")}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
        }
      />
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/* 顶部 - 对话标题 */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 pl-14 lg:pl-6">
          <div className="flex items-center gap-2">
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                onBlur={() => setIsEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setIsEditingTitle(false);
                  if (e.key === "Escape") setIsEditingTitle(false);
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
              <span className="hidden sm:inline">Gateway online</span>
              <span className="sm:hidden">on</span>
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
                  本会话累计 token：输入 {sessionTokens.inputTokens.toLocaleString()} · 输出{" "}
                  {sessionTokens.outputTokens.toLocaleString()} · 合计 {sessionTokens.totalTokens.toLocaleString()}
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
                <TooltipContent>分享对话</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除对话</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 主对话区 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {isEmpty ? (
            /* 欢迎态 */
            <div className="relative flex h-full flex-col items-center justify-start gap-8 overflow-y-auto px-4 py-8 md:justify-center">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <MachiAvatar size={210} className="relative h-[210px] w-[210px]" />
                </div>
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight text-foreground">我是 Machi</h2>
                  <p className="mt-2 text-base text-muted-foreground/80">
                    很高兴见到你，有什么我可以帮忙的吗？
                  </p>
                </div>
              </div>

              <div className="mt-4 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
                {SUGGESTIONS.slice(0, 2).map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => {
                      setDraft(item.prompt);
                    }}
                    className="group flex items-start gap-3 rounded-[20px] border border-border/40 bg-surface-subtle/50 px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:bg-surface-subtle hover:shadow-sm"
                  >
                    <span className="mt-0.5 flex shrink-0 text-muted-foreground group-hover:text-primary">
                      {item.icon}
                    </span>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground/80">{item.description}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-2 w-full">
                {composer}
              </div>
            </div>
          ) : (
            <div className="relative h-full min-h-0">
              <MessageList
                messages={messages}
                className="h-full"
                styleVariant="im"
                assistantFrameless
                responseVersionMetaByUserMessageId={responseVersionMetaByUserMessageId}
                retryVersionMetaByUserMessageId={retryVersionMetaByUserMessageId}
                onShowPreviousResponseVersion={showPreviousResponseVersion}
                onShowNextResponseVersion={showNextResponseVersion}
                onShowPreviousRetryVersion={showPreviousRetryVersion}
                onShowNextRetryVersion={showNextRetryVersion}
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
    </TooltipProvider>
  );
}
