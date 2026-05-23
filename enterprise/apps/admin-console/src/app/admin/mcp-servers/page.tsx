"use client";

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
      const res = await fetch("/api/admin/mcp-servers");
      const json = (await res.json()) as { data?: { servers?: McpServer[] } };
      setServers(json.data?.servers ?? []);
    } catch {
      toast.error("加载 MCP Server 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createServer() {
    if (!name.trim()) {
      toast.error("请填写 name");
      return;
    }
    try {
      const res = await fetch("/api/admin/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), backendType, displayName: name.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("已创建 MCP Server");
      setName("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
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
      toast.error("加载健康面板失败");
    }
  }

  async function importOpenAPI() {
    if (!selectedId || !openApiSpec.trim()) {
      toast.error("请选择 Server 并粘贴 OpenAPI JSON");
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
      toast.success("OpenAPI 工具已导入");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    }
  }

  async function removeServer(id: string) {
    if (!confirm("确认删除该 MCP Server？")) return;
    try {
      const res = await fetch(`/api/admin/mcp-servers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("已删除");
      if (selectedId === id) {
        setSelectedId(null);
        setHealth(null);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="MCP Server 托管"
        description="将 OpenAPI 等后端暴露为符合 MCP 协议的远程工具池，供 Machi / Cursor 等客户端通过网关 PAT 调用。"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" /> 新建 MCP Server
          </CardTitle>
          <CardDescription>内置 demo echo：`/mcp/demo/streamable-http`（需 PAT scope `mcp:*`）</CardDescription>
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
          <Button onClick={() => void createServer()}>创建</Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-1 size-4" /> 刷新
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" /> Server 列表
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
          {!loading && servers.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无自定义 Server（内置 demo 不在此列表）</p>
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
                  健康面板
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void removeServer(s.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          {health && selectedId && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              最近 1h：调用 {health.callCount} 次 · 失败率 {(health.failRate * 100).toFixed(1)}% · p50{" "}
              {health.p50LatencyMs} ms
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenAPI 导入</CardTitle>
          <CardDescription>粘贴 OpenAPI 3.x JSON，并用逗号分隔允许的 operationId 白名单</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>目标 Server（先点列表「健康面板」选中）</Label>
            <Input value={selectedId ?? ""} readOnly placeholder="未选择" />
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
            导入工具
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
