import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  buildRemoteMcpServerPayload,
  getMcpServersMap,
  parseMcpJsonDocument,
  setMcpServersMap,
} from "../../../utils/mcp-remote-config";

type RegistryServer = {
  id: string;
  name: string;
  description?: string;
  streamableUrl: string;
};

type Props = {
  configPath: string;
  existingServerNames: Set<string>;
  onImported: (message: string) => void | Promise<void>;
};

function parseRegistryServers(payload: unknown): RegistryServer[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== "object") return [];
  const servers = (data as Record<string, unknown>).servers;
  if (!Array.isArray(servers)) return [];
  const out: RegistryServer[] = [];
  for (const item of servers) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? row.name ?? "").trim();
    const name = String(row.name ?? row.id ?? "").trim();
    const endpoints = row.endpoints;
    let streamableUrl = "";
    if (endpoints && typeof endpoints === "object" && !Array.isArray(endpoints)) {
      const ep = endpoints as Record<string, unknown>;
      streamableUrl = String(
        ep["streamable-http"] ?? ep.streamable_http ?? ep["streamable_http"] ?? "",
      ).trim();
    }
    if (!id || !streamableUrl) continue;
    out.push({
      id,
      name: name || id,
      description: typeof row.description === "string" ? row.description : undefined,
      streamableUrl,
    });
  }
  return out;
}

export function McpGatewayImportPanel({ configPath, existingServerNames, onImported }: Props) {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8080");
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const discover = async () => {
    const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
    const token = pat.trim();
    if (!trimmedBase) {
      setError("请填写 Gateway 地址");
      return;
    }
    if (!token) {
      setError("请填写 PAT（Bearer Token）");
      return;
    }
    setLoading(true);
    setError(null);
    setServers([]);
    setSelected(new Set());
    try {
      const res = await window.agenticxDesktop.mcpGatewayRegistry({
        baseUrl: trimmedBase,
        token,
      });
      if (!res.ok) throw new Error(res.error ?? "拉取注册表失败");
      const parsed = parseRegistryServers(res.data);
      if (parsed.length === 0) {
        setError("注册表为空或响应格式无法识别");
        return;
      }
      setServers(parsed);
      setSelected(new Set(parsed.map((s) => s.id)));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const importSelected = async () => {
    const token = pat.trim();
    if (!token || selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const raw = await window.agenticxDesktop.mcpGetRaw({ path: configPath });
      if (!raw.ok || typeof raw.text !== "string") {
        throw new Error(raw.error ?? "无法读取 mcp.json");
      }
      const doc = parseMcpJsonDocument(raw.text);
      const serversMap = getMcpServersMap(doc);
      const headers = { Authorization: `Bearer ${token}` };
      let added = 0;
      for (const item of servers) {
        if (!selected.has(item.id)) continue;
        const key = item.id.replace(/[^a-zA-Z0-9_-]/g, "_") || item.name;
        if (existingServerNames.has(key) && serversMap[key]) continue;
        serversMap[key] = buildRemoteMcpServerPayload(item.streamableUrl, headers);
        added += 1;
      }
      if (added === 0) {
        setError("所选条目均已存在或未变更");
        return;
      }
      const save = await window.agenticxDesktop.mcpPutRaw({
        path: configPath,
        text: `${JSON.stringify(setMcpServersMap(doc, serversMap), null, 2)}\n`,
      });
      if (!save.ok) throw new Error(save.error ?? "保存失败");
      await onImported(`已从 Gateway 导入 ${added} 个 MCP`);
      setServers([]);
      setSelected(new Set());
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-card p-3">
      <div className="text-sm font-medium text-text-muted">Enterprise Gateway 导入</div>
      <p className="text-[11px] leading-relaxed text-text-faint">
        输入 Gateway 根地址与 PAT，从 <code className="text-[10px]">/mcp/registry</code>{" "}
        拉取托管 MCP 并写入主配置（Streamable HTTP + Authorization）。
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[11px] text-text-muted">
          Gateway 地址
          <input
            className="mt-0.5 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs"
            value={baseUrl}
            placeholder="http://127.0.0.1:8080"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="block text-[11px] text-text-muted">
          PAT
          <input
            className="mt-0.5 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs"
            type="password"
            autoComplete="off"
            value={pat}
            placeholder="agx-pat-…"
            onChange={(e) => setPat(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle hover:bg-surface-hover disabled:opacity-40"
          disabled={loading}
          onClick={() => void discover()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          发现 MCP
        </button>
        {servers.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-[var(--ui-btn-primary-bg)] px-2 py-1 text-xs font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)] disabled:opacity-40"
            disabled={importing || selected.size === 0}
            onClick={() => void importSelected()}
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
            导入选中（{selected.size}）
          </button>
        ) : null}
      </div>
      {servers.length > 0 ? (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-panel p-2">
          {servers.map((item) => {
            const checked = selected.has(item.id);
            return (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    });
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-text-muted">{item.name}</span>
                  {item.description ? (
                    <span className="ml-1 text-text-faint">— {item.description}</span>
                  ) : null}
                  <div className="truncate font-mono text-[10px] text-text-faint" title={item.streamableUrl}>
                    {item.streamableUrl}
                  </div>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      {error ? <div className="text-[11px] text-rose-400">{error}</div> : null}
    </div>
  );
}
