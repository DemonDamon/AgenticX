"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
  Activity,
  ChevronLeft,
  ChevronRight,
  Crown,
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
import { usePortalCopy } from "../lib/portal-copy";

type WorkspaceShellProps = {
  userEmail: string;
};

type PanelMode = "chat" | "settings";
type HistorySession = {
  id: string;
  title: string;
  updatedAt: number;
};

const COLLAPSED_KEY = "agenticx-portal-sidebar-collapsed";

function groupHistory(history: HistorySession[]): Array<{ key: string; label: string; items: HistorySession[] }> {
  const now = Date.now();
  const buckets = {
    today: [] as HistorySession[],
    yesterday: [] as HistorySession[],
    week: [] as HistorySession[],
    month: [] as HistorySession[],
    older: [] as HistorySession[],
  };
  for (const item of history) {
    const diff = now - item.updatedAt;
    if (diff < 24 * 3600 * 1000) buckets.today.push(item);
    else if (diff < 2 * 24 * 3600 * 1000) buckets.yesterday.push(item);
    else if (diff < 7 * 24 * 3600 * 1000) buckets.week.push(item);
    else if (diff < 30 * 24 * 3600 * 1000) buckets.month.push(item);
    else buckets.older.push(item);
  }
  return [
    { key: "today", label: "今天", items: buckets.today },
    { key: "yesterday", label: "昨天", items: buckets.yesterday },
    { key: "week", label: "7 天内", items: buckets.week },
    { key: "month", label: "30 天内", items: buckets.month },
    { key: "older", label: "更早", items: buckets.older },
  ].filter((group) => group.items.length > 0);
}

export function WorkspaceShell({ userEmail }: WorkspaceShellProps) {
  const router = useRouter();
  const t = usePortalCopy();
  const { locale, setLocale } = useLocale();
  const { resolved: resolvedTheme, theme, setTheme, toggle: toggleTheme } = useUiTheme();
  const { bootstrap } = useChatStore();

  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [panelMode, setPanelMode] = React.useState<PanelMode>("chat");
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>("session_1");
  const [history, setHistory] = React.useState<HistorySession[]>([
    { id: "session_1", title: "欢迎使用 AgenticX", updatedAt: Date.now() - 60 * 1000 },
    { id: "session_2", title: "Policy review draft", updatedAt: Date.now() - 3 * 3600 * 1000 },
    { id: "session_3", title: "合规报告重点提取", updatedAt: Date.now() - 2 * 24 * 3600 * 1000 },
    { id: "session_4", title: "Q3 数据分析对齐", updatedAt: Date.now() - 5 * 24 * 3600 * 1000 },
  ]);

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
    bootstrap({ defaultModel: "deepseek-chat" });
    const next: HistorySession = {
      id: `session_${Date.now()}`,
      title: t.newChat,
      updatedAt: Date.now(),
    };
    setHistory((prev) => [next, ...prev].slice(0, 30));
    setActiveSessionId(next.id);
    setPanelMode("chat");
    setMobileOpen(false);
  }, [bootstrap, t.newChat]);

  const onSelectSession = React.useCallback((id: string) => {
    setActiveSessionId(id);
    setPanelMode("chat");
    setMobileOpen(false);
  }, []);

  const onRenameSession = React.useCallback((id: string) => {
    const current = history.find((item) => item.id === id);
    const next = window.prompt("重命名会话", current?.title ?? "");
    if (!next) return;
    setHistory((prev) => prev.map((item) => (item.id === id ? { ...item, title: next } : item)));
  }, [history]);

  const onDeleteSession = React.useCallback(
    (id: string) => {
      if (!window.confirm("删除这条会话？")) return;
      setHistory((prev) => prev.filter((item) => item.id !== id));
      if (activeSessionId === id) setActiveSessionId(null);
    },
    [activeSessionId]
  );

  const onSignOut = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/auth");
  }, [router]);

  const grouped = React.useMemo(() => groupHistory(history), [history]);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="flex min-h-screen bg-background text-foreground">
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
          {/* 顶部品牌 */}
          <div className="flex h-14 items-center gap-2 px-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MachiAvatar size={22} className="h-[22px] w-[22px] rounded-sm" />
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">AgenticX</div>
                <div className="truncate text-[11px] text-muted-foreground">Workspace</div>
              </div>
            )}
          </div>

          <Separator className="bg-sidebar-border" />

          {/* 主操作 */}
          <div className="space-y-1.5 p-3">
            <Button onClick={onNewChat} className="w-full justify-start" size={collapsed ? "icon" : "default"}>
              <MessageSquarePlus />
              {!collapsed && t.newChat}
            </Button>
            <Button
              variant={deepResearch ? "default" : "outline"}
              onClick={() => setDeepResearch((prev) => !prev)}
              className="w-full justify-start"
              size={collapsed ? "icon" : "default"}
            >
              <Microscope />
              {!collapsed && t.deepResearch}
            </Button>
          </div>

          <Separator className="bg-sidebar-border" />

          {/* 历史分组 */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {!collapsed ? (
              grouped.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-10 text-center text-xs text-muted-foreground">
                  <MessageSquare className="h-5 w-5" />
                  <span>{t.noHistory}</span>
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
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
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
                          Enterprise
                        </Badge>
                      </div>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-60">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{userEmail}</div>
                  <div className="text-xs font-normal text-muted-foreground">Enterprise · admin</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPanelMode("settings")}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t.settings}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTheme}>
                  {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                  {resolvedTheme === "dark" ? "切换到亮色" : "切换到暗色"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  <Monitor className="mr-2 h-4 w-4" />
                  跟随系统
                  {theme === "system" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
                  <Languages className="mr-2 h-4 w-4" />
                  语言：{locale === "zh" ? "中文" : "English"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 折叠按钮 */}
          <Separator className="bg-sidebar-border" />
          <div className="flex items-center gap-2 px-2 py-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              className="hidden lg:inline-flex"
            >
              {collapsed ? <ChevronRight /> : <ChevronLeft />}
            </Button>
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
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                onClick={() => setMobileOpen((prev) => !prev)}
                aria-label="打开菜单"
              >
                <Menu />
              </Button>
              <Badge variant={deepResearch ? "default" : "soft"} className="gap-1">
                <Microscope className="h-3 w-3" />
                {deepResearch ? "Deep Research" : "Standard"}
              </Badge>
              <Badge variant="success" className="gap-1">
                <Activity className="h-3 w-3" />
                <span className="hidden sm:inline">Gateway online</span>
                <span className="sm:hidden">on</span>
              </Badge>
            </div>
            {panelMode === "settings" ? (
              <Button variant="outline" size="sm" onClick={() => setPanelMode("chat")}>
                {t.backToChat}
              </Button>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1 p-3 sm:p-4">
            <div className="min-h-0 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              {panelMode === "chat" ? <MachiChatView client={client} /> : <SettingsPanel />}
            </div>
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
            aria-label="会话操作"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
