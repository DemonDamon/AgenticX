"use client";

import * as React from "react";
import { InputArea, MessageList, ModelSelector, useChatStore } from "@agenticx/feature-chat";
import { type ChatClient } from "@agenticx/sdk-ts";
import {
  Cpu,
  FileText,
  Globe,
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
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agenticx/ui";
import { usePortalCopy } from "../lib/portal-copy";

const MODELS = ["deepseek-chat", "moonshot-v1-8k", "gpt-4o-mini"];

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

  React.useEffect(() => {
    if (!activeSessionId) {
      bootstrap({ defaultModel: MODELS[0] });
    }
  }, [activeSessionId, bootstrap]);

  const route = inferRoute(activeModel);
  const isEmpty = messages.length === 0;

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    void sendMessage(client, { content: text });
    setDraft("");
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 顶部 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MachiAvatar size={28} className="h-7 w-7" />
            <span className="text-sm font-medium">Machi Workspace</span>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={route.variant} className="gap-1">
                  <Cpu className="h-3 w-3" />
                  {t.routeLabel}: {route.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>根据模型推断的网关路由</TooltipContent>
            </Tooltip>
            <ModelSelector value={activeModel} options={MODELS} onChange={switchModel} />
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

              <div className="grid w-full max-w-3xl gap-2.5 sm:grid-cols-3">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => {
                      setDraft(item.prompt);
                    }}
                    className="group flex flex-col gap-1.5 rounded-xl border border-border bg-surface-subtle p-3.5 text-left transition-all hover:border-primary/40 hover:bg-primary-soft/60 hover:shadow-sm"
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
            <div className="relative h-full px-4 py-3">
              <MessageList messages={messages} />
            </div>
          )}
        </div>

        {/* 底部输入区 */}
        <div className="border-t border-border bg-surface-subtle/50 p-3 sm:p-4">
          {errorMessage && (
            <Alert variant="warning" className="mb-3">
              <ShieldAlert className="h-5 w-5" />
              <AlertTitle>{t.complianceTitle}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="rounded-xl border border-border bg-background shadow-sm transition-shadow focus-within:border-ring focus-within:shadow-md">
            <InputArea
              value={draft}
              status={status}
              onChange={setDraft}
              onSend={() => handleSend(draft)}
              onCancel={() => void cancel(client)}
            />
            <Separator />
            {/* 工具栏 toggle */}
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="xs" aria-label="附件">
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
                className="gap-1"
              >
                <Globe />
                <span className="hidden sm:inline">联网</span>
              </Button>
              <Button
                variant={deepResearch ? "default" : "ghost"}
                size="xs"
                onClick={() => setDeepResearch((prev) => !prev)}
                className="gap-1"
              >
                <Microscope />
                <span className="hidden sm:inline">Deep Research</span>
              </Button>
              <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="hidden sm:inline">Enter 发送 · Shift+Enter 换行</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
