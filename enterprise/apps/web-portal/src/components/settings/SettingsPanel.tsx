"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useChatStore } from "@agenticx/feature-chat";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TooltipProvider,
  toast,
} from "@agenticx/ui";
import {
  FileSearch,
  LockKeyhole,
  MessageSquare,
  Settings as SettingsIcon,
  Shield,
  KeyRound,
  Trash2,
} from "lucide-react";
import {
  readDefaultModelPreference,
  resolveAvailableDefaultModel,
  writeDefaultModelPreference,
} from "../../lib/default-model-preference";

type TabId = "general" | "chat" | "parser";
type CurrentPasswordStatus = "idle" | "checking" | "valid" | "invalid";

const CHAT_STYLE_STORAGE_KEY = "agx-enterprise-chat-style";
const CHAT_STYLE_IDS = ["im", "terminal", "clean"] as const;
type ChatStyleVariant = (typeof CHAT_STYLE_IDS)[number];
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

export function SettingsPanel() {
  const t = useTranslations("settings");
  const [active, setActive] = useState<TabId>("general");
  const [availableModels, setAvailableModels] = useState<PortalModelOption[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoadFailed, setModelsLoadFailed] = useState(false);
  const [defaultModel, setDefaultModel] = useState("");
  const [streamingOn, setStreamingOn] = useState(true);
  const [autoTitleOn, setAutoTitleOn] = useState(true);
  const [chatStyle, setChatStyle] = useState<ChatStyleVariant>("im");
  const [patName, setPatName] = useState("");
  const [patPlain, setPatPlain] = useState<string | null>(null);
  const [patRows, setPatRows] = useState<Array<{ id: number; name: string; tokenPrefix: string; status: string }>>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [currentPasswordStatus, setCurrentPasswordStatus] = useState<CurrentPasswordStatus>("idle");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const tabs = useMemo(
    () =>
      [
        { id: "general" as const, label: t("tabs.general"), description: t("tabDescriptions.general"), icon: <SettingsIcon className="h-4 w-4" /> },
        { id: "chat" as const, label: t("tabs.chat"), description: t("tabDescriptions.chat"), icon: <MessageSquare className="h-4 w-4" /> },
        { id: "parser" as const, label: t("tabs.parser"), description: t("tabDescriptions.parser"), icon: <FileSearch className="h-4 w-4" /> },
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

  const newPasswordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const newPasswordsMatch = newPassword.length >= 8 && newPassword === confirmNewPassword;
  const newPasswordsMismatch = confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;
  const canChangePassword = currentPasswordStatus === "valid" && newPasswordsMatch && !passwordSaving;

  useEffect(() => {
    const saved = window.localStorage.getItem(CHAT_STYLE_STORAGE_KEY);
    if (saved === "im" || saved === "terminal" || saved === "clean") {
      setChatStyle(saved);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/me/models", { cache: "no-store" });
        if (!response.ok) throw new Error("model list unavailable");
        const payload = (await response.json()) as {
          data?: { models?: PortalModelOption[] };
        };
        const models = payload.data?.models ?? [];
        const selected = resolveAvailableDefaultModel(
          models,
          readDefaultModelPreference(),
          useChatStore.getState().activeModel,
        );
        if (cancelled) return;
        setAvailableModels(models);
        setDefaultModel(selected?.id ?? "");
        setModelsLoadFailed(false);
      } catch {
        if (cancelled) return;
        setAvailableModels([]);
        setDefaultModel("");
        setModelsLoadFailed(true);
      } finally {
        if (!cancelled) setModelsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const verifyCurrentPasswordInput = async () => {
    if (!currentPassword.trim() || currentPasswordStatus === "checking") return;
    setCurrentPasswordStatus("checking");
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword }),
      });
      setCurrentPasswordStatus(res.ok ? "valid" : "invalid");
    } catch {
      setCurrentPasswordStatus("invalid");
    }
  };

  const changePassword = async () => {
    if (!canChangePassword) return;
    setPasswordSaving(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        setCurrentPasswordStatus("invalid");
        toast.error(t("password.failed"));
        return;
      }
      setCurrentPassword("");
      setCurrentPasswordStatus("idle");
      setNewPassword("");
      setConfirmNewPassword("");
      toast.success(t("password.success"));
    } catch {
      toast.error(t("password.failed"));
    } finally {
      setPasswordSaving(false);
    }
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
                  title={t("password.title")}
                  description={t("password.description")}
                  icon={<LockKeyhole className="h-4 w-4" />}
                >
                  <SettingsRow
                    label={t("password.currentPassword")}
                    description={t("password.currentPasswordDescription")}
                    control={
                      <div className="flex w-full flex-col gap-2 sm:max-w-[460px]">
                        <div className="flex gap-2">
                          <Input
                            type="password"
                            autoComplete="new-password"
                            name="verify-current-password"
                            value={currentPassword}
                            onChange={(event) => {
                              setCurrentPassword(event.target.value);
                              setCurrentPasswordStatus("idle");
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void verifyCurrentPasswordInput();
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!currentPassword.trim() || currentPasswordStatus === "checking"}
                            onClick={() => void verifyCurrentPasswordInput()}
                          >
                            {currentPasswordStatus === "checking" ? t("password.checking") : t("password.verify")}
                          </Button>
                        </div>
                        {currentPasswordStatus === "valid" ? (
                          <Badge variant="success">{t("password.currentValid")}</Badge>
                        ) : currentPasswordStatus === "invalid" ? (
                          <Badge variant="destructive">{t("password.currentInvalid")}</Badge>
                        ) : null}
                      </div>
                    }
                    stack
                  />
                  <SettingsRow
                    label={t("password.newPassword")}
                    description={t("password.newPasswordDescription")}
                    control={
                      <div className="flex w-full flex-col gap-2 sm:max-w-[460px]">
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                        />
                      </div>
                    }
                    stack
                  />
                  <SettingsRow
                    label={t("password.confirmNewPassword")}
                    control={
                      <div className="flex w-full flex-col gap-2 sm:max-w-[460px]">
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={confirmNewPassword}
                          onChange={(event) => setConfirmNewPassword(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void changePassword();
                          }}
                        />
                        {newPasswordsMatch ? (
                          <Badge variant="success">{t("password.match")}</Badge>
                        ) : newPasswordsMismatch ? (
                          <Badge variant="destructive">{t("password.mismatch")}</Badge>
                        ) : newPasswordTooShort ? (
                          <Badge variant="warning">{t("password.tooShort")}</Badge>
                        ) : null}
                      </div>
                    }
                    stack
                  />
                  <SettingsRow
                    label={t("password.submit")}
                    control={
                      <Button onClick={() => void changePassword()} disabled={!canChangePassword}>
                        {passwordSaving ? t("password.saving") : t("password.submit")}
                      </Button>
                    }
                  />
                </SettingsSection>
              </div>
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
                        <SelectItem value="machi-ai">和创智派 AI</SelectItem>
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
                  label={t("defaults.defaultChatModel")}
                  description={
                    modelsLoadFailed
                      ? t("defaults.loadFailed")
                      : modelsLoaded && availableModels.length === 0
                        ? t("defaults.noModelsHint")
                        : t("defaults.defaultChatModelDescription")
                  }
                  control={
                    <Select
                      value={defaultModel}
                      disabled={!modelsLoaded || modelsLoadFailed || availableModels.length === 0}
                      onValueChange={(next) => {
                        setDefaultModel(next);
                        writeDefaultModelPreference(next);
                      }}
                    >
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder={modelsLoaded ? t("defaults.noModels") : t("defaults.loadingModels")} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label} · {model.providerLabel}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
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

function Switch({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled ? "cursor-not-allowed opacity-50" : "",
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
