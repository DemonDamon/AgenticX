"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { HttpChatClient, MockChatClient } from "@agenticx/sdk-ts";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MachiAvatar,
  Separator,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useLocale,
  useUiTheme,
} from "@agenticx/ui";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Microscope,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Settings,
  Sun,
  Trash2,
  Languages,
} from "lucide-react";
import { useChatStore } from "@agenticx/feature-chat";
import { MachiChatView } from "./MachiChatView";
import { SettingsPanel } from "./settings/SettingsPanel";

type WorkspaceShellProps = {
  userEmail: string;
  userScopes: string[];
};

type PanelMode = "chat" | "settings";
type HistorySession = {
  id: string;
  title: string;
  /** 列表排序与分组锚点：对齐 Machi Desktop，仅用创建时间，避免切换 session 时 updated_at 变化导致跳动 */
  createdAt: number;
};

const COLLAPSED_KEY = "agenticx-portal-sidebar-collapsed";

function getSessionCreatedTimestampMs(session: Pick<HistorySession, "createdAt">): number {
  const created = Number(session.createdAt);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

function sortHistorySessions(rows: HistorySession[]): HistorySession[] {
  return [...rows].sort((a, b) => {
    const tsDiff = getSessionCreatedTimestampMs(b) - getSessionCreatedTimestampMs(a);
    if (tsDiff !== 0) return tsDiff;
    return b.id.localeCompare(a.id);
  });
}

function groupHistory(
  history: HistorySession[],
  labels: {
    today: string;
    yesterday: string;
    week: string;
    month: string;
    older: string;
  },
): Array<{ key: string; label: string; items: HistorySession[] }> {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 3600 * 1000;
  const startWeek = startToday - 7 * 24 * 3600 * 1000;
  const startMonth = startToday - 30 * 24 * 3600 * 1000;
  const buckets = {
    today: [] as HistorySession[],
    yesterday: [] as HistorySession[],
    week: [] as HistorySession[],
    month: [] as HistorySession[],
    older: [] as HistorySession[],
  };
  for (const item of history) {
    const createdAt = getSessionCreatedTimestampMs(item);
    if (createdAt >= startToday) buckets.today.push(item);
    else if (createdAt >= startYesterday) buckets.yesterday.push(item);
    else if (createdAt >= startWeek) buckets.week.push(item);
    else if (createdAt >= startMonth) buckets.month.push(item);
    else buckets.older.push(item);
  }
  return [
    { key: "today", label: labels.today, items: buckets.today },
    { key: "yesterday", label: labels.yesterday, items: buckets.yesterday },
    { key: "week", label: labels.week, items: buckets.week },
    { key: "month", label: labels.month, items: buckets.month },
    { key: "older", label: labels.older, items: buckets.older },
  ].filter((group) => group.items.length > 0);
}

export function WorkspaceShell({ userEmail, userScopes }: WorkspaceShellProps) {
  const router = useRouter();
  const t = useTranslations("workspace");
  const showAdminEntry = userScopes.includes("admin:enter");
  const { locale, setLocale } = useLocale();
  const { resolved: resolvedTheme, theme, setTheme, toggle: toggleTheme } = useUiTheme();
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeModel = useChatStore((s) => s.activeModel);
  const historyLoading = useChatStore((s) => s.historyLoading);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const renameSessionInStore = useChatStore((s) => s.renameSession);
  const deleteSessionInStore = useChatStore((s) => s.deleteSession);

  const history = React.useMemo<HistorySession[]>(
    () =>
      sortHistorySessions(
        sessions.map((session) => ({
          id: session.id,
          title: session.title,
          createdAt: new Date(session.created_at).getTime(),
        })),
      ),
    [sessions],
  );

  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [panelMode, setPanelMode] = React.useState<PanelMode>("chat");

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      // noop
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // noop
    }
  }, [collapsed]);

  const client = React.useMemo(() => {
    const mode = process.env.NEXT_PUBLIC_CHAT_CLIENT_MODE;
    if (mode === "mock") return new MockChatClient();
    return new HttpChatClient({ endpoint: "/api/chat/completions" });
  }, []);

  const onNewChat = React.useCallback(() => {
    void createSession({ defaultModel: activeModel || "deepseek-chat", title: t("newChat") });
    setPanelMode("chat");
    setMobileOpen(false);
  }, [createSession, activeModel, t]);

  const onSelectSession = React.useCallback((id: string) => {
    void switchSession(id);
    setPanelMode("chat");
    setMobileOpen(false);
  }, [switchSession]);

  const onRenameSession = React.useCallback((id: string) => {
    const current = history.find((item) => item.id === id);
    const next = window.prompt(t("renameSessionPrompt"), current?.title ?? "");
    if (!next) return;
    void renameSessionInStore(id, next);
  }, [history, renameSessionInStore, t]);

  const onDeleteSession = React.useCallback(
    (id: string) => {
      if (!window.confirm(t("deleteSessionConfirm"))) return;
      void deleteSessionInStore(id);
    },
    [deleteSessionInStore, t],
  );

  const onSignOut = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/auth");
  }, [router]);

  const grouped = React.useMemo(
    () =>
      groupHistory(history, {
        today: t("historyToday"),
        yesterday: t("historyYesterday"),
        week: t("historyWeek"),
        month: t("historyMonth"),
        older: t("historyOlder"),
      }),
    [history, t],
  );

  const sidebarToggleLabel = collapsed ? t("expandSidebar") : t("collapseSidebar");
  const languageLabel = locale === "zh" ? t("languageZh") : t("languageEn");

  return (
    <TooltipProvider delayDuration={200}>
      <main className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
        {/* 侧栏 */}
        <aside
          data-collapsed={collapsed ? "1" : undefined}
          data-mobile-open={mobileOpen ? "1" : undefined}
          className={[
            "group/sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200",
            "w-[272px] data-[collapsed=1]:w-[72px]",
            "-translate-x-full data-[mobile-open=1]:translate-x-0 lg:static lg:translate-x-0",
          ].join(" ")}
        >
          {/* 顶部品牌 + 收起侧栏（与主区分界侧对齐，见设计稿图2；窄栏时纵向排布） */}
          <div
            className={[
              "flex shrink-0 border-b border-sidebar-border",
              collapsed
                ? "flex-col items-center gap-1.5 px-1 py-2.5"
                : "h-14 flex-row items-center gap-1 px-2 sm:px-3",
            ].join(" ")}
          >
            <div className={`flex min-w-0 items-center gap-2 ${collapsed ? "justify-center" : "flex-1"}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <MachiAvatar size={22} className="h-[22px] w-[22px] rounded-sm" />
              </span>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">AgenticX</div>
                  <div className="truncate text-[11px] text-muted-foreground">{t("brandSubtitle")}</div>
                </div>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setCollapsed((prev) => !prev)}
                  aria-label={sidebarToggleLabel}
                  className={[
                    "hidden shrink-0 border-sidebar-border/80 bg-background/60 text-muted-foreground shadow-none hover:bg-muted/80 hover:text-foreground lg:inline-flex",
                    collapsed ? "h-7 w-7" : "h-8 w-8",
                  ].join(" ")}
                >
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[12rem]">
                {sidebarToggleLabel}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 主操作 */}
          <div className={["flex flex-col gap-1.5 p-3", collapsed ? "items-center" : ""].join(" ")}>
            <Button onClick={onNewChat} className={collapsed ? "" : "w-full justify-start"} size={collapsed ? "icon" : "default"}>
              <MessageSquarePlus />
              {!collapsed && t("newChat")}
            </Button>
            <Button
              variant={deepResearch ? "default" : "outline"}
              onClick={() => setDeepResearch((prev) => !prev)}
              className={collapsed ? "" : "w-full justify-start"}
              size={collapsed ? "icon" : "default"}
            >
              <Microscope />
              {!collapsed && t("deepResearch")}
            </Button>
          </div>

          <Separator className="bg-sidebar-border" />

          {/* 历史分组 */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {!collapsed ? (
              historyLoading ? (
                <div className="px-3 py-4 text-xs text-muted-foreground">{t("loadingHistory")}</div>
              ) : grouped.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-10 text-center text-xs text-muted-foreground">
                  <MessageSquare className="h-5 w-5" />
                  <span>{t("noHistory")}</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {grouped.map((group) => (
                    <div key={group.key}>
                      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                        {group.label}
                      </div>
                      <div className="space-y-0.5">
                        {group.items.map((item) => (
                          <SessionItem
                            key={item.id}
                            session={item}
                            active={activeSessionId === item.id}
                            onSelect={() => onSelectSession(item.id)}
                            onRename={() => onRenameSession(item.id)}
                            onDelete={() => onDeleteSession(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="flex flex-col items-center gap-2 py-2">
                {history.slice(0, 8).map((item) => (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelectSession(item.id)}
                        className={[
                          "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                          activeSessionId === item.id
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        ].join(" ")}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.title}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>

          <Separator className="bg-sidebar-border" />

          {/* 用户卡片 */}
          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={[
                    "flex w-full items-center gap-2.5 rounded-md py-2 transition-colors hover:bg-muted",
                    collapsed ? "justify-center px-0" : "px-2 text-left",
                  ].join(" ")}
                >
                  <div className="relative shrink-0">
                    <MachiAvatar size={32} className="h-8 w-8" />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Crown className="h-2 w-2" />
                    </span>
                  </div>
                  {!collapsed && (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{userEmail}</p>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="soft" className="h-4 text-[10px]">
                          {t("enterpriseBadge")}
                        </Badge>
                      </div>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-60">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{userEmail}</div>
                  <div className="text-xs font-normal text-muted-foreground">{t("enterpriseRole")}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPanelMode("settings")}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t("settings")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTheme}>
                  {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                  {resolvedTheme === "dark" ? t("switchToLight") : t("switchToDark")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  <Monitor className="mr-2 h-4 w-4" />
                  {t("followSystem")}
                  {theme === "system" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
                  <Languages className="mr-2 h-4 w-4" />
                  {t("languageMenu", { language: languageLabel })}
                </DropdownMenuItem>
                {showAdminEntry ? (
                  <DropdownMenuItem
                    onClick={() =>
                      window.open(
                        process.env.NEXT_PUBLIC_ADMIN_CONSOLE_URL ?? "http://localhost:3001",
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    {t("adminConsole")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}

        {/* 主区 */}
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="absolute left-4 top-4 z-30 lg:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={t("openMenu")}
            >
              <Menu />
            </Button>
          </div>
          {panelMode === "settings" && (
            <div className="absolute right-4 top-4 z-30">
              <Button variant="outline" size="sm" onClick={() => setPanelMode("chat")}>
                {t("backToChat")}
              </Button>
            </div>
          )}

          <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            {panelMode === "chat" ? (
              <MachiChatView client={client} />
            ) : (
              <div className="h-full w-full overflow-auto">
                <SettingsPanel />
              </div>
            )}
          </div>
        </section>

        <Toaster />
      </main>
    </TooltipProvider>
  );
}

function SessionItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: HistorySession;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("workspace");

  return (
    <div
      className={[
        "group/session flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-foreground/85 hover:bg-muted",
      ].join(" ")}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left">
        {session.title}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-background/50 hover:text-foreground group-hover/session:opacity-100 data-[state=open]:opacity-100"
            aria-label={t("sessionActions")}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
