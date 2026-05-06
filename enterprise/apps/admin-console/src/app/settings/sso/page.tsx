"use client";

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

export default function SsoSettingsPage() {
  const [items, setItems] = useState<Provider[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    providerId: "default",
    displayName: "企业统一认证",
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    scopes: "openid profile email",
  });

  async function loadProviders() {
    const response = await fetch("/api/admin/sso/providers");
    const data = await response.json();
    if (response.ok) {
      setItems((data.data?.providers ?? []) as Provider[]);
    }
  }

  useEffect(() => {
    void loadProviders();
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
        setStatus(data.message ?? "保存失败");
        return;
      }
      setStatus("保存成功");
      await loadProviders();
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
      setStatus(data.message ?? "更新失败");
      return;
    }
    await loadProviders();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
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
