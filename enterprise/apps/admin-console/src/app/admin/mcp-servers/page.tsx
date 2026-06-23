"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Textarea,
  toast,
} from "@agenticx/ui";
import { Plug, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

type McpProxyServer = {
  id: string;
  name: string;
  upstreamUrl: string;
  enabled: boolean;
  toolRateLimit?: number;
};

type McpServer = {
  id: string;
  name: string;
  displayName: string;
  backendType: string;
  transport: string;
  status: string;
};

type Health = {
  callCount: number;
  failCount: number;
  failRate: number;
  p50LatencyMs: number;
};

function resolveGatewayBase(): string {
  return (
    process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL?.trim() || "http://127.0.0.1:8088"
  ).replace(/\/+$/, "");
}

function proxyClientUrl(base: string, serverId: string): string {
  return `${base}/v1/mcp/${serverId}/`;
}

function proxyMcpJsonSnippet(
  base: string,
  server: { id: string; name: string },
  patPlaceholder: string
): string {
  const cfg = {
    mcpServers: {
      [server.name || server.id]: {
        url: `${base}/v1/mcp/${server.id}/`,
        headers: { Authorization: `Bearer ${patPlaceholder}` },
      },
    },
  };
  return JSON.stringify(cfg, null, 2);
}

export default function AdminMcpServersPage() {
  const t = useTranslations("pages.admin.mcpServers");
  const tc = useTranslations("common");
  const gatewayBase = resolveGatewayBase();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [name, setName] = useState("");
  const [backendType, setBackendType] = useState("openapi");
  const [openApiSpec, setOpenApiSpec] = useState("");
  const [allowedOps, setAllowedOps] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://petstore3.swagger.io/api/v3");
  const [proxyServers, setProxyServers] = useState<McpProxyServer[]>([]);
  const [proxyName, setProxyName] = useState("");
  const [proxyUpstream, setProxyUpstream] = useState("");
  const [proxyAuth, setProxyAuth] = useState("");
  const [proxyRpm, setProxyRpm] = useState("60");
  /** Single expanded config panel; opening B collapses A. */
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("proxyCopied"));
      } catch {
        toast.error(tc("states.error"));
      }
    },
    [t, tc]
  );

  const loadProxy = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/mcp-proxy-servers");
      const json = (await res.json()) as { data?: { servers?: McpProxyServer[] } };
      setProxyServers(json.data?.servers ?? []);
    } catch {
      toast.error(t("toast.loadFailed"));
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/mcp-servers");
      const json = (await res.json()) as { data?: { servers?: McpServer[] } };
      setServers(json.data?.servers ?? []);
      await loadProxy();
    } catch {
      toast.error(t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t, loadProxy]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createServer() {
    if (!name.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    try {
      const res = await adminFetch("/api/admin/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), backendType, displayName: name.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.createSuccess"));
      setName("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.createFailed"));
    }
  }

  async function loadHealth(id: string) {
    setSelectedId(id);
    try {
      const res = await fetch(`/api/admin/mcp-servers/${id}/stats`);
      const json = (await res.json()) as { data?: Health };
      setHealth(json.data ?? null);
    } catch {
      setHealth(null);
      toast.error(t("toast.healthLoadFailed"));
    }
  }

  async function importOpenAPI() {
    if (!selectedId || !openApiSpec.trim()) {
      toast.error(t("toast.selectServerAndSpec"));
      return;
    }
    try {
      const res = await fetch(`/api/admin/mcp-servers/${selectedId}/openapi`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spec: openApiSpec,
          allowedOperationIds: allowedOps.split(",").map((s) => s.trim()).filter(Boolean),
          baseUrl,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.importSuccess"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.importFailed"));
    }
  }

  async function createProxyServer() {
    if (!proxyName.trim() || !proxyUpstream.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    try {
      const res = await adminFetch("/api/admin/mcp-proxy-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: proxyName.trim(),
          upstreamUrl: proxyUpstream.trim(),
          authHeader: proxyAuth.trim() || undefined,
          toolRateLimit: Number(proxyRpm) || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.createSuccess"));
      setProxyName("");
      setProxyUpstream("");
      setProxyAuth("");
      await loadProxy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.createFailed"));
    }
  }

  async function toggleProxyServer(server: McpProxyServer) {
    try {
      const res = await adminFetch(`/api/admin/mcp-proxy-servers/${server.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadProxy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.createFailed"));
    }
  }

  async function removeProxyServer(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      const res = await adminFetch(`/api/admin/mcp-proxy-servers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.deleteSuccess"));
      if (expandedConfigId === id) setExpandedConfigId(null);
      await loadProxy();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.deleteFailed"));
    }
  }

  async function removeServer(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    try {
      const res = await fetch(`/api/admin/mcp-servers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(t("toast.deleteSuccess"));
      if (selectedId === id) {
        setSelectedId(null);
        setHealth(null);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.deleteFailed"));
    }
  }

  function toggleConfigPanel(serverId: string) {
    setExpandedConfigId((cur) => (cur === serverId ? null : serverId));
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" /> {t("createTitle")}
          </CardTitle>
          <CardDescription>{t("createDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="mcp-name">Name</Label>
            <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="petstore" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mcp-backend">Backend</Label>
            <Input id="mcp-backend" value={backendType} onChange={(e) => setBackendType(e.target.value)} />
          </div>
          <Button onClick={() => void createServer()}>{tc("actions.create")}</Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-1 size-4" /> {tc("actions.refresh")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" /> {t("listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>}
          {!loading && servers.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
          )}
          {servers.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <div className="font-medium">{s.displayName || s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.name} · {s.backendType} · {s.transport}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => void loadHealth(s.id)}>
                  {t("healthPanel")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void removeServer(s.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          {health && selectedId && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              {t("healthStats", {
                callCount: health.callCount,
                failRate: (health.failRate * 100).toFixed(1),
                p50: health.p50LatencyMs,
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("proxyTitle")}</CardTitle>
          <CardDescription>{t("proxyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 rounded-md border p-3 text-xs text-muted-foreground">
            <p>{t("proxyAuthNote", { gatewayBase })}</p>
            <p>{t("proxyPatReusableNote")}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/api-tokens">{t("proxyManagePat")}</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="proxy-name">Name</Label>
              <Input id="proxy-name" value={proxyName} onChange={(e) => setProxyName(e.target.value)} />
            </div>
            <div className="space-y-1 min-w-[280px]">
              <Label htmlFor="proxy-upstream">{t("proxyUpstreamUrl")}</Label>
              <Input
                id="proxy-upstream"
                value={proxyUpstream}
                onChange={(e) => setProxyUpstream(e.target.value)}
                placeholder="https://mcp.example.com"
              />
            </div>
            <div className="space-y-1 min-w-[240px]">
              <Label htmlFor="proxy-auth">{t("proxyAuthHeader")}</Label>
              <Input
                id="proxy-auth"
                value={proxyAuth}
                onChange={(e) => setProxyAuth(e.target.value)}
                placeholder="Authorization: Bearer …"
              />
            </div>
            <div className="space-y-1 w-28">
              <Label htmlFor="proxy-rpm">{t("proxyRateLimit")}</Label>
              <Input id="proxy-rpm" value={proxyRpm} onChange={(e) => setProxyRpm(e.target.value)} />
            </div>
            <Button onClick={() => void createProxyServer()}>{tc("actions.create")}</Button>
          </div>
          {proxyServers.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("proxyEmpty")}</p>
          )}
          {proxyServers.map((s) => {
            const clientUrl = proxyClientUrl(gatewayBase, s.id);
            const configSnippet = proxyMcpJsonSnippet(gatewayBase, s, t("proxyPatPlaceholder"));
            const configExpanded = expandedConfigId === s.id;
            return (
              <div key={s.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{t("proxyClientUrlLabel")}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all font-mono text-xs">{clientUrl}</code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copyText(clientUrl)}
                      >
                        {t("proxyCopyUrl")}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground/80">
                      {t("proxyUpstreamLabel")}: {s.upstreamUrl}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.enabled ? "default" : "secondary"}>
                      {s.enabled ? "enabled" : "disabled"}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => toggleConfigPanel(s.id)}>
                      {t("proxyViewConfig")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void toggleProxyServer(s)}>
                      {s.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void removeProxyServer(s.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {configExpanded ? (
                  <div className="space-y-2 border-t pt-3">
                    <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
                      {configSnippet}
                    </pre>
                    <Button size="sm" variant="outline" onClick={() => void copyText(configSnippet)}>
                      {t("proxyCopyConfig")}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("openapiTitle")}</CardTitle>
          <CardDescription>{t("openapiDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("targetServerLabel")}</Label>
            <Input value={selectedId ?? ""} readOnly placeholder={t("notSelected")} />
          </div>
          <div className="space-y-1">
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Allowed operationIds</Label>
            <Input
              value={allowedOps}
              onChange={(e) => setAllowedOps(e.target.value)}
              placeholder="findPetsByStatus,getPetById,addPet"
            />
          </div>
          <div className="space-y-1">
            <Label>OpenAPI JSON</Label>
            <Textarea
              className="min-h-[160px] font-mono text-xs"
              value={openApiSpec}
              onChange={(e) => setOpenApiSpec(e.target.value)}
              placeholder='{"openapi":"3.0.3","paths":{...}}'
            />
          </div>
          <Button onClick={() => void importOpenAPI()} disabled={!selectedId}>
            {t("importTools")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
