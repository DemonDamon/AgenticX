import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Modal } from "../../ds/Modal";
import {
  buildRemoteMcpServerPayload,
  extractRemoteMcpServerConfig,
  getMcpServersMap,
  parseMcpJsonDocument,
  setMcpServersMap,
} from "../../../utils/mcp-remote-config";

type HeaderRow = { id: string; key: string; value: string };

type Props = {
  open: boolean;
  mode: "add" | "edit";
  configPath: string;
  serverName?: string;
  locateServerPath?: (name: string) => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
};

function newHeaderRow(key = "", value = ""): HeaderRow {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, key, value };
}

function rowsFromHeaders(headers: Record<string, string>): HeaderRow[] {
  const entries = Object.entries(headers);
  if (entries.length === 0) return [newHeaderRow()];
  return entries.map(([key, value]) => newHeaderRow(key, value));
}

function headersFromRows(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const k = row.key.trim();
    if (!k) continue;
    out[k] = row.value;
  }
  return out;
}

export function McpRemoteServerModal({
  open,
  mode,
  configPath,
  serverName,
  locateServerPath,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [timeout, setTimeout] = useState("60");
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([newHeaderRow()]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setUrl("");
    setTimeout("60");
    setHeaderRows([newHeaderRow()]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (mode === "add") {
      resetForm();
      return;
    }
    const targetName = String(serverName ?? "").trim();
    if (!targetName) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const path = locateServerPath ? await locateServerPath(targetName) : configPath;
        const raw = await window.agenticxDesktop.mcpGetRaw({ path });
        if (!raw.ok || typeof raw.text !== "string") {
          throw new Error(raw.error ?? "无法读取配置文件");
        }
        const doc = parseMcpJsonDocument(raw.text);
        const servers = getMcpServersMap(doc);
        const entry = extractRemoteMcpServerConfig(servers[targetName]);
        if (!entry) {
          throw new Error(`「${targetName}」不是远程 URL 型 MCP，请用 JSON 编辑器修改 stdio 配置`);
        }
        if (cancelled) return;
        setName(targetName);
        setUrl(entry.url);
        setTimeout(entry.timeout !== undefined ? String(entry.timeout) : "60");
        setHeaderRows(rowsFromHeaders(entry.headers));
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode, serverName, configPath, locateServerPath, resetForm]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setError("请填写服务名称");
      return;
    }
    if (!trimmedUrl) {
      setError("请填写 MCP URL");
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(trimmedUrl);
    } catch {
      setError("URL 格式无效");
      return;
    }

    const timeoutNum = timeout.trim() ? Number(timeout.trim()) : undefined;
    if (timeout.trim() && (!Number.isFinite(timeoutNum) || (timeoutNum ?? 0) <= 0)) {
      setError("超时须为正数（秒）");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const path =
        mode === "edit" && locateServerPath && serverName
          ? await locateServerPath(serverName)
          : configPath;
      const raw = await window.agenticxDesktop.mcpGetRaw({ path });
      if (!raw.ok || typeof raw.text !== "string") {
        throw new Error(raw.error ?? "无法读取配置文件");
      }
      const doc = parseMcpJsonDocument(raw.text);
      const servers = getMcpServersMap(doc);

      if (mode === "edit" && serverName && serverName !== trimmedName) {
        delete servers[serverName];
      }
      if (mode === "add" && Object.prototype.hasOwnProperty.call(servers, trimmedName)) {
        throw new Error(`服务名「${trimmedName}」已存在`);
      }

      servers[trimmedName] = buildRemoteMcpServerPayload(
        trimmedUrl,
        headersFromRows(headerRows),
        timeoutNum,
      );
      const nextDoc = setMcpServersMap(doc, servers);
      const save = await window.agenticxDesktop.mcpPutRaw({
        path,
        text: `${JSON.stringify(nextDoc, null, 2)}\n`,
      });
      if (!save.ok) throw new Error(save.error ?? "保存失败");
      await onSaved(mode === "add" ? `已添加远程 MCP：${trimmedName}` : `已更新 ${trimmedName}`);
      onClose();
      resetForm();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === "add" ? "添加远程 MCP（URL）" : `编辑远程 MCP — ${serverName ?? ""}`}
      onClose={() => {
        if (saving) return;
        onClose();
      }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
            disabled={saving}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-hover)] disabled:opacity-40"
            disabled={saving || loading}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            保存
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          加载配置…
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm text-text-muted">
            服务名称
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={name}
              disabled={mode === "edit"}
              placeholder="例如 tushareMcp"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm text-text-muted">
            MCP URL
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm font-mono text-[12px]"
              value={url}
              placeholder="https://api.example.com/mcp 或 …/streamable-http"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-muted">HTTP Headers</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-subtle hover:bg-surface-hover"
                onClick={() => setHeaderRows((prev) => [...prev, newHeaderRow()])}
              >
                <Plus className="h-3 w-3" aria-hidden />
                添加
              </button>
            </div>
            <div className="space-y-1.5">
              {headerRows.map((row) => (
                <div key={row.id} className="flex gap-1.5">
                  <input
                    className="w-[38%] rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs"
                    placeholder="Authorization"
                    value={row.key}
                    onChange={(e) =>
                      setHeaderRows((prev) =>
                        prev.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)),
                      )
                    }
                  />
                  <input
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs"
                    placeholder="Bearer …（仅保存在 mcp.json）"
                    type="password"
                    autoComplete="off"
                    value={row.value}
                    onChange={(e) =>
                      setHeaderRows((prev) =>
                        prev.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border p-1.5 text-text-faint hover:text-rose-400 disabled:opacity-30"
                    disabled={headerRows.length <= 1}
                    title="移除此 Header"
                    onClick={() => setHeaderRows((prev) => prev.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-text-faint">
              Header 值写入 <code className="text-[10px]">~/.agenticx/mcp.json</code>，不会存入 localStorage。
            </p>
          </div>
          <label className="block text-sm text-text-muted">
            超时（秒，可选）
            <input
              className="mt-1 w-28 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={timeout}
              inputMode="numeric"
              onChange={(e) => setTimeout(e.target.value)}
            />
          </label>
          {error ? <div className="text-[11px] text-rose-400">{error}</div> : null}
        </div>
      )}
    </Modal>
  );
}
