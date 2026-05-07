"use client";

import { getAdminSsoErrorMessageZh } from "@agenticx/auth/src/services/oidc-error-codes";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@agenticx/ui";
import { parseProvidersPayload } from "./providers-payload";
import { shouldDisableSamlHealthCheck, shouldDisableSamlToggle } from "./saml-ui-guards";

type Protocol = "oidc" | "saml";

type SamlAttributeMapping = {
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  dept?: string;
  roles?: string;
  externalId?: string;
};

type SamlConfigDto = {
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl?: string | null;
  idpCertPemList: string[];
  spEntityId: string;
  acsUrl: string;
  nameIdFormat?: string | null;
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
  clockSkewSeconds: number;
  attributeMapping: SamlAttributeMapping;
};

type Provider = {
  id: string;
  providerId: string;
  displayName: string;
  protocol: Protocol;
  issuer: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scopes: string[];
  enabled: boolean;
  samlConfig: SamlConfigDto | null;
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

type OidcHealth = {
  protocol: "oidc";
  reachable: boolean;
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  signingAlgorithms?: string[];
  error?: string;
};

type SamlHealth = {
  protocol: "saml";
  certs: Array<{
    index: number;
    subject?: string | null;
    issuer?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    expired: boolean;
    notYetValid: boolean;
  }>;
  ssoUrlReachable: boolean | null;
  ssoUrlStatus?: number | null;
  ssoUrlError?: string;
};

function formatPercent(x: number | null): string {
  if (x == null || Number.isNaN(x)) return "—";
  return `${Math.round(x * 10_000) / 100}%`;
}

function buildEmptySamlForm(): SamlConfigDto & { idpCertPemListText: string } {
  return {
    idpEntityId: "",
    idpSsoUrl: "",
    idpSloUrl: "",
    idpCertPemList: [],
    spEntityId: "",
    acsUrl: "",
    nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    wantAssertionsSigned: true,
    wantResponseSigned: false,
    clockSkewSeconds: 60,
    attributeMapping: { email: "email" },
    idpCertPemListText: "",
  };
}

export default function SsoSettingsPage() {
  const [items, setItems] = useState<Provider[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cacheStats, setCacheStats] = useState<SsoCacheStatsPayload | null>(null);
  const [healthByProvider, setHealthByProvider] = useState<Record<string, OidcHealth | SamlHealth | { error: string }>>({});
  const [protocol, setProtocol] = useState<Protocol>("oidc");
  const [samlGloballyDisabled, setSamlGloballyDisabled] = useState(false);
  const [oidcForm, setOidcForm] = useState({
    providerId: "default",
    displayName: "企业统一认证",
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    scopes: "openid profile email",
  });
  const [samlForm, setSamlForm] = useState(() => ({
    providerId: "saml",
    displayName: "企业 SAML 登录",
    samlConfig: buildEmptySamlForm(),
  }));

  function formatApiError(data: { message?: string; ssoError?: string }): string {
    const code = typeof data.ssoError === "string" ? data.ssoError : null;
    if (code) return getAdminSsoErrorMessageZh(code);
    return data.message ?? "操作失败";
  }

  async function loadProviders() {
    const response = await fetch("/api/admin/sso/providers");
    const data = await response.json();
    if (response.ok) {
      const parsed = parseProvidersPayload<Provider>(data);
      setItems(parsed.providers);
      setSamlGloballyDisabled(parsed.samlGloballyDisabled);
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

  useEffect(() => {
    if (samlGloballyDisabled && protocol === "saml") {
      setProtocol("oidc");
    }
  }, [protocol, samlGloballyDisabled]);

  async function saveProvider() {
    setSaving(true);
    setStatus(null);
    try {
      const body =
        protocol === "oidc"
          ? {
              ...oidcForm,
              protocol: "oidc",
              scopes: oidcForm.scopes.split(/[,\s]+/).filter(Boolean),
              enabled: true,
            }
          : {
              providerId: samlForm.providerId,
              displayName: samlForm.displayName,
              protocol: "saml",
              enabled: true,
              samlConfig: {
                ...samlForm.samlConfig,
                idpCertPemList: parseCertList(samlForm.samlConfig.idpCertPemListText),
              },
            };
      const response = await fetch("/api/admin/sso/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

  async function runHealthCheck(item: Provider) {
    setHealthByProvider((prev) => ({ ...prev, [item.id]: { error: "checking" } }));
    try {
      const response = await fetch(`/api/admin/sso/providers/${item.id}/health`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        setHealthByProvider((prev) => ({ ...prev, [item.id]: { error: formatApiError(data) } }));
        return;
      }
      setHealthByProvider((prev) => ({ ...prev, [item.id]: data.data?.health }));
    } catch (error) {
      setHealthByProvider((prev) => ({
        ...prev,
        [item.id]: { error: error instanceof Error ? error.message : `${error}` },
      }));
    }
  }

  const g = cacheStats?.global;
  const denom = g ? g.hits + g.misses : 0;

  const protocolLabel = useMemo(() => (protocol === "oidc" ? "OIDC" : "SAML 2.0"), [protocol]);

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
          <CardTitle>新增 SSO Provider · {protocolLabel}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="protocol">协议</Label>
            <select
              id="protocol"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              value={protocol}
              onChange={(e) => setProtocol((e.target.value === "saml" ? "saml" : "oidc") as Protocol)}
            >
              <option value="oidc">OIDC（OpenID Connect）</option>
              <option value="saml" disabled={samlGloballyDisabled}>
                SAML 2.0（飞书 / Okta / 中移动 IDaaS 等）
              </option>
            </select>
          </div>

          {protocol === "oidc" ? (
            <OidcForm form={oidcForm} setForm={setOidcForm} />
          ) : (
            <SamlForm form={samlForm} setForm={setSamlForm} />
          )}

          <Button onClick={saveProvider} disabled={saving || (protocol === "saml" && samlGloballyDisabled)}>
            {saving ? "保存中..." : "保存"}
          </Button>
          {samlGloballyDisabled ? (
            <Alert>
              <AlertDescription>SAML 已被全局禁用，当前仅允许新增 OIDC Provider。</AlertDescription>
            </Alert>
          ) : null}
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
          {items.map((item) => {
            const health = healthByProvider[item.id];
            return (
              <div key={item.id} className="grid gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {item.displayName}
                      <span className="ml-2 rounded-md border px-2 py-0.5 text-xs uppercase text-muted-foreground">
                        {item.protocol}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.providerId}
                      {item.protocol === "oidc" && item.issuer ? ` · ${item.issuer}` : null}
                      {item.protocol === "saml" && item.samlConfig?.idpEntityId
                        ? ` · ${item.samlConfig.idpEntityId}`
                        : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={shouldDisableSamlHealthCheck(item, samlGloballyDisabled)}
                      onClick={() => void runHealthCheck(item)}
                    >
                      健康检查
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={shouldDisableSamlToggle(item, samlGloballyDisabled)}
                      onClick={() => toggleEnabled(item, !item.enabled)}
                    >
                      {item.enabled ? "停用" : "启用"}
                    </Button>
                  </div>
                </div>
                {health ? <HealthDetail health={health} /> : null}
              </div>
            );
          })}
          {items.length === 0 ? <p className="text-sm text-muted-foreground">暂无 SSO Provider</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}

function parseCertList(text: string): string[] {
  if (!text.trim()) return [];
  const blocks = text.split(/-----END CERTIFICATE-----/);
  const result: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (!trimmed.includes("BEGIN CERTIFICATE")) continue;
    result.push(`${trimmed}\n-----END CERTIFICATE-----`);
  }
  return result;
}

function OidcForm(props: {
  form: {
    providerId: string;
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string;
  };
  setForm: React.Dispatch<React.SetStateAction<{
    providerId: string;
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string;
  }>>;
}) {
  const { form, setForm } = props;
  return (
    <>
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
    </>
  );
}

type SamlFormState = {
  providerId: string;
  displayName: string;
  samlConfig: ReturnType<typeof buildEmptySamlForm>;
};

function SamlForm(props: {
  form: SamlFormState;
  setForm: React.Dispatch<React.SetStateAction<SamlFormState>>;
}) {
  const { form, setForm } = props;
  const update = (patch: Partial<SamlFormState["samlConfig"]>) =>
    setForm((prev) => ({ ...prev, samlConfig: { ...prev.samlConfig, ...patch } }));
  const updateAttribute = (key: keyof SamlAttributeMapping, value: string) =>
    setForm((prev) => ({
      ...prev,
      samlConfig: {
        ...prev.samlConfig,
        attributeMapping: {
          ...prev.samlConfig.attributeMapping,
          [key]: value,
        },
      },
    }));

  return (
    <>
      <div className="grid gap-1">
        <Label htmlFor="saml-providerId">Provider ID</Label>
        <Input
          id="saml-providerId"
          value={form.providerId}
          onChange={(e) => setForm((prev) => ({ ...prev, providerId: e.target.value }))}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="saml-displayName">显示名称</Label>
        <Input
          id="saml-displayName"
          value={form.displayName}
          onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="idpEntityId">IdP Entity ID</Label>
        <Input
          id="idpEntityId"
          value={form.samlConfig.idpEntityId}
          onChange={(e) => update({ idpEntityId: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="idpSsoUrl">IdP SSO URL（HTTP-POST 或 HTTP-Redirect）</Label>
        <Input
          id="idpSsoUrl"
          value={form.samlConfig.idpSsoUrl}
          onChange={(e) => update({ idpSsoUrl: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="idpSloUrl">IdP SLO URL（可选）</Label>
        <Input
          id="idpSloUrl"
          value={form.samlConfig.idpSloUrl ?? ""}
          onChange={(e) => update({ idpSloUrl: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="spEntityId">SP Entity ID（与 IdP 配置一致）</Label>
        <Input
          id="spEntityId"
          value={form.samlConfig.spEntityId}
          onChange={(e) => update({ spEntityId: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="acsUrl">ACS URL（指向 /api/auth/sso/saml/callback）</Label>
        <Input
          id="acsUrl"
          value={form.samlConfig.acsUrl}
          onChange={(e) => update({ acsUrl: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="idpCertPemListText">IdP 证书 PEM 列表（每张证书完整保留 BEGIN/END 块）</Label>
        <textarea
          id="idpCertPemListText"
          className="min-h-[160px] rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          value={form.samlConfig.idpCertPemListText}
          onChange={(e) => update({ idpCertPemListText: e.target.value })}
          placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor="nameIdFormat">NameID Format</Label>
          <select
            id="nameIdFormat"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            value={form.samlConfig.nameIdFormat ?? ""}
            onChange={(e) => update({ nameIdFormat: e.target.value || null })}
          >
            <option value="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">emailAddress</option>
            <option value="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">persistent</option>
            <option value="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">transient</option>
            <option value="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">unspecified</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="clockSkewSeconds">时钟偏移（秒）</Label>
          <Input
            id="clockSkewSeconds"
            type="number"
            min={0}
            value={form.samlConfig.clockSkewSeconds}
            onChange={(e) => update({ clockSkewSeconds: Number(e.target.value) || 0 })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.samlConfig.wantAssertionsSigned}
            onChange={(e) => update({ wantAssertionsSigned: e.target.checked })}
          />
          要求断言签名（推荐开启）
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.samlConfig.wantResponseSigned}
            onChange={(e) => update({ wantResponseSigned: e.target.checked })}
          />
          要求 Response 签名
        </label>
      </div>
      <div className="grid gap-1">
        <Label>Attribute Mapping</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="email（必填）"
            value={form.samlConfig.attributeMapping.email}
            onChange={(e) => updateAttribute("email", e.target.value)}
          />
          <Input
            placeholder="displayName"
            value={form.samlConfig.attributeMapping.displayName ?? ""}
            onChange={(e) => updateAttribute("displayName", e.target.value)}
          />
          <Input
            placeholder="firstName"
            value={form.samlConfig.attributeMapping.firstName ?? ""}
            onChange={(e) => updateAttribute("firstName", e.target.value)}
          />
          <Input
            placeholder="lastName"
            value={form.samlConfig.attributeMapping.lastName ?? ""}
            onChange={(e) => updateAttribute("lastName", e.target.value)}
          />
          <Input
            placeholder="dept"
            value={form.samlConfig.attributeMapping.dept ?? ""}
            onChange={(e) => updateAttribute("dept", e.target.value)}
          />
          <Input
            placeholder="roles"
            value={form.samlConfig.attributeMapping.roles ?? ""}
            onChange={(e) => updateAttribute("roles", e.target.value)}
          />
        </div>
      </div>
    </>
  );
}

function HealthDetail(props: { health: OidcHealth | SamlHealth | { error: string } }) {
  const { health } = props;
  if ("error" in health) {
    return <p className="text-xs text-destructive">健康检查失败：{health.error}</p>;
  }
  if (health.protocol === "oidc") {
    return (
      <div className="rounded-md bg-muted/40 p-2 text-xs">
        <p>
          可达性：<strong>{health.reachable ? "OK" : "失败"}</strong>
          {health.error ? ` · ${health.error}` : null}
        </p>
        {health.authorizationEndpoint ? <p>authorization_endpoint：{health.authorizationEndpoint}</p> : null}
        {health.tokenEndpoint ? <p>token_endpoint：{health.tokenEndpoint}</p> : null}
        {health.signingAlgorithms ? (
          <p>id_token 算法：{health.signingAlgorithms.join(", ")}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-md bg-muted/40 p-2 text-xs">
      <p>
        IdP SSO URL 可达：
        {health.ssoUrlReachable === null
          ? "未检测"
          : health.ssoUrlReachable
            ? `OK${health.ssoUrlStatus ? `（HTTP ${health.ssoUrlStatus}）` : ""}`
            : `失败${health.ssoUrlError ? `（${health.ssoUrlError}）` : ""}`}
      </p>
      {health.certs.map((cert) => (
        <p key={cert.index}>
          证书 #{cert.index + 1}
          {cert.subject ? ` · subject=${cert.subject}` : ""}
          {cert.validFrom ? ` · validFrom=${cert.validFrom}` : ""}
          {cert.validTo ? ` · validTo=${cert.validTo}` : ""}
          {cert.expired ? "（已过期）" : cert.notYetValid ? "（尚未生效）" : "（有效）"}
        </p>
      ))}
    </div>
  );
}
