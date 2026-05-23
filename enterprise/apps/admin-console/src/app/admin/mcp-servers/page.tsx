"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

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

export default function AdminMcpServersPage() {
  const t = useTranslations("pages.admin.mcpServers");
  const tc = useTranslations("common");
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [name, setName] = useState("");
  const [backendType, setBackendType] = useState("openapi");
  const [openApiSpec, setOpenApiSpec] = useState("");
  const [allowedOps, setAllowedOps] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://petstore3.swagger.io/api/v3");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/mcp-servers");
      const json = (await res.json()) as { data?: { servers?: McpServer[] } };
      setServers(json.data?.servers ?? []);
    } catch {
      toast.error(t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
