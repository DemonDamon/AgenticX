"use client";

import {
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useLocale,
} from "@agenticx/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: signInEmail,
        password: signInPassword,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setStatus(data.message ?? "login failed");
      return;
    }
    setStatus(t.signInSuccess);
    router.push("/workspace");
  };

  const handleSignUp = async () => {
    if (signUpPassword !== confirmPassword) {
      setStatus(t.passwordMismatch);
      return;
    }
    setBusy(true);
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
    setBusy(false);
    if (!ok) {
      setStatus(data.message ?? "register failed");
      return;
    }
    setStatus(t.signUpSuccess);
    setSignInEmail(signUpEmail);
    setSignInPassword(signUpPassword);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--machi-bg)]">
      <GridBackdrop className="machi-grid-bg opacity-90" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl items-center px-6 py-10 lg:px-10">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hidden rounded-3xl border border-zinc-800 bg-[var(--machi-bg-elevated)] p-8 lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-sky-700/50 bg-sky-900/20 px-3 py-1 text-xs text-sky-300">
                Enterprise AI Gateway
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight">Machi Enterprise Workspace</h1>
              <p className="mt-3 max-w-xl text-zinc-400">{t.authSubtitle}</p>
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <MachiAvatar size={56} className="h-14 w-14" />
              <div>
                <p className="font-medium">AgenticX</p>
                <p className="text-sm text-zinc-400">Front-end + Admin + Gateway 联动演示</p>
              </div>
            </div>
          </section>

          <Card className="border-zinc-800 bg-[var(--machi-bg-elevated)]">
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MachiAvatar size={44} className="h-11 w-11" />
                  <div>
                    <CardTitle>{t.authTitle}</CardTitle>
                    <CardDescription>{t.authSubtitle}</CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
                  {locale === "zh" ? "EN" : "中"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs defaultValue="signin">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">{t.signIn}</TabsTrigger>
                  <TabsTrigger value="signup">{t.signUp}</TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">{t.email}</Label>
                    <Input id="signin-email" value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">{t.password}</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      value={signInPassword}
                      onChange={(event) => setSignInPassword(event.target.value)}
                    />
                  </div>
                  <Button className="w-full" onClick={handleSignIn} disabled={busy}>
                    {t.loginAction}
                  </Button>
                </TabsContent>

                <TabsContent value="signup" className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">{t.email}</Label>
                    <Input id="signup-email" value={signUpEmail} onChange={(event) => setSignUpEmail(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">{t.username}</Label>
                    <Input id="signup-name" value={signUpUsername} onChange={(event) => setSignUpUsername(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">{t.password}</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      value={signUpPassword}
                      onChange={(event) => setSignUpPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">{t.confirmPassword}</Label>
                    <Input
                      id="signup-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </div>
                  <Button className="w-full" onClick={handleSignUp} disabled={busy}>
                    {t.signupAction}
                  </Button>
                </TabsContent>
              </Tabs>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-300">
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => setStatus(t.wechatComingSoon)}>
                  WeChat Login
                </button>
              </div>

              {!!status && <p className="text-sm text-zinc-300">{status}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

