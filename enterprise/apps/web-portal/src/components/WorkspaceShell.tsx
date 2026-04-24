"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HttpChatClient, MockChatClient } from "@agenticx/sdk-ts";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MachiAvatar, useLocale, useUiTheme } from "@agenticx/ui";
import { ChevronLeft, ChevronRight, LogOut, MessageSquarePlus, Microscope, Moon, Settings, Sun } from "lucide-react";
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
};

export function WorkspaceShell({ userEmail }: WorkspaceShellProps) {
  const router = useRouter();
  const t = usePortalCopy();
  const { locale, setLocale } = useLocale();
  const { resolved: resolvedTheme, toggle: toggleTheme } = useUiTheme();
  const { bootstrap } = useChatStore();

  const [collapsed, setCollapsed] = React.useState(false);
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [panelMode, setPanelMode] = React.useState<PanelMode>("chat");
  const [history, setHistory] = React.useState<HistorySession[]>([
    { id: "session_1", title: "Welcome session" },
    { id: "session_2", title: "Policy review draft" },
  ]);

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
    };
    setHistory((prev) => [next, ...prev].slice(0, 20));
    setPanelMode("chat");
  }, [bootstrap, t.newChat]);

  const onSignOut = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/auth");
  }, [router]);

  return (
    <main className="flex min-h-screen bg-[var(--machi-bg)] text-zinc-100">
      <aside
        className={`relative flex shrink-0 flex-col border-r border-zinc-800 bg-[var(--machi-bg-elevated)] transition-all ${collapsed ? "w-[72px]" : "w-[280px]"}`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <MachiAvatar size={28} className="h-7 w-7" />
              <span className="text-sm font-semibold">AgenticX</span>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <div className="space-y-2 px-3">
          <Button className="w-full justify-start" onClick={onNewChat}>
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            {!collapsed && t.newChat}
          </Button>
          <Button
            variant={deepResearch ? "default" : "secondary"}
            className="w-full justify-start"
            onClick={() => setDeepResearch((prev) => !prev)}
          >
            <Microscope className="mr-2 h-4 w-4" />
            {!collapsed && t.deepResearch}
          </Button>
        </div>

        <div className="mt-5 flex-1 overflow-auto px-2">
          {!collapsed && (
            <>
              <p className="px-2 pb-2 text-xs uppercase tracking-wide text-zinc-500">{t.history}</p>
              <div className="space-y-1">
                {history.length === 0 && <p className="px-2 text-xs text-zinc-500">{t.noHistory}</p>}
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPanelMode("chat")}
                    className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-zinc-800 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-zinc-800">
                <MachiAvatar size={28} className="h-7 w-7" />
                {!collapsed && (
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{userEmail}</p>
                    <p className="text-xs text-zinc-500">Enterprise</p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuItem onClick={() => setPanelMode("settings")}>
                <Settings className="mr-2 h-4 w-4" />
                {t.settings}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleTheme}>
                {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                Theme: {resolvedTheme}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
                Language: {locale === "zh" ? "中文" : "English"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {t.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{deepResearch ? "Deep Research" : "Standard"}</Badge>
            <Badge variant="success">Gateway online</Badge>
          </div>
          {panelMode === "settings" && (
            <Button variant="ghost" onClick={() => setPanelMode("chat")}>
              {t.backToChat}
            </Button>
          )}
        </header>
        <div className="flex min-h-0 flex-1 p-4">
          <div className="min-h-0 w-full rounded-2xl border border-zinc-800 bg-[var(--machi-bg-elevated)]">
            {panelMode === "chat" ? <MachiChatView client={client} /> : <SettingsPanel />}
          </div>
        </div>
      </section>
    </main>
  );
}

