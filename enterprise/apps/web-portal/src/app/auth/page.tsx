"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { usePortalCopy } from "../../lib/portal-copy";

export default function AuthPage() {
  const router = useRouter();
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
    <main className="relative min-h-screen overflow-hidden bg-background">
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

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
        {/* 左：品牌故事区 */}
        <section className="hidden flex-col justify-between lg:flex">
          <div className="flex items-center gap-2">
            <MachiAvatar size={40} className="h-10 w-10" />
            <div>
              <div className="text-lg font-semibold">AgenticX Enterprise</div>
              <div className="text-xs text-muted-foreground">Workspace</div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <Badge variant="soft" className="mb-3 gap-1">
                <Sparkles className="h-3 w-3" />
                Enterprise AI Gateway
              </Badge>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">
                让大模型<span className="text-primary">安全可控</span>地走进企业
              </h1>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                {t.authSubtitle}
              </p>
            </div>

            {/* 特性列表 */}
            <ul className="grid gap-2.5 text-sm">
              {[
                { icon: ShieldCheck, text: "合规优先：审计链防篡改 · 策略拦截可视化" },
                { icon: Zap, text: "三端联动：前台 + 后台 + AI 网关 · 一条链路" },
                { icon: CheckCircle2, text: "可白标：5 分钟换肤 · 按客户独立部署" },
              ].map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.text} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="text-foreground/90">{feature.text}</span>
                  </li>
                );
              })}
            </ul>

            {/* 小客户 logo 条（占位） */}
            <div className="rounded-xl border border-border bg-surface-subtle/60 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                已服务企业
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-muted-foreground/80">
                <span>· 和创集团</span>
                <span>· 风控事业部</span>
                <span>· 制造业 Top 10</span>
                <span>· 金融科技公司</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Apache 2.0</span>
            <Separator orientation="vertical" className="h-3" />
            <span>ISO27001 · SOC2</span>
            <Separator orientation="vertical" className="h-3" />
            <span>Made with ❤ in Beijing</span>
          </div>
        </section>

        {/* 右：登录/注册卡 */}
        <section className="flex items-center justify-center">
          <Card className="w-full max-w-md backdrop-blur">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <MachiAvatar size={36} className="h-9 w-9 lg:hidden" />
                  <div>
                    <CardTitle>{t.authTitle}</CardTitle>
                    <CardDescription>{t.authSubtitle}</CardDescription>
                  </div>
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
                  disabled
                >
                  SSO
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
    </main>
  );
}
