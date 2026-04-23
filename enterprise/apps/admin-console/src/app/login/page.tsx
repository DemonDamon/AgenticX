"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, GridBackdrop, Input, Label, MachiAvatar } from "@agenticx/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@agenticx.local");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const signIn = async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message ?? "登录失败");
      return;
    }
    router.push("/dashboard");
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--machi-bg)]">
      <GridBackdrop className="machi-grid-bg opacity-90" />
      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
        <Card className="w-full max-w-md border-zinc-800 bg-[var(--machi-bg-elevated)]">
          <CardHeader>
            <div className="mb-2 flex items-center gap-3">
              <MachiAvatar size={40} className="h-10 w-10" />
              <div>
                <CardTitle>管理员登录</CardTitle>
                <CardDescription>登录后进入 Enterprise Dashboard</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <Button className="w-full" onClick={signIn}>
              登录并进入控制台
            </Button>
            {!!status && <p className="text-sm text-zinc-400">{status}</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

