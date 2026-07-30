"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agenticx/ui";
import { CheckCircle2, Loader2, MonitorSmartphone, ShieldCheck } from "lucide-react";
import {
  ENTERPRISE_PRODUCT_NAME,
  EnterpriseBrandMark,
} from "../../../components/EnterpriseBrandMark";

type SessionUser = {
  email?: string;
  displayName?: string;
};

function DesktopAuthInner() {
  const searchParams = useSearchParams();
  const deviceId = (searchParams.get("device") ?? "").trim();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnTo = useMemo(() => {
    if (!deviceId) return "/auth/desktop";
    return `/auth/desktop?device=${encodeURIComponent(deviceId)}`;
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!deviceId) {
        setError(`缺少设备授权参数，请从 ${ENTERPRISE_PRODUCT_NAME} Desktop 重新发起登录。`);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) {
            window.location.assign(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
          }
          return;
        }
        const payload = (await res.json()) as {
          data?: { email?: string; displayName?: string };
          email?: string;
          displayName?: string;
        };
        if (!cancelled) {
          setSession({
            email: payload.data?.email ?? payload.email,
            displayName: payload.data?.displayName ?? payload.displayName,
          });
        }
      } catch {
        if (!cancelled) {
          setError("无法确认登录状态，请刷新后重试。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, returnTo]);

  const onApprove = async () => {
    if (!deviceId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/desktop/auth/device/approve", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify({ deviceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message || "授权失败，请重试");
        return;
      }
      setDone(true);
    } catch {
      setError("授权请求失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute left-6 top-6 flex items-center gap-3">
        <EnterpriseBrandMark size={36} />
        <span className="text-lg font-semibold tracking-tight">{ENTERPRISE_PRODUCT_NAME}</span>
      </div>

      <Card className="w-full max-w-md border-border/70 shadow-lg">
        <CardHeader className="space-y-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MonitorSmartphone className="h-5 w-5" />
          </div>
          <CardTitle>授权 {ENTERPRISE_PRODUCT_NAME} Desktop</CardTitle>
          <CardDescription>
            确认后，桌面端将获得企业托管模型访问权限。此页面不会显示或传递任何密钥。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在确认登录状态…
            </div>
          ) : done ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                已授权成功。请返回 {ENTERPRISE_PRODUCT_NAME} Desktop，应用会自动完成登录。你可以关闭此页面。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {session ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    当前企业账号
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {session.displayName || session.email || "已登录用户"}
                    {session.email ? ` · ${session.email}` : ""}
                  </div>
                </div>
              ) : null}
              {error ? (
                <Alert>
                  <AlertDescription className="text-destructive">{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button className="w-full" disabled={busy || !deviceId} onClick={() => void onApprove()}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    授权中…
                  </>
                ) : (
                  "确认授权 Desktop"
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          加载中…
        </main>
      }
    >
      <DesktopAuthInner />
    </Suspense>
  );
}
