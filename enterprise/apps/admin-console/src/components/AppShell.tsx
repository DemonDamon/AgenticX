"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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
import { useTranslations } from "next-intl";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  FileWarning,
  Gauge,
  History,
  KeyRound,
  Languages,
  LogOut,
  LucideIcon,
  Menu,
  Monitor,
  Moon,
  Package,
  Puzzle,
  Search,
  Shield,
  Sliders,
  Sun,
  UserCog,
  Users,
  Wand2,
  Database,
  Plug,
} from "lucide-react";

type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "overview",
    items: [{ href: "/dashboard", labelKey: "dashboard", icon: Gauge }],
  },
  {
    id: "iam",
    label: "iam",
    items: [
      { href: "/iam/users", labelKey: "users", icon: Users },
      { href: "/iam/departments", labelKey: "departments", icon: Building2 },
      { href: "/iam/roles", labelKey: "roles", icon: UserCog },
      { href: "/iam/bulk-import", labelKey: "bulkImport", icon: Wand2 },
    ],
  },
  {
    id: "ops",
    label: "ops",
    items: [
      { href: "/audit", labelKey: "audit", icon: FileWarning },
      { href: "/metering", labelKey: "metering", icon: BarChart3 },
      { href: "/metering/quota", labelKey: "quota", icon: Sliders },
    ],
  },
  {
    id: "platform",
    label: "platform",
    items: [
      { href: "/policy", labelKey: "policy", icon: Shield },
      { href: "/admin/models", labelKey: "models", icon: Package },
      { href: "/admin/channels", labelKey: "channels", icon: Activity },
      { href: "/admin/cache", labelKey: "cache", icon: Database },
      { href: "/admin/api-tokens", labelKey: "apiTokens", icon: KeyRound },
      { href: "/admin/mcp-servers", labelKey: "mcpServers", icon: Plug },
      { href: "/admin/plugins", labelKey: "plugins", icon: Puzzle },
    ],
  },
  {
    id: "observability",
    label: "observability",
    items: [
      { href: "/admin/errors", labelKey: "errors", icon: FileWarning },
      { href: "/admin/perf", labelKey: "perf", icon: Activity },
    ],
  },
];

const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

type HealthStatus = "healthy" | "degraded" | "offline";

function healthVariant(status: HealthStatus): "success" | "warning" | "destructive" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  return "destructive";
}

const COLLAPSED_KEY = "agenticx-admin-sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "agenticx-admin-sidebar-width";
const COMMAND_SEARCH_HISTORY_KEY = "agenticx-admin-command-search-history";
const SIDEBAR_DEFAULT_WIDTH = 244;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const COMMAND_SEARCH_HISTORY_MAX = 12;

function readCommandSearchHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(COMMAND_SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .slice(0, COMMAND_SEARCH_HISTORY_MAX);
  } catch {
    return [];
  }
}

function writeCommandSearchHistory(items: string[]) {
  try {
    window.localStorage.setItem(
      COMMAND_SEARCH_HISTORY_KEY,
      JSON.stringify(items.slice(0, COMMAND_SEARCH_HISTORY_MAX))
    );
  } catch {
    // noop
  }
}

function pushCommandSearchHistory(prev: string[], term: string): string[] {
  const normalized = term.trim();
  if (!normalized) return prev;
  return [normalized, ...prev.filter((item) => item !== normalized)].slice(0, COMMAND_SEARCH_HISTORY_MAX);
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolved: resolvedTheme, theme, setTheme, toggle: toggleTheme } = useUiTheme();
  const { locale, setLocale } = useLocale();
  const t = useTranslations("shell");
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [health, setHealth] = useState<HealthStatus>("offline");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const commandHasQuery = commandQuery.trim().length > 0;
  const runtimeEnv = process.env.NODE_ENV ?? "development";

  const recordCommandSearch = useCallback((term: string) => {
    setSearchHistory((prev) => {
      const next = pushCommandSearchHistory(prev, term);
      writeCommandSearchHistory(next);
      return next;
    });
  }, []);

  const handleCommandOpenChange = useCallback((open: boolean) => {
    setCommandOpen(open);
    if (!open) setCommandQuery("");
  }, []);

  useEffect(() => {
    setSearchHistory(readCommandSearchHistory());
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
      const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setSidebarWidth(clampSidebarWidth(storedWidth));
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // noop
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // noop
    }
  }, [sidebarWidth]);

  const handleSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed || event.button !== 0) return;
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
      };
      const handlePointerUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [collapsed, sidebarWidth]
  );

  // Cmd+K / Ctrl+K 打开命令面板
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((prev) => {
          const next = !prev;
          if (!next) setCommandQuery("");
          return next;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSignOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const response = await fetch("/api/gateway/health");
        if (!response.ok) {
          if (active) setHealth("degraded");
          return;
        }
        const payload = (await response.json()) as { data?: { status?: string } };
        if (!active) return;
        const status = payload.data?.status;
        setHealth(status === "healthy" ? "healthy" : "degraded");
      } catch {
        if (active) setHealth("offline");
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const activeItem = useMemo(() => {
    const matches = FLAT_NAV.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (matches.length === 0) return undefined;
    return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best));
  }, [pathname]);

  const breadcrumbs = useMemo(() => {
    const group = NAV_GROUPS.find((g) => g.items.some((item) => item === activeItem));
    if (!group || !activeItem) return [] as string[];
    return [t(`nav.groups.${group.id}`), t(`nav.items.${activeItem.labelKey}`)];
  }, [activeItem, t]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background text-foreground">
        {/* ===================== Sidebar ===================== */}
        <aside
          data-collapsed={collapsed ? "1" : undefined}
          data-mobile-open={mobileOpen ? "1" : undefined}
          className={[
            "group/sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200",
            "w-[244px] data-[collapsed=1]:w-[68px]",
            "-translate-x-full data-[mobile-open=1]:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          ].join(" ")}
          style={collapsed ? undefined : { width: sidebarWidth }}
        >
          {/* brand */}
          <div className="flex h-14 items-center justify-center gap-2 px-3">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <MachiAvatar size={22} className="h-[22px] w-[22px] rounded-sm" />
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">AgenticX</div>
                <div className="truncate text-[11px] text-muted-foreground">{t("adminLabel")}</div>
              </div>
            )}
          </div>

          {/* nav */}
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="space-y-1">
                {!collapsed && (
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {t(`nav.groups.${group.id}`)}
                  </div>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeItem?.href === item.href;
                  const itemLabel = t(`nav.items.${item.labelKey}`);
                  const link = (
                    <Link
                      key={`${group.id}-${item.href}-${item.labelKey}`}
                      href={item.href}
                      className={[
                        "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground",
                      ].join(" ")}
                      onClick={() => setMobileOpen(false)}
                    >
                      {/* 左侧高亮条（活跃状态） */}
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" aria-hidden />
                      )}
                      <Icon className={["h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground"].join(" ")} />
                      {!collapsed && <span className="truncate">{itemLabel}</span>}
                    </Link>
                  );
                  if (!collapsed) return link;
                  return (
                    <Tooltip key={`${group.id}-${item.href}-${item.labelKey}`}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right" sideOffset={12}>
                        {itemLabel}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </nav>

          <Separator className="bg-sidebar-border" />

          <div className="flex items-center gap-2 px-2 py-2">
            {!collapsed && (
              <span className="hidden text-xs text-muted-foreground lg:inline">{collapsed ? "" : `v0.1 · ${process.env.NODE_ENV ?? "dev"}`}</span>
            )}
          </div>

          <div
            role="separator"
            aria-label={t("resizeSidebarAria")}
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            className={[
              "group/resize absolute right-0 top-0 hidden h-full w-3 translate-x-1/2 cursor-col-resize touch-none lg:block",
              collapsed ? "pointer-events-none opacity-0" : "opacity-100",
            ].join(" ")}
            onPointerDown={handleSidebarResizeStart}
          >
            <span
              className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-all duration-150 group-hover/resize:w-1 group-hover/resize:bg-primary group-active/resize:w-1 group-active/resize:bg-primary"
              aria-hidden
            />
          </div>
        </aside>

        {/* backdrop for mobile */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}

        {/* ===================== Main ===================== */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={t("openMenu")}
            >
              <Menu />
            </Button>

            {/* breadcrumbs */}
            <nav aria-label={t("breadcrumbAria")} className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground sm:flex">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
                className="hidden shrink-0 text-muted-foreground hover:text-primary lg:inline-flex"
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
              <span className="shrink-0">{t("adminLabel")}</span>
              {breadcrumbs.map((segment, index) => (
                <span key={`${segment}-${index}`} className="flex shrink-0 items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className={index === breadcrumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}>
                    {segment}
                  </span>
                </span>
              ))}
            </nav>

            {/* command launcher */}
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="ml-auto flex h-8 w-full max-w-[320px] items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{t("commandSearch")}</span>
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium">⌘K</kbd>
            </button>

            {/* health + notifications + theme + locale + user */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant={healthVariant(health)} className="gap-1 px-2 py-1">
                    <Activity className="h-3 w-3" />
                    <span className="hidden sm:inline">{t(`health.${health}`)}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{t("gatewayTip")}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("notificationsAria")}>
                    <Bell />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("notifyComingSoon")}</TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("theme")}>
                    {resolvedTheme === "dark" ? <Moon /> : <Sun />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40 border-border bg-popover text-popover-foreground shadow-xl [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
                >
                  <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="mr-2 h-4 w-4" />
                    {t("light")}
                    {theme === "light" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="mr-2 h-4 w-4" />
                    {t("dark")}
                    {theme === "dark" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="mr-2 h-4 w-4" />
                    {t("system")}
                    {theme === "system" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("language")}>
                    <Languages />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40 border-border bg-popover text-popover-foreground shadow-xl [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
                >
                  <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLocale("zh")}>
                    {t("chinese")}
                    {locale === "zh" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocale("en")}>
                    {t("english")}
                    {locale === "en" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Separator orientation="vertical" className="mx-1 h-6" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
                  >
                    <MachiAvatar size={24} className="h-6 w-6" />
                    <span className="hidden text-sm font-medium sm:inline">admin</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 border-border bg-popover text-popover-foreground shadow-xl [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
                >
                  <DropdownMenuLabel>
                    <div className="text-sm font-medium">{t("adminLabel")}</div>
                    <div className="text-xs font-normal text-muted-foreground">admin@agenticx.local</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/iam/users")}>
                    <Users className="mr-2 h-4 w-4" />
                    {t("userMgmt")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/iam/roles")}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {t("rolePerm")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleTheme}>
                    <Sliders className="mr-2 h-4 w-4" />
                    {t("switchTheme")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">{children}</div>
          </main>
        </section>

        {/* ===================== Command Palette ===================== */}
        <CommandDialog
          open={commandOpen}
          onOpenChange={handleCommandOpenChange}
          title={t("commandTitle")}
          description={t("commandDescription")}
        >
          <CommandInput
            placeholder={t("commandInputPlaceholder")}
            value={commandQuery}
            onValueChange={setCommandQuery}
          />
          <CommandList>
            {!commandHasQuery ? (
              searchHistory.length > 0 ? (
                <CommandGroup heading={t("recentSearches")}>
                  {searchHistory.map((term) => (
                    <CommandItem
                      key={term}
                      value={term}
                      onSelect={() => {
                        recordCommandSearch(term);
                        setCommandQuery(term);
                      }}
                    >
                      <History className="mr-2 h-4 w-4 text-muted-foreground" />
                      {term}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t("noSearchHistory")}</div>
              )
            ) : (
              <>
                <CommandEmpty>{t("commandEmpty")}</CommandEmpty>
                {NAV_GROUPS.map((group) => (
                  <CommandGroup key={group.id} heading={t(`nav.groups.${group.id}`)}>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const itemLabel = t(`nav.items.${item.labelKey}`);
                      return (
                        <CommandItem
                          key={`${group.id}-${item.href}-${item.labelKey}`}
                          onSelect={() => {
                            recordCommandSearch(commandQuery);
                            handleCommandOpenChange(false);
                            router.push(item.href);
                          }}
                          value={`${t(`nav.groups.${group.id}`)} ${itemLabel} ${item.href}`}
                        >
                          <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                          {itemLabel}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
                <CommandSeparator />
                <CommandGroup heading={t("quickActions")}>
                  <CommandItem
                    onSelect={() => {
                      handleCommandOpenChange(false);
                      toggleTheme();
                    }}
                  >
                    {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                    {t("switchTo")} {resolvedTheme === "dark" ? t("light") : t("dark")} {t("theme")}
                  </CommandItem>
                  <CommandItem
                    onSelect={() => {
                      handleCommandOpenChange(false);
                      void handleSignOut();
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("signOut")}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </CommandDialog>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}
