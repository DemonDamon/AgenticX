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
  MessageSquare,
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

const MODELS = ["deepseek-chat", "moonshot-v1-8k", "gpt-4o-mini"];
const MODEL_LABELS: Record<string, string> = {
  "deepseek-chat": "DeepSeek Chat",
  "moonshot-v1-8k": "Moonshot v1",
  "gpt-4o-mini": "GPT-4o Mini",
};
const MODEL_DESCRIPTIONS: Record<string, string> = {
  "deepseek-chat": "适合日常问答与知识检索",
  "moonshot-v1-8k": "擅长长文理解与总结",
  "gpt-4o-mini": "通用稳定，响应速度快",
};
const CHAT_STYLE_OPTIONS = [
  { id: "im", label: "IM 风格", desc: "头像 + 气泡，更亲和" },
  { id: "terminal", label: "Terminal 风格", desc: "前缀分明，信息密度高" },
  { id: "clean", label: "Clean 风格", desc: "留白更大，阅读更舒服" },
] as const;
type ChatStyleVariant = (typeof CHAT_STYLE_OPTIONS)[number]["id"];
const CHAT_STYLE_STORAGE_KEY = "agx-enterprise-chat-style";

type MachiChatViewProps = {
  client: ChatClient;
};

function inferRoute(model: string): { label: string; variant: "success" | "info" | "warning" } {
  if (model.includes("local")) return { label: "local", variant: "success" };
  if (model.includes("moonshot")) return { label: "private-cloud", variant: "info" };
  return { label: "third-party", variant: "warning" };
}

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
    bootstrap,
    switchModel,
    sendMessage,
    cancel,
  } = useChatStore();
  const [draft, setDraft] = React.useState("");
  const [webSearch, setWebSearch] = React.useState(false);
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [chatStyle, setChatStyle] = React.useState<ChatStyleVariant>("im");
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [chatStyleMenuOpen, setChatStyleMenuOpen] = React.useState(false);
  const modelMenuRef = React.useRef<HTMLDivElement>(null);
  const modelTriggerRef = React.useRef<HTMLButtonElement>(null);
  const chatStyleMenuRef = React.useRef<HTMLDivElement>(null);
  const [modelMenuPosition, setModelMenuPosition] = React.useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320,
  });

  React.useEffect(() => {
    if (!activeSessionId) {
      bootstrap({ defaultModel: MODELS[0] });
    }
  }, [activeSessionId, bootstrap]);

  React.useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
    if (saved === "im" || saved === "terminal" || saved === "clean") {
      setChatStyle(saved);
    }
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(CHAT_STYLE_STORAGE_KEY, chatStyle);
  }, [chatStyle]);

  React.useEffect(() => {
    const onStyleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ style?: string }>).detail;
      const style = detail?.style;
      if (style === "im" || style === "terminal" || style === "clean") {
        setChatStyle(style);
      }
    };
    window.addEventListener("agx-enterprise-chat-style-change", onStyleChange as EventListener);
    return () => {
      window.removeEventListener("agx-enterprise-chat-style-change", onStyleChange as EventListener);
    };
  }, []);

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

  React.useEffect(() => {
    if (!chatStyleMenuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      const el = chatStyleMenuRef.current;
      if (!el) return;
      if (!el.contains(event.target as Node)) setChatStyleMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatStyleMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [chatStyleMenuOpen]);

  const route = inferRoute(activeModel);
  const isEmpty = messages.length === 0;
  const [sessionTitle, setSessionTitle] = React.useState("新对话");
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    void sendMessage(client, { content: text });
    setDraft("");
  };

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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                  <Share className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>分享对话</TooltipContent>
            </Tooltip>
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
            <div className="relative flex h-full flex-col items-center justify-center gap-8 px-4 py-8">
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
            </div>
          ) : (
            <div className="relative h-full min-h-0">
              <MessageList
                messages={messages}
                className="h-full"
                styleVariant={chatStyle}
                onCopy={(content) => {
                  console.log("Copied:", content);
                }}
                onRetry={(messageId) => {
                  const msg = messages.find((m) => m.id === messageId);
                  if (msg?.content) {
                    void sendMessage(client, { content: msg.content });
                  }
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

        {/* 底部输入区 */}
        <div className="relative z-10 shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-6 pt-4 sm:px-6 sm:pb-8">
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
                  <div ref={chatStyleMenuRef} className="relative">
                    {chatStyleMenuOpen ? (
                      <div className="absolute bottom-full left-0 z-[70] mb-2 w-[240px] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-1 shadow-2xl backdrop-blur">
                        {CHAT_STYLE_OPTIONS.map((style) => {
                          const isActive = style.id === chatStyle;
                          return (
                            <button
                              key={style.id}
                              type="button"
                              onClick={() => {
                                setChatStyle(style.id);
                                window.localStorage.setItem(CHAT_STYLE_STORAGE_KEY, style.id);
                                window.dispatchEvent(
                                  new CustomEvent("agx-enterprise-chat-style-change", {
                                    detail: { style: style.id },
                                  }),
                                );
                                setChatStyleMenuOpen(false);
                              }}
                              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                                isActive ? "bg-primary-soft/70 text-primary" : "hover:bg-muted/70"
                              }`}
                            >
                              <MessageSquare className="h-4 w-4 shrink-0" />
                              <span className="flex-1 text-sm font-medium">{style.label}</span>
                              {isActive && <Check className="h-4 w-4 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setChatStyleMenuOpen((prev) => !prev)}
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                  </div>
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
                      {MODELS.map((model) => {
                        const isSelected = model === activeModel;
                        const icon =
                          model === "moonshot-v1-8k" ? (
                            <Microscope className="h-4 w-4" />
                          ) : model === "gpt-4o-mini" ? (
                            <Cpu className="h-4 w-4" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          );
                        return (
                          <button
                            key={model}
                            type="button"
                            onClick={() => {
                              switchModel(model);
                              setModelMenuOpen(false);
                            }}
                            className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${isSelected ? "bg-primary-soft/70" : "hover:bg-muted/70"}`}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 text-primary">{icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold leading-5 text-foreground">
                                {MODEL_LABELS[model] ?? model}
                              </span>
                              <span className="block truncate text-[11px] leading-4 text-muted-foreground mt-0.5">
                                {MODEL_DESCRIPTIONS[model] ?? ""}
                              </span>
                            </span>
                            {isSelected && <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <button
                    ref={modelTriggerRef}
                    type="button"
                    onClick={() => setModelMenuOpen((prev) => !prev)}
                    className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  >
                    <span>{MODEL_LABELS[activeModel] ?? activeModel}</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                </div>
              }
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
