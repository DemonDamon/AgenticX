"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useLocale,
} from "@agenticx/ui";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Github,
  Languages,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { getPortalSsoErrorMessageZh } from "@agenticx/auth/src/services/oidc-error-codes";
import { usePortalCopy } from "../../lib/portal-copy";
import { getPortalSsoProviderOptions } from "../../lib/sso-provider-options";

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = usePortalCopy();
  const { locale, setLocale } = useLocale();
  const [signInEmail, setSignInEmail] = useState("owner@agenticx.local");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpUsername, setSignUpUsername] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ssoProviders = useMemo(() => getPortalSsoProviderOptions(), []);

  useEffect(() => {
    const raw = searchParams.get("sso_error");
    if (!raw) return;
    setStatus({
      type: "error",
      message: getPortalSsoErrorMessageZh(raw),
    });
  }, [searchParams]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: signInEmail, password: signInPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus({ type: "error", message: data.message ?? "登录失败" });
        return;
      }
      setStatus({ type: "success", message: t.signInSuccess });
      router.push("/workspace");
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (signUpPassword !== confirmPassword) {
      setStatus({ type: "error", message: t.passwordMismatch });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: signUpEmail,
          displayName: signUpUsername,
          password: signUpPassword,
        }),
      });
      let ok = response.ok;
      let data = await response.json();
      if (!ok && response.status === 401) {
        const fallback = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: signUpEmail,
            displayName: signUpUsername,
            password: signUpPassword,
          }),
        });
        ok = fallback.ok;
        data = await fallback.json();
      }
      if (!ok) {
        setStatus({ type: "error", message: data.message ?? "注册失败" });
        return;
      }
      setStatus({ type: "success", message: t.signUpSuccess });
      setSignInEmail(signUpEmail);
      setSignInPassword(signUpPassword);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-background">
      {/* 顶部 Logo */}
      <div className="absolute left-6 top-6 z-50 flex items-center gap-3 md:left-10 md:top-8">
        <MachiAvatar size={40} className="h-10 w-10 shadow-sm" />
        <span className="text-xl font-bold tracking-tight text-foreground">AgenticX Enterprise</span>
      </div>

      {/* 装饰背景：grid + 双光晕 */}
      <GridBackdrop className="machi-grid-bg opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-48 top-0 h-[640px] w-[640px] rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 bottom-0 h-[520px] w-[520px] rounded-full bg-chart-5/12 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12 lg:px-8 lg:py-10 xl:grid-cols-[1.2fr_0.8fr] xl:gap-16 xl:px-10 xl:py-14">
        {/* 左：品牌故事区 */}
        <section className="hidden flex-col justify-center gap-16 lg:flex">
          <div className="space-y-10">
            <div className="space-y-6">
              <Badge variant="soft" className="mb-4 gap-1.5 px-3 py-1">
                <Sparkles className="h-3 w-3" />
                AI Workspace
              </Badge>
              <h1 className="max-w-3xl text-4xl font-bold leading-[1.15] tracking-tighter xl:text-5xl">
                你的专属<br /><span className="text-primary">AI 智能工作台</span>
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
                无缝连接顶级大模型与企业私有知识库，为每位员工提供极速、安全、全能的 AI 助手。
              </p>
            </div>

            {/* 特性列表 */}
            <ul className="grid max-w-2xl gap-5 text-base">
              {[
                { icon: Sparkles, title: "全能 AI 助手", desc: "极速响应日常问答、长文总结、数据分析与代码编写" },
                { icon: Zap, title: "开箱即用的工作流", desc: "内置丰富场景模板，一键调用企业内部专业智能体" },
                { icon: ShieldCheck, title: "企业级数据保护", desc: "所有对话不用于模型训练，企业数据绝对隔离" },
              ].map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title} className="flex items-start gap-3.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col pt-0.5">
                      <span className="font-semibold text-foreground">{feature.title}</span>
                      <span className="text-sm leading-6 text-muted-foreground">{feature.desc}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 右：登录/注册卡 */}
        <section className="flex items-center justify-center xl:justify-end">
          <Card className="w-full max-w-md backdrop-blur">
            <CardHeader className="pb-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <CardTitle className="text-2xl">{t.authTitle}</CardTitle>
                  <CardDescription>{t.authSubtitle}</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                  aria-label="切换语言"
                >
                  <Languages />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs defaultValue="signin">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">{t.signIn}</TabsTrigger>
                  <TabsTrigger value="signup">{t.signUp}</TabsTrigger>
                </TabsList>

                {/* 登录 */}
                <TabsContent value="signin" className="space-y-3 pt-3">
                  <form onSubmit={handleSignIn} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="signin-email">{t.email}</Label>
                      <Input
                        id="signin-email"
                        type="email"
                        autoComplete="username"
                        required
                        value={signInEmail}
                        onChange={(event) => setSignInEmail(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="signin-password">{t.password}</Label>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setStatus({ type: "info", message: "请联系企业管理员重置" })}
                        >
                          忘记密码？
                        </button>
                      </div>
                      <Input
                        id="signin-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={signInPassword}
                        onChange={(event) => setSignInPassword(event.target.value)}
                        placeholder="••••••••"
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? "登录中..." : t.loginAction}
                      <ArrowRight />
                    </Button>
                  </form>
                </TabsContent>

                {/* 注册 */}
                <TabsContent value="signup" className="space-y-3 pt-3">
                  <form onSubmit={handleSignUp} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-email">{t.email}</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        required
                        value={signUpEmail}
                        onChange={(event) => setSignUpEmail(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-name">{t.username}</Label>
                      <Input
                        id="signup-name"
                        required
                        value={signUpUsername}
                        onChange={(event) => setSignUpUsername(event.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="signup-password">{t.password}</Label>
                        <Input
                          id="signup-password"
                          type="password"
                          required
                          value={signUpPassword}
                          onChange={(event) => setSignUpPassword(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="signup-confirm">{t.confirmPassword}</Label>
                        <Input
                          id="signup-confirm"
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                        />
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? "处理中..." : t.signupAction}
                      <ChevronRight />
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>

              {status ? (
                <Alert
                  variant={
                    status.type === "error" ? "destructive" : status.type === "success" ? "success" : "info"
                  }
                >
                  {status.type === "error" ? (
                    <ShieldAlert className="h-5 w-5" />
                  ) : status.type === "success" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                  <AlertDescription>{status.message}</AlertDescription>
                </Alert>
              ) : null}

              <Separator />

              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus({ type: "info", message: t.wechatComingSoon })}
                >
                  微信
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ssoProviders.length === 0}
                  onClick={() => {
                    const provider = ssoProviders[0]?.id ?? "default";
                    window.location.href = `/api/auth/sso/oidc/start?provider=${encodeURIComponent(provider)}&returnTo=${encodeURIComponent("/workspace")}`;
                  }}
                >
                  企业 SSO
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                >
                  <Github />
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                登录即代表同意 <span className="underline-offset-2 hover:underline">服务协议</span> 与{" "}
                <span className="underline-offset-2 hover:underline">隐私政策</span>
              </p>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* 底部信息 */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 text-[11px] font-medium text-muted-foreground/40 md:bottom-6 md:gap-4">
        <span>Apache 2.0</span>
        <Separator orientation="vertical" className="h-3 bg-border/40" />
        <span>ISO27001 · SOC2</span>
        <Separator orientation="vertical" className="h-3 bg-border/40" />
        <span>Made with ❤ in Beijing</span>
      </div>
    </main>
  );
}
