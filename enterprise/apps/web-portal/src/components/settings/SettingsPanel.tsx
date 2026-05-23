"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  TooltipProvider,
} from "@agenticx/ui";
import {
  Bot,
  Check,
  FileSearch,
  Globe,
  MessageSquare,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  KeyRound,
  Trash2,
} from "lucide-react";

type TabId = "model-service" | "defaults" | "web-search" | "parser" | "chat" | "general";

const CHAT_STYLE_STORAGE_KEY = "agx-enterprise-chat-style";
const CHAT_STYLE_IDS = ["im", "terminal", "clean"] as const;
type ChatStyleVariant = (typeof CHAT_STYLE_IDS)[number];

export function SettingsPanel() {
  const t = useTranslations("settings");
  const [active, setActive] = useState<TabId>("general");
  const [provider, setProvider] = useState<string>("deepseek");
  const [webSearchOn, setWebSearchOn] = useState(true);
  const [streamingOn, setStreamingOn] = useState(true);
  const [autoTitleOn, setAutoTitleOn] = useState(true);
  const [chatStyle, setChatStyle] = useState<ChatStyleVariant>("im");
  const [patName, setPatName] = useState("");
  const [patPlain, setPatPlain] = useState<string | null>(null);
  const [patRows, setPatRows] = useState<Array<{ id: number; name: string; tokenPrefix: string; status: string }>>([]);

  const tabs = useMemo(
    () =>
      [
        { id: "general" as const, label: t("tabs.general"), description: t("tabDescriptions.general"), icon: <SettingsIcon className="h-4 w-4" /> },
        { id: "model-service" as const, label: t("tabs.modelService"), description: t("tabDescriptions.modelService"), icon: <Bot className="h-4 w-4" /> },
        { id: "defaults" as const, label: t("tabs.defaults"), description: t("tabDescriptions.defaults"), icon: <Sparkles className="h-4 w-4" /> },
        { id: "web-search" as const, label: t("tabs.webSearch"), description: t("tabDescriptions.webSearch"), icon: <Globe className="h-4 w-4" /> },
        { id: "parser" as const, label: t("tabs.parser"), description: t("tabDescriptions.parser"), icon: <FileSearch className="h-4 w-4" /> },
        { id: "chat" as const, label: t("tabs.chat"), description: t("tabDescriptions.chat"), icon: <MessageSquare className="h-4 w-4" /> },
      ] satisfies Array<{ id: TabId; label: string; description: string; icon: React.ReactNode }>,
    [t],
  );

  const chatStyleOptions = useMemo(
    () =>
      CHAT_STYLE_IDS.map((id) => ({
        id,
        label:
          id === "im"
            ? t("general.chatStyleIm")
            : id === "terminal"
              ? t("general.chatStyleTerminal")
              : t("general.chatStyleClean"),
      })),
    [t],
  );

  const providers = useMemo(
    () => [
      { id: "deepseek", name: "DeepSeek", tagline: t("modelService.providers.deepseekTagline"), color: "bg-chart-1/80" },
      { id: "moonshot", name: "Moonshot", tagline: t("modelService.providers.moonshotTagline"), color: "bg-chart-5/80" },
      { id: "openai", name: "OpenAI", tagline: t("modelService.providers.openaiTagline"), color: "bg-chart-2/80" },
      { id: "anthropic", name: "Anthropic", tagline: t("modelService.providers.anthropicTagline"), color: "bg-chart-3/80" },
    ],
    [t],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
    if (saved === "im" || saved === "terminal" || saved === "clean") {
      setChatStyle(saved);
    }
  }, []);

  useEffect(() => {
    if (active !== "general") return;
    void (async () => {
      try {
        const res = await fetch("/api/me/api-tokens");
        const json = await res.json();
        setPatRows(json.data?.tokens ?? []);
      } catch {
        setPatRows([]);
      }
    })();
  }, [active]);

  const createPat = async () => {
    const res = await fetch("/api/me/api-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: patName }),
    });
    const json = await res.json();
    if (json.code !== "00000") return;
    setPatPlain(json.data?.token ?? null);
    setPatName("");
    const listRes = await fetch("/api/me/api-tokens");
    const listJson = await listRes.json();
    setPatRows(listJson.data?.tokens ?? []);
  };

  const revokePat = async (id: number) => {
    await fetch(`/api/me/api-tokens?id=${id}`, { method: "DELETE" });
    setPatRows((rows) => rows.filter((r) => r.id !== id));
  };

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
            <h2 className="text-lg font-semibold">{t("title")}</h2>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-0 lg:grid-cols-[260px_1fr]">
          {/* 左侧纵向 nav */}
          <nav className="overflow-y-auto border-r border-border bg-surface-subtle/40 p-3">
            <div className="space-y-0.5">
              {tabs.map((tab) => {
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
                      <div className="text-sm font-medium">{tab.label}</div>
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
                title={t("tabs.general")}
                description={t("general.sectionDescription")}
                icon={<SettingsIcon className="h-4 w-4" />}
              >
                <SettingsRow
                  label={t("general.uiTheme")}
                  description={t("general.uiThemeDescription")}
                  control={<Badge variant="soft">{t("general.syncedToSystem")}</Badge>}
                />
                <SettingsRow
                  label={t("general.displayLanguage")}
                  description={t("general.displayLanguageDescription")}
                  control={<Badge variant="soft">{t("general.synced")}</Badge>}
                />
                <SettingsRow
                  label={t("general.chatStyle")}
                  description={t("general.chatStyleDescription")}
                  control={
                    <Select value={chatStyle} onValueChange={(value) => updateChatStyle(value as ChatStyleVariant)}>
                      <SelectTrigger className="w-[280px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {chatStyleOptions.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  label={t("general.dataImportExport")}
                  description={t("general.dataImportExportDescription")}
                  control={
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        {t("general.import")}
                      </Button>
                      <Button variant="outline" size="sm">
                        {t("general.export")}
                      </Button>
                    </div>
                  }
                />
              </SettingsSection>
            ) : null}

            {active === "general" ? (
              <div className="mt-6">
                <SettingsSection
                  title={t("apiTokens.title")}
                  description={t("apiTokens.description")}
                  icon={<KeyRound className="h-4 w-4" />}
                >
                  {patPlain ? (
                    <SettingsRow
                      label={t("apiTokens.plainTokenLabel")}
                      description={<code className="break-all text-xs">{patPlain}</code>}
                      control={
                        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(patPlain)}>
                          {t("apiTokens.copy")}
                        </Button>
                      }
                      stack
                    />
                  ) : null}
                  <SettingsRow
                    label={t("apiTokens.newToken")}
                    control={
                      <div className="flex w-full gap-2">
                        <Input value={patName} onChange={(e) => setPatName(e.target.value)} placeholder={t("apiTokens.newTokenPlaceholder")} />
                        <Button size="sm" onClick={() => void createPat()} disabled={!patName.trim()}>
                          {t("apiTokens.create")}
                        </Button>
                      </div>
                    }
                    stack
                  />
                  {patRows.map((row) => (
                    <SettingsRow
                      key={row.id}
                      label={row.name}
                      description={`${row.tokenPrefix}… · ${row.status}`}
                      control={
                        row.status === "active" ? (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void revokePat(row.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </SettingsSection>
              </div>
            ) : null}

            {active === "model-service" ? (
              <SettingsSection
                title={t("tabs.modelService")}
                description={t("modelService.sectionDescription")}
                icon={<Bot className="h-4 w-4" />}
              >
                <div>
                  <Label className="mb-2 block">{t("modelService.provider")}</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {providers.map((p) => {
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
                  label={t("modelService.apiKey")}
                  description={t("modelService.apiKeyDescription", { provider })}
                  control={<Input placeholder="sk-..." type="password" className="w-[320px]" />}
                  stack
                />
                <SettingsRow
                  label={t("modelService.endpoint")}
                  description={t("modelService.endpointDescription")}
                  control={<Input placeholder="https://api.example.com/v1" className="w-[320px]" />}
                  stack
                />
              </SettingsSection>
            ) : null}

            {active === "defaults" ? (
              <SettingsSection
                title={t("tabs.defaults")}
                description={t("defaults.sectionDescription")}
                icon={<Sparkles className="h-4 w-4" />}
              >
                <SettingsRow
                  label={t("defaults.defaultChatModel")}
                  description={t("defaults.defaultChatModelDescription")}
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
                  label={t("defaults.sessionNamingModel")}
                  description={t("defaults.sessionNamingModelDescription")}
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
                title={t("tabs.webSearch")}
                description={t("webSearch.sectionDescription")}
                icon={<Globe className="h-4 w-4" />}
                highlight={
                  webSearchOn
                    ? { label: t("webSearch.enabledLabel"), description: t("webSearch.enabledDescription"), variant: "success" }
                    : undefined
                }
              >
                <SettingsRow
                  label={t("webSearch.enableWebSearch")}
                  description={t("webSearch.enableWebSearchDescription")}
                  control={
                    <Switch
                      checked={webSearchOn}
                      onChange={setWebSearchOn}
                    />
                  }
                />
                {webSearchOn ? (
                  <SettingsRow
                    label={t("webSearch.searchApiKey")}
                    description={t("webSearch.searchApiKeyDescription")}
                    control={<Input placeholder="search-key-..." type="password" className="w-[320px]" />}
                    stack
                  />
                ) : null}
              </SettingsSection>
            ) : null}

            {active === "parser" ? (
              <SettingsSection
                title={t("tabs.parser")}
                description={t("parser.sectionDescription")}
                icon={<FileSearch className="h-4 w-4" />}
              >
                <SettingsRow
                  label={t("parser.defaultParser")}
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
                  label={t("parser.supportedFormats")}
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
                title={t("tabs.chat")}
                description={t("chat.sectionDescription")}
                icon={<MessageSquare className="h-4 w-4" />}
                highlight={
                  streamingOn
                    ? { label: t("chat.streamingEnabledLabel"), description: t("chat.streamingEnabledDescription"), variant: "success" }
                    : undefined
                }
              >
                <SettingsRow
                  label={t("chat.streaming")}
                  description={t("chat.streamingDescription")}
                  control={<Switch checked={streamingOn} onChange={setStreamingOn} />}
                />
                <SettingsRow
                  label={t("chat.autoTitle")}
                  description={t("chat.autoTitleDescription")}
                  control={<Switch checked={autoTitleOn} onChange={setAutoTitleOn} />}
                />
                <SettingsRow
                  label={t("chat.defaultTemperature")}
                  description={t("chat.defaultTemperatureDescription")}
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
