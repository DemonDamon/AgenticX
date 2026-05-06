"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  GridBackdrop,
  Input,
  Label,
  MachiAvatar,
  Separator,
} from "@agenticx/ui";
import { getAdminSsoErrorMessageZh } from "@agenticx/auth/src/services/oidc-error-codes";
import { ArrowRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { getAdminSsoProviderOptions } from "../../lib/admin-sso-provider-options";

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("owner@agenticx.local");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ssoProviders = useMemo(() => getAdminSsoProviderOptions(), []);

  useEffect(() => {
    const raw = searchParams.get("sso_error");
    if (!raw) return;
    setStatus(getAdminSsoErrorMessageZh(raw));
  }, [searchParams]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.message ?? "登录失败，请检查邮箱和密码");
        return;
      }
      router.push("/dashboard");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* 顶部 Logo */}
      <div className="absolute left-6 top-6 z-50 flex items-center gap-3 md:left-10 md:top-8">
        <MachiAvatar size={40} className="h-10 w-10 shadow-sm" />
        <span className="text-xl font-bold tracking-tight text-foreground">AgenticX Enterprise</span>
      </div>

      {/* 装饰背景 */}
      <GridBackdrop className="machi-grid-bg opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/4 h-[520px] w-[520px] rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 bottom-0 h-[420px] w-[420px] rounded-full bg-chart-5/15 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        {/* 左：品牌故事 */}
        <div className="hidden flex-col justify-center gap-16 lg:flex">
          <div className="space-y-10">
            <div className="space-y-6">
              <h1 className="text-4xl font-bold leading-[1.15] tracking-tighter xl:text-5xl">
                企业级大模型<br /><span className="text-primary">应用一体化平台</span>
              </h1>
              <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
                前台 + 后台 + AI 网关三端联动 · 云端统一管控 · 端侧安全闭环 · 四维计量与合规审计全覆盖。
              </p>
            </div>

            <ul className="space-y-5 text-base">
              <li className="flex items-start gap-3.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="flex flex-col pt-0.5">
                  <span className="font-semibold text-foreground">合规优先</span>
                  <span className="text-sm leading-6 text-muted-foreground">审计链防篡改、策略拦截可视化、审计导出合规归档</span>
                </div>
              </li>
              <li className="flex items-start gap-3.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="flex flex-col pt-0.5">
                  <span className="font-semibold text-foreground">管控深度</span>
                  <span className="text-sm leading-6 text-muted-foreground">部门 × 员工 × 厂商 × 模型四维消耗穿透分析</span>
                </div>
              </li>
              <li className="flex items-start gap-3.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="flex flex-col pt-0.5">
                  <span className="font-semibold text-foreground">白标交付</span>
                  <span className="text-sm leading-6 text-muted-foreground">Machi 基底 + 客户 brand token 覆盖 · 5 分钟换肤</span>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* 右：登录卡 */}
        <div className="flex items-center justify-center">
          <Card className="w-full max-w-md backdrop-blur">
            <CardHeader className="space-y-1.5">
              <CardTitle className="text-2xl">管理员登录</CardTitle>
              <CardDescription>使用企业管理员账号进入控制台</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="space-y-3.5" onSubmit={signIn}>
                <div className="space-y-1.5">
                  <Label htmlFor="email">邮箱</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">密码</Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => alert("请联系你的超级管理员重置密码")}
                    >
                      忘记密码？
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {status ? (
                  <Alert variant="destructive">
                    <ShieldAlert className="h-5 w-5" />
                    <AlertDescription>{status}</AlertDescription>
                  </Alert>
                ) : null}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "登录中..." : "登录并进入控制台"}
                  <ArrowRight />
                </Button>
              </form>

              <Separator>
                <span className="bg-card px-2 text-xs text-muted-foreground">或使用</span>
              </Separator>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={ssoProviders.length === 0}
                  onClick={() => {
                    const provider = ssoProviders[0]?.id ?? "default";
                    window.location.href = `/api/auth/sso/oidc/start?provider=${encodeURIComponent(provider)}`;
                  }}
                >
                  企业 SSO 登录
                </Button>
                <Button variant="outline" type="button" disabled>
                  LDAP（敬请期待）
                </Button>
              </div>

              <p className="pt-2 text-center text-xs text-muted-foreground">
                本次登录将记录到审计日志 · 所有操作需要管理员授权
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 text-[11px] font-medium text-muted-foreground/40 md:bottom-6 md:gap-4">
        <span>企业合规</span>
        <Separator orientation="vertical" className="h-3 bg-border/40" />
        <span>ISO27001 · SOC2</span>
        <Separator orientation="vertical" className="h-3 bg-border/40" />
        <span>Apache 2.0</span>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
