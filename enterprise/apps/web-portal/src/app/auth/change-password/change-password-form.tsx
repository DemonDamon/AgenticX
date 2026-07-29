"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@agenticx/ui";
import { CheckCircle2, KeyRound, ShieldAlert } from "lucide-react";
import { useState } from "react";

type ChangePasswordFormProps = {
  email: string;
};

export function ChangePasswordForm({ email }: ChangePasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致，请重新确认。");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? "密码更新失败，请稍后重试。");
        return;
      }
      window.location.assign("/workspace");
    } catch {
      setError("网络连接异常，请检查后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-2xl">请先设置新密码</CardTitle>
            <CardDescription>
              你正在使用系统生成的初始密码。完成设置后才能进入工作台。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
              当前账号：{email}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少 8 个字符"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认新密码</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
            {error ? (
              <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}
            <Button className="w-full" type="submit" disabled={saving}>
              <CheckCircle2 />
              {saving ? "正在保存…" : "保存新密码并进入工作台"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
