"use client";

import * as React from "react";
import { InputArea, MessageList, useChatStore } from "@agenticx/feature-chat";
import { type ChatClient } from "@agenticx/sdk-ts";
import {
  Check,
  ChevronDown,
  Cpu,
  FileText,
  Globe,
  MessageSquare,
  Microscope,
  Paperclip,
  ShieldAlert,
  Sparkles,
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

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    void sendMessage(client, { content: text });
    setDraft("");
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/* 顶部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/60 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <MachiAvatar size={30} className="h-[30px] w-[30px]" />
            <span className="text-sm font-medium">Machi Workspace</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={route.variant} className="gap-1">
                  <Cpu className="h-3 w-3" />
                  {t.routeLabel}: {route.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>根据模型推断的网关路由</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 主对话区 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* 背景水印 */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <MachiAvatar size={280} className="h-[220px] w-[220px] opacity-[0.035] dark:opacity-[0.06]" />
          </div>

          {isEmpty ? (
            /* 欢迎态 */
            <div className="relative flex h-full flex-col items-center justify-center gap-6 px-4 py-8">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="relative">
                  <span
                    aria-hidden
                    className="absolute inset-0 -m-3 rounded-full bg-primary/10 blur-xl"
                  />
                  <MachiAvatar size={64} className="relative h-16 w-16" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">今天我可以帮你做什么？</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    点击下方建议开始，或直接在输入框提问
                  </p>
                </div>
              </div>

              <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => {
                      setDraft(item.prompt);
                    }}
                    className="group flex flex-col gap-1.5 rounded-2xl border border-border/70 bg-surface-subtle/70 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary-soft/65 hover:shadow-md"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary group-hover:bg-primary/20">
                      {item.icon}
                    </span>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="relative h-full min-h-0 px-4 py-3 sm:px-5">
              <MessageList messages={messages} className="h-full" styleVariant={chatStyle} />
            </div>
          )}
        </div>

        {/* 底部输入区 */}
        <div className="shrink-0 border-t border-border bg-surface-subtle/40 p-3 sm:p-4">
          {errorMessage && (
            <Alert variant="warning" className="mb-3">
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
          />

          {/* 工具栏 toggle */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-background/90 px-2 py-2 shadow-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="xs" aria-label="附件" className="rounded-lg">
                  <Paperclip />
                  <span className="hidden sm:inline">附件</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>上传文件（即将上线）</TooltipContent>
            </Tooltip>
            <Button
              variant={webSearch ? "default" : "ghost"}
              size="xs"
              onClick={() => setWebSearch((prev) => !prev)}
              className="gap-1 rounded-lg"
            >
              <Globe />
              <span className="hidden sm:inline">联网</span>
            </Button>
            <Button
              variant={deepResearch ? "default" : "ghost"}
              size="xs"
              onClick={() => setDeepResearch((prev) => !prev)}
              className="gap-1 rounded-lg"
            >
              <Microscope />
              <span className="hidden sm:inline">Deep Research</span>
            </Button>
            <div ref={chatStyleMenuRef} className="relative">
              {chatStyleMenuOpen ? (
                <div className="absolute bottom-full left-0 z-[70] mb-2 w-[280px] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-1 shadow-2xl backdrop-blur">
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
                        className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          isActive ? "bg-primary-soft/70" : "hover:bg-muted/70"
                        }`}
                      >
                        <span className="mt-0.5 text-primary">
                          <MessageSquare className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-5 text-foreground">{style.label}</span>
                          <span className="block text-xs leading-5 text-muted-foreground">{style.desc}</span>
                        </span>
                        <span className={`pt-1 text-primary ${isActive ? "" : "opacity-0"}`}>
                          <Check className="h-4 w-4" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setChatStyleMenuOpen((prev) => !prev)}
                className="gap-1 rounded-lg"
              >
                <MessageSquare />
                <span className="hidden sm:inline">
                  {CHAT_STYLE_OPTIONS.find((item) => item.id === chatStyle)?.label ?? "聊天风格"}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${chatStyleMenuOpen ? "rotate-180" : ""}`} />
              </Button>
            </div>

            <div ref={modelMenuRef} className="relative ml-auto flex items-center gap-2">
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
                          <span className="block truncate text-base font-semibold leading-6 text-foreground">
                            {MODEL_LABELS[model] ?? model}
                          </span>
                          <span className="block truncate text-sm leading-5 text-muted-foreground">
                            {MODEL_DESCRIPTIONS[model] ?? ""}
                          </span>
                        </span>
                        <span className={`pt-1 text-base text-primary ${isSelected ? "" : "opacity-0"}`}>
                          <Check className="h-4 w-4" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <button
                ref={modelTriggerRef}
                type="button"
                onClick={() => setModelMenuOpen((prev) => !prev)}
                className="flex h-10 w-[240px] max-w-full items-center gap-2 rounded-full border border-border/70 bg-card px-3 text-left shadow-sm transition-colors hover:border-border hover:bg-background"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-primary">
                  {activeModel === "moonshot-v1-8k" ? (
                    <Microscope className="h-4 w-4" />
                  ) : activeModel === "gpt-4o-mini" ? (
                    <Cpu className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
                  {MODEL_LABELS[activeModel] ?? activeModel}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
