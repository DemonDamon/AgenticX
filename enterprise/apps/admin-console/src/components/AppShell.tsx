"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  CommandShortcut,
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
  type UiLocale,
  useLocale,
  useUiTheme,
} from "@agenticx/ui";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Gauge,
  KeyRound,
  Languages,
  LogOut,
  LucideIcon,
  Menu,
  Monitor,
  Moon,
  Package,
  Search,
  Shield,
  Sliders,
  Sun,
  UserCog,
  Users,
  Wand2,
} from "lucide-react";

type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "概览",
    items: [{ href: "/dashboard", label: "Dashboard", icon: Gauge, shortcut: "G D" }],
  },
  {
    id: "iam",
    label: "身份与权限",
    items: [
      { href: "/iam/users", label: "用户", icon: Users, shortcut: "G U" },
      { href: "/iam/departments", label: "部门", icon: Building2, shortcut: "G P" },
      { href: "/iam/roles", label: "角色", icon: UserCog, shortcut: "G R" },
      { href: "/iam/bulk-import", label: "批量导入", icon: Wand2 },
    ],
  },
  {
    id: "ops",
    label: "运维监控",
    items: [
      { href: "/audit", label: "审计日志", icon: FileWarning, shortcut: "G A" },
      { href: "/metering", label: "四维消耗", icon: BarChart3, shortcut: "G M" },
    ],
  },
  {
    id: "platform",
    label: "平台配置",
    items: [
      { href: "/iam/roles", label: "策略规则", icon: Shield },
      { href: "/admin/models", label: "模型服务", icon: Package, shortcut: "G K" },
    ],
  },
];

const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

const NAV_GROUP_LABELS: Record<string, { zh: string; en: string }> = {
  overview: { zh: "概览", en: "Overview" },
  iam: { zh: "身份与权限", en: "IAM" },
  ops: { zh: "运维监控", en: "Operations" },
  platform: { zh: "平台配置", en: "Platform" },
};

const NAV_ITEM_LABELS: Record<string, { zh: string; en: string }> = {
  "overview:Dashboard": { zh: "仪表盘", en: "Dashboard" },
  "iam:用户": { zh: "用户", en: "Users" },
  "iam:部门": { zh: "部门", en: "Departments" },
  "iam:角色": { zh: "角色", en: "Roles" },
  "iam:批量导入": { zh: "批量导入", en: "Bulk Import" },
  "ops:审计日志": { zh: "审计日志", en: "Audit Logs" },
  "ops:四维消耗": { zh: "四维消耗", en: "Metering" },
  "platform:策略规则": { zh: "策略规则", en: "Policy Rules" },
  "platform:模型服务": { zh: "模型服务", en: "Model Services" },
};

const SHELL_COPY = {
  zh: {
    adminLabel: "管理后台",
    commandSearch: "搜索页面 / 导航...",
    commandInputPlaceholder: "输入页面名称、部门或用户...",
    commandTitle: "命令面板",
    commandDescription: "搜索页面并执行快捷操作",
    commandEmpty: "未找到匹配项",
    quickActions: "快捷操作",
    openMenu: "打开菜单",
    theme: "主题",
    light: "亮色",
    dark: "暗色",
    system: "跟随系统",
    language: "语言",
    chinese: "中文",
    english: "English",
    switchTheme: "切换主题",
    switchTo: "切换到",
    signOut: "退出登录",
    userMgmt: "人员管理",
    rolePerm: "角色与权限",
    notifyComingSoon: "通知中心（即将上线）",
    gatewayTip: "Gateway /healthz · 每 5 秒轮询",
  },
  en: {
    adminLabel: "Admin Console",
    commandSearch: "Search pages / navigation...",
    commandInputPlaceholder: "Type page, department, or user...",
    commandTitle: "Command palette",
    commandDescription: "Search pages and run quick actions",
    commandEmpty: "No matching result",
    quickActions: "Quick actions",
    openMenu: "Open menu",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    language: "Language",
    chinese: "Chinese",
    english: "English",
    switchTheme: "Toggle theme",
    switchTo: "Switch to",
    signOut: "Sign out",
    userMgmt: "User management",
    rolePerm: "Roles & permissions",
    notifyComingSoon: "Notification center (coming soon)",
    gatewayTip: "Gateway /healthz · polling every 5s",
  },
} as const;

function localizeGroupLabel(groupId: string, locale: UiLocale): string {
  return NAV_GROUP_LABELS[groupId]?.[locale] ?? groupId;
}

function localizeItemLabel(groupId: string, itemLabel: string, locale: UiLocale): string {
  return NAV_ITEM_LABELS[`${groupId}:${itemLabel}`]?.[locale] ?? itemLabel;
}

type HealthStatus = "healthy" | "degraded" | "offline";

function healthVariant(status: HealthStatus): "success" | "warning" | "destructive" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  return "destructive";
}

function healthLabel(status: HealthStatus, locale: UiLocale): string {
  if (locale === "en") {
    if (status === "healthy") return "Gateway healthy";
    if (status === "degraded") return "Gateway degraded";
    return "Gateway offline";
  }
  if (status === "healthy") return "网关正常";
  if (status === "degraded") return "网关降级";
  return "网关离线";
}

const COLLAPSED_KEY = "agenticx-admin-sidebar-collapsed";

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolved: resolvedTheme, theme, setTheme, toggle: toggleTheme } = useUiTheme();
  const { locale, setLocale } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<HealthStatus>("offline");
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const copy = SHELL_COPY[locale];

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
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

  // Cmd+K / Ctrl+K 打开命令面板
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((prev) => !prev);
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

  const activeItem = useMemo(
    () => FLAT_NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
    [pathname]
  );

  const breadcrumbs = useMemo(() => {
    const group = NAV_GROUPS.find((g) => g.items.some((item) => item === activeItem));
    if (!group || !activeItem) return [] as string[];
    return [localizeGroupLabel(group.id, locale), localizeItemLabel(group.id, activeItem.label, locale)];
  }, [activeItem, locale]);

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
            "-translate-x-full data-[mobile-open=1]:translate-x-0 lg:static lg:translate-x-0",
          ].join(" ")}
        >
          {/* brand */}
          <div className="flex h-14 items-center gap-2 px-3">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <MachiAvatar size={22} className="h-[22px] w-[22px] rounded-sm" />
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">AgenticX</div>
                <div className="truncate text-[11px] text-muted-foreground">{copy.adminLabel}</div>
              </div>
            )}
          </div>

          <Separator className="bg-sidebar-border" />

          {/* nav */}
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="space-y-1">
                {!collapsed && (
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {localizeGroupLabel(group.id, locale)}
                  </div>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeItem?.href === item.href;
                  const itemLabel = localizeItemLabel(group.id, item.label, locale);
                  const link = (
                    <Link
                      key={`${group.id}-${item.href}-${item.label}`}
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
                      {!collapsed && item.shortcut && (
                        <span className="ml-auto text-[10px] tracking-widest text-muted-foreground/70">{item.shortcut}</span>
                      )}
                    </Link>
                  );
                  if (!collapsed) return link;
                  return (
                    <Tooltip key={`${group.id}-${item.href}-${item.label}`}>
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

          {/* collapse toggle */}
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
            {!collapsed && (
              <span className="hidden text-xs text-muted-foreground lg:inline">{collapsed ? "" : `v0.1 · ${process.env.NODE_ENV ?? "dev"}`}</span>
            )}
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
              aria-label={copy.openMenu}
            >
              <Menu />
            </Button>

            {/* breadcrumbs */}
            <nav aria-label="面包屑" className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground sm:flex">
              <span className="shrink-0">{copy.adminLabel}</span>
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
              <span className="flex-1 text-left">{copy.commandSearch}</span>
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium">⌘K</kbd>
            </button>

            {/* health + notifications + theme + locale + user */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant={healthVariant(health)} className="gap-1 px-2 py-1">
                    <Activity className="h-3 w-3" />
                    <span className="hidden sm:inline">{healthLabel(health, locale)}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{copy.gatewayTip}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="通知">
                    <Bell />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.notifyComingSoon}</TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={copy.theme}>
                    {resolvedTheme === "dark" ? <Moon /> : <Sun />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40 border-border bg-popover text-popover-foreground shadow-xl [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
                >
                  <DropdownMenuLabel>{copy.theme}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="mr-2 h-4 w-4" />
                    {copy.light}
                    {theme === "light" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="mr-2 h-4 w-4" />
                    {copy.dark}
                    {theme === "dark" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="mr-2 h-4 w-4" />
                    {copy.system}
                    {theme === "system" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={copy.language}>
                    <Languages />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40 border-border bg-popover text-popover-foreground shadow-xl [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
                >
                  <DropdownMenuLabel>{copy.language}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLocale("zh")}>
                    {copy.chinese}
                    {locale === "zh" ? <span className="ml-auto text-xs text-primary">✓</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocale("en")}>
                    {copy.english}
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
                    <div className="text-sm font-medium">{copy.adminLabel}</div>
                    <div className="text-xs font-normal text-muted-foreground">owner@agenticx.local</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/iam/users")}>
                    <Users className="mr-2 h-4 w-4" />
                    {copy.userMgmt}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/iam/roles")}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {copy.rolePerm}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleTheme}>
                    <Sliders className="mr-2 h-4 w-4" />
                    {copy.switchTheme}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    {copy.signOut}
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
          onOpenChange={setCommandOpen}
          title={copy.commandTitle}
          description={copy.commandDescription}
        >
          <CommandInput placeholder={copy.commandInputPlaceholder} />
          <CommandList>
            <CommandEmpty>{copy.commandEmpty}</CommandEmpty>
            {NAV_GROUPS.map((group) => (
              <CommandGroup key={group.id} heading={localizeGroupLabel(group.id, locale)}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const itemLabel = localizeItemLabel(group.id, item.label, locale);
                  return (
                    <CommandItem
                      key={`${group.id}-${item.href}-${item.label}`}
                      onSelect={() => {
                        setCommandOpen(false);
                        router.push(item.href);
                      }}
                      value={`${localizeGroupLabel(group.id, locale)} ${itemLabel} ${item.href}`}
                    >
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      {itemLabel}
                      {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup heading={copy.quickActions}>
              <CommandItem
                onSelect={() => {
                  setCommandOpen(false);
                  toggleTheme();
                }}
              >
                {resolvedTheme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                {copy.switchTo} {resolvedTheme === "dark" ? copy.light : copy.dark} {copy.theme}
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setCommandOpen(false);
                  void handleSignOut();
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {copy.signOut}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}
