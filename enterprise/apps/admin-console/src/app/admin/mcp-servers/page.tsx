"use client";
import { adminFetch } from "../../../lib/admin-client-auth";
import {
  getPatPlainFromVault,
  isValidPat,
  readPatSelected,
  removePatFromVault,
  upsertPatVault,
  writePatSelected,
  upsertPatFromPlainIfMatches,
} from "../../../lib/pat-vault";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agenticx/ui";
import { ArrowLeftRight, Check, Circle, Copy, FileJson, KeyRound, Plug, Plus, Power, PowerOff, RefreshCcw, Trash2 } from "lucide-react";
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

type PatRow = {
  id: number;
  name: string;
  tokenPrefix: string;
  status: string;
  userId: string;
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
  const [clientPatPlain, setClientPatPlain] = useState("");
  const [patDialogOpen, setPatDialogOpen] = useState(false);
  const [patTokens, setPatTokens] = useState<PatRow[]>([]);
  const [patPaste, setPatPaste] = useState("");
  const [patCreateForm, setPatCreateForm] = useState({ name: "", userId: "", expireDays: "90" });
  const [patCreating, setPatCreating] = useState(false);
  const [patNewPlain, setPatNewPlain] = useState<string | null>(null);
  const [activePatTab, setActivePatTab] = useState("use");
  const [patReferencedId, setPatReferencedId] = useState<number | null>(null);

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

  useEffect(() => {
    setClientPatPlain(readPatSelected());
  }, []);

  const referencePatInDialog = useCallback(
    (plain: string, tokenId: number) => {
      setPatPaste(plain);
      setPatNewPlain(null);
      setPatReferencedId(tokenId);
      toast.success(t("proxyPatReferenced"));
    },
    [t]
  );

  const applyClientPat = useCallback(
    (plain: string) => {
      const trimmed = plain.trim();
      if (!isValidPat(trimmed)) {
        toast.error(t("proxyPatInvalid"));
        return false;
      }
      setClientPatPlain(trimmed);
      writePatSelected(trimmed);
      toast.success(t("proxyPatApplied"));
      return true;
    },
    [t]
  );

  const openPatDialog = useCallback(async () => {
    setPatDialogOpen(true);
    setPatNewPlain(null);
    setPatReferencedId(null);
    setPatPaste(clientPatPlain);
    try {
      const res = await adminFetch("/api/admin/api-tokens");
      const json = (await res.json()) as {
        code?: string;
        data?: { tokens?: PatRow[] };
      };
      if (res.ok && json.code === "00000") {
        const all = json.data?.tokens ?? [];
        for (const row of all) {
          if (row.status !== "active") removePatFromVault(row.id);
        }
        setPatTokens(all.filter((row) => row.status === "active"));
      }
    } catch {
      toast.error(t("toast.loadFailed"));
    }
  }, [clientPatPlain, t]);

  const createPatInDialog = async () => {
    if (!patCreateForm.name.trim() || !patCreateForm.userId.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    setPatCreating(true);
    try {
      const res = await adminFetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: patCreateForm.name.trim(),
          userId: patCreateForm.userId.trim(),
          expireDays: Number(patCreateForm.expireDays) || 90,
        }),
      });
      const json = (await res.json()) as {
        code?: string;
        message?: string;
        data?: { token?: string; record?: PatRow };
      };
      if (!res.ok || json.code !== "00000") {
        throw new Error(json.message || t("toast.createFailed"));
      }
      const plain = json.data?.token?.trim() ?? "";
      const record = json.data?.record;
      if (plain && record) {
        upsertPatVault({
          id: record.id,
          name: record.name,
          tokenPrefix: record.tokenPrefix,
          plainToken: plain,
        });
        setPatNewPlain(plain);
        setPatPaste(plain);
        setPatReferencedId(record.id);
      }
      setPatCreateForm({ name: "", userId: "", expireDays: "90" });
      const listRes = await adminFetch("/api/admin/api-tokens");
      const listJson = (await listRes.json()) as { code?: string; data?: { tokens?: PatRow[] } };
      if (listRes.ok && listJson.code === "00000") {
        setPatTokens(listJson.data?.tokens ?? []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.createFailed"));
    } finally {
      setPatCreating(false);
    }
  };

  const confirmPatDialog = () => {
    const candidate = (patNewPlain ?? patPaste).trim();
    if (!candidate) {
      toast.error(t("proxyPatInvalid"));
      return;
    }
    upsertPatFromPlainIfMatches(
      patTokens.filter((row) => row.status === "active"),
      candidate
    );
    if (applyClientPat(candidate)) {
      setPatDialogOpen(false);
      setPatNewPlain(null);
    }
  };

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
    if (expandedConfigId === serverId) {
      setExpandedConfigId(null);
      return;
    }
    if (!clientPatPlain.trim()) {
      void openPatDialog();
    }
    setExpandedConfigId(serverId);
  }

  const patForConfig = clientPatPlain.trim() || t("proxyPatPlaceholder");

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
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
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
          </div>
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Plug className="size-4 text-muted-foreground" /> {t("listTitle")}
            </div>
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-4" /> {t("proxyTitle")}
          </CardTitle>
          <CardDescription>{t("proxyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex w-full flex-wrap items-end gap-3 lg:flex-nowrap">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="proxy-name">Name</Label>
              <Input id="proxy-name" value={proxyName} onChange={(e) => setProxyName(e.target.value)} />
            </div>
            <div className="min-w-0 flex-[1.25] space-y-1">
              <Label htmlFor="proxy-upstream">{t("proxyUpstreamUrl")}</Label>
              <Input
                id="proxy-upstream"
                value={proxyUpstream}
                onChange={(e) => setProxyUpstream(e.target.value)}
                placeholder="https://mcp.example.com"
              />
            </div>
            <div className="min-w-0 flex-[1.5] space-y-1">
              <Label htmlFor="proxy-auth">{t("proxyAuthHeader")}</Label>
              <Input
                id="proxy-auth"
                value={proxyAuth}
                onChange={(e) => setProxyAuth(e.target.value)}
                placeholder="Authorization: Bearer …"
              />
            </div>
            <div className="w-[148px] shrink-0 space-y-1">
              <Label htmlFor="proxy-rpm" className="whitespace-nowrap">
                {t("proxyRateLimit")}
              </Label>
              <Input id="proxy-rpm" value={proxyRpm} onChange={(e) => setProxyRpm(e.target.value)} />
            </div>
            <Button className="shrink-0" onClick={() => void createProxyServer()}>
              {tc("actions.create")}
            </Button>
          </div>
          {proxyServers.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("proxyEmpty")}</p>
          )}
          {proxyServers.map((s) => {
            const clientUrl = proxyClientUrl(gatewayBase, s.id);
            const configSnippet = proxyMcpJsonSnippet(gatewayBase, s, patForConfig);
            const configExpanded = expandedConfigId === s.id;
            return (
              <div key={s.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-normal ${
                          s.enabled ? "text-emerald-600" : "text-muted-foreground"
                        }`}
                      >
                        <Circle
                          className={`size-2 fill-current ${
                            s.enabled ? "text-emerald-500" : "text-muted-foreground"
                          }`}
                        />
                        {s.enabled ? tc("status.enabled") : tc("status.disabled")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">{t("proxyClientUrlLabel")}</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <code className="break-all font-mono text-xs">{clientUrl}</code>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground/70 hover:text-foreground"
                            onClick={() => void copyText(clientUrl)}
                          >
                            <Copy className="size-3.5" />
                            <span className="sr-only">{t("proxyCopyUrl")}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{t("proxyCopyUrl")}</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="text-xs text-muted-foreground/80">
                      {t("proxyUpstreamLabel")}: {s.upstreamUrl}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => void openPatDialog()}>
                          <KeyRound className="size-4" />
                          <span className="sr-only">{t("proxyManagePat")}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t("proxyManagePat")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={() => void toggleProxyServer(s)}>
                          {s.enabled ? (
                            <PowerOff className="size-4" />
                          ) : (
                            <Power className="size-4" />
                          )}
                          <span className="sr-only">
                            {s.enabled ? t("proxyDisable") : t("proxyEnable")}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {s.enabled ? t("proxyDisable") : t("proxyEnable")}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={() => void removeProxyServer(s.id)}>
                          <Trash2 className="size-4" />
                          <span className="sr-only">{tc("actions.delete")}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{tc("actions.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleConfigPanel(s.id)}>
                    {t("proxyViewConfig")}
                  </Button>
                </div>
                {configExpanded ? (
                  <div className="relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1 z-10 size-7 text-muted-foreground/70 hover:text-foreground"
                          onClick={() => void copyText(configSnippet)}
                        >
                          <Copy className="size-3.5" />
                          <span className="sr-only">{t("proxyCopyConfig")}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t("proxyCopyConfig")}</TooltipContent>
                    </Tooltip>
                    <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 pr-10 font-mono text-xs">
                      {configSnippet}
                    </pre>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={patDialogOpen} onOpenChange={setPatDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("proxyPatDialogTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("proxyPatDialogDesc")}</p>

          <Tabs value={activePatTab} onValueChange={setActivePatTab} className="mt-2 w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="use">{t("proxyPatTabUse")}</TabsTrigger>
              <TabsTrigger value="create">{t("proxyPatTabCreate")}</TabsTrigger>
            </TabsList>

            <TabsContent value="use" className="mt-4 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="pat-paste">{t("proxyPatPasteLabel")}</Label>
                <Input
                  id="pat-paste"
                  value={patPaste}
                  onChange={(e) => {
                    setPatPaste(e.target.value);
                    setPatReferencedId(null);
                  }}
                  placeholder="agx-pat-..."
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">{t("proxyPatPasteHint")}</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">{t("proxyPatExistingSection")}</p>
                <p className="text-xs text-muted-foreground">{t("proxyPatExistingHint")}</p>
                {patTokens.filter((row) => row.status === "active").length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tc("states.empty")}</p>
                ) : (
                  <div className="max-h-40 space-y-2 overflow-y-auto">
                    {patTokens
                      .filter((row) => row.status === "active")
                      .map((row) => {
                        const vaultPlain = getPatPlainFromVault(row.id);
                        const referenced = patReferencedId === row.id;
                        return (
                          <div
                            key={row.id}
                            className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
                              referenced ? "border-primary/40 bg-primary/5" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground">{row.name}</span>
                              <code className="mt-0.5 block truncate text-muted-foreground">
                                {row.tokenPrefix}…
                              </code>
                              {!vaultPlain ? (
                                <span className="text-muted-foreground/80">{t("proxyPatVaultMissing")}</span>
                              ) : null}
                            </div>
                            {vaultPlain ? (
                              <Button
                                size="sm"
                                variant={referenced ? "default" : "outline"}
                                className={
                                  referenced
                                    ? "shrink-0"
                                    : "shrink-0 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
                                }
                                onClick={() => referencePatInDialog(vaultPlain, row.id)}
                              >
                                {referenced ? (
                                  <>
                                    <Check className="mr-1 h-3.5 w-3.5" />
                                    {t("proxyPatActionReferenced")}
                                  </>
                                ) : (
                                  t("proxyPatActionUse")
                                )}
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="create" className="mt-4 space-y-6">
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="pat-create-name">{t("proxyPatCreateName")}</Label>
                  <Input
                    id="pat-create-name"
                    value={patCreateForm.name}
                    onChange={(e) => setPatCreateForm({ ...patCreateForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pat-create-user">{t("proxyPatCreateUserId")}</Label>
                  <Input
                    id="pat-create-user"
                    value={patCreateForm.userId}
                    onChange={(e) => setPatCreateForm({ ...patCreateForm, userId: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pat-create-expire">{t("proxyPatCreateExpireDays")}</Label>
                  <Input
                    id="pat-create-expire"
                    value={patCreateForm.expireDays}
                    onChange={(e) => setPatCreateForm({ ...patCreateForm, expireDays: e.target.value })}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={patCreating}
                  onClick={() => void createPatInDialog()}
                >
                  {tc("actions.create")}
                </Button>
              </div>

              {patNewPlain ? (
                <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {t("proxyPatNewPlainTitle")}
                  </p>
                  <code className="block break-all font-mono text-xs">{patNewPlain}</code>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPatDialogOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={confirmPatDialog}>{tc("actions.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="size-4" /> {t("openapiTitle")}
          </CardTitle>
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
