"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agenticx/ui";
import {
  Bot,
  Check,
  Database,
  FileSearch,
  Globe,
  Info,
  MessageSquare,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
} from "lucide-react";
import { usePortalCopy } from "../../lib/portal-copy";

type TabId = "model-service" | "defaults" | "web-search" | "parser" | "chat" | "general";

interface TabSpec {
  id: TabId;
  labelKey: "modelService" | "defaults" | "webSearch" | "parser" | "chat" | "general";
  icon: React.ReactNode;
  description: string;
}

const TABS: TabSpec[] = [
  { id: "general", labelKey: "general", icon: <SettingsIcon className="h-4 w-4" />, description: "语言 / 主题 / 数据导出" },
  { id: "model-service", labelKey: "modelService", icon: <Bot className="h-4 w-4" />, description: "API Key、Provider 配置" },
  { id: "defaults", labelKey: "defaults", icon: <Sparkles className="h-4 w-4" />, description: "默认模型与命名模型" },
  { id: "web-search", labelKey: "webSearch", icon: <Globe className="h-4 w-4" />, description: "联网搜索开关与密钥" },
  { id: "parser", labelKey: "parser", icon: <FileSearch className="h-4 w-4" />, description: "文档解析器选择" },
  { id: "chat", labelKey: "chat", icon: <MessageSquare className="h-4 w-4" />, description: "流式输出 / 自动命名" },
];

const PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", tagline: "国产开源", color: "bg-chart-1/80" },
  { id: "moonshot", name: "Moonshot", tagline: "长文本优势", color: "bg-chart-5/80" },
  { id: "openai", name: "OpenAI", tagline: "GPT-4o 系列", color: "bg-chart-2/80" },
  { id: "anthropic", name: "Anthropic", tagline: "Claude 系列", color: "bg-chart-3/80" },
];

const CHAT_STYLE_STORAGE_KEY = "agx-enterprise-chat-style";
const CHAT_STYLE_OPTIONS = [
  { id: "im", label: "IM 风格（头像 + 气泡）" },
  { id: "terminal", label: "Terminal 风格（终端前缀）" },
  { id: "clean", label: "Clean 风格（极简留白）" },
] as const;
type ChatStyleVariant = (typeof CHAT_STYLE_OPTIONS)[number]["id"];

export function SettingsPanel() {
  const t = usePortalCopy();
  const [active, setActive] = useState<TabId>("general");
  const [provider, setProvider] = useState<string>("deepseek");
  const [webSearchOn, setWebSearchOn] = useState(true);
  const [streamingOn, setStreamingOn] = useState(true);
  const [autoTitleOn, setAutoTitleOn] = useState(true);
  const [chatStyle, setChatStyle] = useState<ChatStyleVariant>("im");

  useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
    if (saved === "im" || saved === "terminal" || saved === "clean") {
      setChatStyle(saved);
    }
  }, []);

  const updateChatStyle = (next: ChatStyleVariant) => {
    setChatStyle(next);
    window.localStorage.setItem(CHAT_STYLE_STORAGE_KEY, next);
    window.dispatchEvent(
      new CustomEvent("agx-enterprise-chat-style-change", {
        detail: { style: next },
      }),
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-card">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t.settings}</h2>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-0 lg:grid-cols-[260px_1fr]">
          {/* 左侧纵向 nav */}
          <nav className="overflow-y-auto border-r border-border bg-surface-subtle/40 p-3">
            <div className="space-y-0.5">
              {TABS.map((tab) => {
                const isActive = active === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActive(tab.id)}
                    className={[
                      "group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                      isActive
                        ? "bg-primary-soft text-primary"
                        : "text-foreground/80 hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                        isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:bg-background",
                      ].join(" ")}
                    >
                      {tab.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t[tab.labelKey]}</div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{tab.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* 右侧内容 */}
          <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
            {active === "general" ? (
              <SettingsSection
                title={t.general}
                description="跨应用的通用偏好设置"
                icon={<SettingsIcon className="h-4 w-4" />}
              >
                <SettingsRow
                  label="界面主题"
                  description="可在右上角用户菜单随时切换 · 会记住你的偏好"
                  control={<Badge variant="soft">已同步至系统</Badge>}
                />
                <SettingsRow
                  label="显示语言"
                  description="中文 / English 双语 · 右上角用户菜单内切换"
                  control={<Badge variant="soft">已同步</Badge>}
                />
                <SettingsRow
                  label="聊天风格"
                  description="可在 IM / Terminal / Clean 三种风格间切换"
                  control={
                    <Select value={chatStyle} onValueChange={(value) => updateChatStyle(value as ChatStyleVariant)}>
                      <SelectTrigger className="w-[280px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHAT_STYLE_OPTIONS.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  label="数据导入 / 导出"
                  description="把当前本地配置导出为 JSON，或导入其他配置"
                  control={
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        导入
                      </Button>
                      <Button variant="outline" size="sm">
                        导出
                      </Button>
                    </div>
                  }
                />
              </SettingsSection>
            ) : null}

            {active === "model-service" ? (
              <SettingsSection
                title={t.modelService}
                description="选择云厂商并配置 API Key"
                icon={<Bot className="h-4 w-4" />}
              >
                <div>
                  <Label className="mb-2 block">Provider</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PROVIDERS.map((p) => {
                      const selected = p.id === provider;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProvider(p.id)}
                          className={[
                            "group flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-all",
                            selected
                              ? "border-primary shadow-sm ring-2 ring-primary/25"
                              : "border-border hover:border-border-strong",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary-foreground",
                              p.color,
                            ].join(" ")}
                          >
                            <Bot className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.tagline}</div>
                          </div>
                          {selected ? (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <SettingsRow
                  label="API Key"
                  description={`已选择 ${provider} · 密钥仅保存在浏览器本地`}
                  control={<Input placeholder="sk-..." type="password" className="w-[320px]" />}
                  stack
                />
                <SettingsRow
                  label="Endpoint"
                  description="自定义 OpenAI 兼容 Base URL（可选）"
                  control={<Input placeholder="https://api.example.com/v1" className="w-[320px]" />}
                  stack
                />
              </SettingsSection>
            ) : null}

            {active === "defaults" ? (
              <SettingsSection
                title={t.defaults}
                description="为新会话挑选默认模型"
                icon={<Sparkles className="h-4 w-4" />}
              >
                <SettingsRow
                  label="默认对话模型"
                  description="新建会话时会自动选中"
                  control={
                    <Select defaultValue="deepseek-chat">
                      <SelectTrigger className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
                        <SelectItem value="moonshot-v1-8k">moonshot-v1-8k</SelectItem>
                        <SelectItem value="gpt-4o-mini">gpt-4o-mini</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  label="会话命名模型"
                  description="系统自动为会话起名时使用"
                  control={
                    <Select defaultValue="moonshot-v1-8k">
                      <SelectTrigger className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="moonshot-v1-8k">moonshot-v1-8k</SelectItem>
                        <SelectItem value="deepseek-chat">deepseek-chat</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsSection>
            ) : null}

            {active === "web-search" ? (
              <SettingsSection
                title={t.webSearch}
                description="联网搜索为模型补充实时信息"
                icon={<Globe className="h-4 w-4" />}
                highlight={
                  webSearchOn
                    ? { label: "已启用", description: "新消息可主动调用 Web Search", variant: "success" }
                    : undefined
                }
              >
                <SettingsRow
                  label="启用联网搜索"
                  description="开启后聊天消息可调用 Web Search 工具"
                  control={
                    <Switch
                      checked={webSearchOn}
                      onChange={setWebSearchOn}
                    />
                  }
                />
                {webSearchOn ? (
                  <SettingsRow
                    label="Search Provider API Key"
                    description="支持 Bing / SerpAPI / 百川 · 密钥仅本地存储"
                    control={<Input placeholder="search-key-..." type="password" className="w-[320px]" />}
                    stack
                  />
                ) : null}
              </SettingsSection>
            ) : null}

            {active === "parser" ? (
              <SettingsSection
                title={t.parser}
                description="文件上传时的解析策略"
                icon={<FileSearch className="h-4 w-4" />}
              >
                <SettingsRow
                  label="默认解析器"
                  control={
                    <Select defaultValue="machi-ai">
                      <SelectTrigger className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="machi-ai">Machi AI</SelectItem>
                        <SelectItem value="mineru">MinerU</SelectItem>
                        <SelectItem value="textract">Textract</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  label="支持的格式"
                  control={
                    <div className="flex flex-wrap gap-1.5">
                      {["PDF", "Word", "Excel", "PPT", "JPG", "PNG"].map((format) => (
                        <Badge key={format} variant="outline">
                          {format}
                        </Badge>
                      ))}
                    </div>
                  }
                />
              </SettingsSection>
            ) : null}

            {active === "chat" ? (
              <SettingsSection
                title={t.chat}
                description="对话体验相关的细节偏好"
                icon={<MessageSquare className="h-4 w-4" />}
                highlight={
                  streamingOn
                    ? { label: "流式输出已启用", description: "回复将边生成边显示", variant: "success" }
                    : undefined
                }
              >
                <SettingsRow
                  label="流式输出"
                  description="SSE 实时渲染，首 token 延迟更低"
                  control={<Switch checked={streamingOn} onChange={setStreamingOn} />}
                />
                <SettingsRow
                  label="自动命名会话"
                  description="首条消息后自动为会话生成标题"
                  control={<Switch checked={autoTitleOn} onChange={setAutoTitleOn} />}
                />
                <SettingsRow
                  label="默认温度"
                  description="数值越低越确定，越高越多样"
                  control={<Input type="number" defaultValue={0.7} step={0.1} className="w-[120px]" />}
                />
              </SettingsSection>
            ) : null}
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}

/* ============================================================
 * 辅助组件
 * ============================================================ */

function SettingsSection({
  title,
  description,
  icon,
  highlight,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  highlight?: { label: string; description?: string; variant: "success" | "warning" | "info" };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
            {icon}
          </span>
        ) : null}
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      {highlight ? (
        <div
          className={[
            "flex items-start gap-2 rounded-lg border p-3",
            highlight.variant === "success"
              ? "border-success/30 bg-success-soft"
              : highlight.variant === "warning"
              ? "border-warning/40 bg-warning-soft"
              : "border-info/30 bg-info-soft",
          ].join(" ")}
        >
          <Shield
            className={[
              "mt-0.5 h-4 w-4",
              highlight.variant === "success"
                ? "text-success"
                : highlight.variant === "warning"
                ? "text-warning"
                : "text-info",
            ].join(" ")}
          />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{highlight.label}</div>
            {highlight.description ? (
              <div className="text-xs text-muted-foreground">{highlight.description}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent className="divide-y divide-border p-0">{children}</CardContent>
      </Card>
    </div>
  );
}

function SettingsRow({
  label,
  description,
  control,
  stack,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <div
      className={[
        "flex gap-4 px-4 py-3.5 sm:px-5",
        stack ? "flex-col items-stretch" : "flex-col items-start sm:flex-row sm:items-center sm:justify-between",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      <div className={stack ? "" : "shrink-0"}>{control}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
