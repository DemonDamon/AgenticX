"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MachiAvatar,
  useLocale,
  useUiTheme,
} from "@agenticx/ui";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Gauge,
  Layers,
  LogOut,
  Moon,
  Shield,
  Sun,
  Users,
} from "lucide-react";

type AppShellProps = {
  children: ReactNode;
};

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/iam/users", label: "IAM", icon: Users },
  { href: "/audit", label: "审计日志", icon: FileWarning },
  { href: "/metering", label: "四维消耗", icon: BarChart3 },
  { href: "/iam/roles", label: "策略规则", icon: Shield },
  { href: "/iam/departments", label: "模型服务", icon: Layers },
] as const;

type HealthStatus = "healthy" | "degraded" | "offline";

function healthVariant(status: HealthStatus): "success" | "warning" | "destructive" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  return "destructive";
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useUiTheme();
  const { locale, setLocale } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<HealthStatus>("offline");

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

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

  const activeNav = useMemo(
    () => NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href,
    [pathname]
  );

  return (
    <div className="flex min-h-screen bg-[var(--machi-bg)] text-zinc-100">
      <aside className={`border-r border-zinc-800 bg-[var(--machi-bg-elevated)] transition-all ${collapsed ? "w-[72px]" : "w-[248px]"}`}>
        <div className="flex items-center justify-between px-4 py-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <MachiAvatar size={28} className="h-7 w-7" />
              <span className="text-sm font-semibold">Admin Console</span>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        <nav className="space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-2">
            <Badge variant={healthVariant(health)} className="gap-1">
              <Activity className="h-3.5 w-3.5" />
              Gateway: {health}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800">
                <MachiAvatar size={24} className="h-6 w-6" />
                <span className="text-sm">admin</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                Theme: {theme}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
                Language: {locale === "zh" ? "中文" : "English"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </section>
    </div>
  );
}

