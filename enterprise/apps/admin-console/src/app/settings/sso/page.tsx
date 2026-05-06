"use client";

import { getAdminSsoErrorMessageZh } from "@agenticx/auth/src/services/oidc-error-codes";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@agenticx/ui";

type Provider = {
  id: string;
  providerId: string;
  displayName: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  enabled: boolean;
};

type SsoCacheStatsPayload = {
  global: {
    hits: number;
    misses: number;
    staleHits: number;
    staleEvictions: number;
    lastError: string | null;
  };
  byProvider: Record<string, { hits: number; misses: number; staleHits: number; staleEvictions: number }>;
  hitRateApprox: number | null;
};

function formatPercent(x: number | null): string {
  if (x == null || Number.isNaN(x)) return "—";
  return `${Math.round(x * 10_000) / 100}%`;
}

export default function SsoSettingsPage() {
  const [items, setItems] = useState<Provider[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cacheStats, setCacheStats] = useState<SsoCacheStatsPayload | null>(null);
  const [form, setForm] = useState({
    providerId: "default",
    displayName: "企业统一认证",
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    scopes: "openid profile email",
  });

  function formatApiError(data: { message?: string; ssoError?: string }): string {
    const code = typeof data.ssoError === "string" ? data.ssoError : null;
    if (code) return getAdminSsoErrorMessageZh(code);
    return data.message ?? "操作失败";
  }

  async function loadProviders() {
    const response = await fetch("/api/admin/sso/providers");
    const data = await response.json();
    if (response.ok) {
      setItems((data.data?.providers ?? []) as Provider[]);
    }
  }

  async function loadCacheStats() {
    const response = await fetch("/api/admin/sso/providers/stats");
    const data = await response.json();
    if (response.ok) {
      setCacheStats((data.data?.stats ?? null) as SsoCacheStatsPayload | null);
    }
  }

  useEffect(() => {
    void loadProviders();
    void loadCacheStats();
  }, []);

  async function saveProvider() {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/sso/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          scopes: form.scopes.split(/[,\s]+/).filter(Boolean),
          enabled: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(formatApiError(data));
        return;
      }
      setStatus("保存成功");
      await loadProviders();
      await loadCacheStats();
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(item: Provider, enabled: boolean) {
    const response = await fetch(`/api/admin/sso/providers/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(formatApiError(data));
      return;
    }
    await loadProviders();
    await loadCacheStats();
  }

  const g = cacheStats?.global;
  const denom = g ? g.hits + g.misses : 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>OIDC Discovery 缓存</CardTitle>
            <p className="text-sm text-muted-foreground">
              命中率按「进程内累计」估算（hits / (hits + misses)），不等同于严格 1 小时滑动窗口；用于观察 IdP discovery 是否频繁未命中缓存。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadCacheStats()}>
            刷新统计
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {g ? (
            <>
              <div className="grid gap-1 rounded-md border p-3">
                <p>
                  <span className="font-medium">全局命中占比（近似）：</span> {formatPercent(cacheStats?.hitRateApprox ?? null)}
                </p>
                <p className="text-muted-foreground">
                  hits: {g.hits} · misses: {g.misses} · staleHits: {g.staleHits} · staleEvictions: {g.staleEvictions}
                  {denom === 0 ? "（尚无请求样本）" : null}
                </p>
                {g.lastError ? (
                  <p className="text-destructive">
                    最近 discovery 错误摘要：<span className="break-all">{g.lastError}</span>
                  </p>
                ) : null}
              </div>
              {cacheStats?.byProvider && Object.keys(cacheStats.byProvider).length > 0 ? (
                <div className="rounded-md border p-3">
                  <p className="mb-2 font-medium">按 Provider</p>
                  <ul className="grid list-none gap-2">
                    {Object.entries(cacheStats.byProvider).map(([pid, row]) => {
                      const d = row.hits + row.misses;
                      const rate = d > 0 ? row.hits / d : null;
                      return (
                        <li key={pid} className="flex justify-between gap-2 border-b border-border pb-2 last:border-0">
                          <span className="font-mono text-xs">{pid}</span>
                          <span className="text-muted-foreground">
                            命中≈{formatPercent(rate)} · hits {row.hits} / misses {row.misses} · stale {row.staleHits}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">暂无统计数据（需具备 sso:read 并已产生过 OIDC 请求）。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SSO Provider 设置</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="providerId">Provider ID</Label>
            <Input id="providerId" value={form.providerId} onChange={(e) => setForm((prev) => ({ ...prev, providerId: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="displayName">显示名称</Label>
            <Input id="displayName" value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="issuer">Issuer</Label>
            <Input id="issuer" value={form.issuer} onChange={(e) => setForm((prev) => ({ ...prev, issuer: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="clientId">Client ID</Label>
            <Input id="clientId" value={form.clientId} onChange={(e) => setForm((prev) => ({ ...prev, clientId: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input
              id="clientSecret"
              type="password"
              value={form.clientSecret}
              onChange={(e) => setForm((prev) => ({ ...prev, clientSecret: e.target.value }))}
              placeholder="留空表示不更新"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="redirectUri">Redirect URI</Label>
            <Input id="redirectUri" value={form.redirectUri} onChange={(e) => setForm((prev) => ({ ...prev, redirectUri: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="scopes">Scopes</Label>
            <Input id="scopes" value={form.scopes} onChange={(e) => setForm((prev) => ({ ...prev, scopes: e.target.value }))} />
          </div>
          <Button onClick={saveProvider} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
          {status ? (
            <Alert>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>已配置 Provider</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">{item.displayName}</p>
                <p className="text-sm text-muted-foreground">
                  {item.providerId} · {item.issuer}
                </p>
              </div>
              <Button variant="outline" onClick={() => toggleEnabled(item, !item.enabled)}>
                {item.enabled ? "停用" : "启用"}
              </Button>
            </div>
          ))}
          {items.length === 0 ? <p className="text-sm text-muted-foreground">暂无 SSO Provider</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
