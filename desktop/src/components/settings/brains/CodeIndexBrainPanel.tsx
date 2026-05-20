import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAppStore } from "../../../store";
import type { createBrainsApi, BrainRecord } from "./api";

type Props = {
  brain: BrainRecord;
  brainsApi: ReturnType<typeof createBrainsApi>;
  onUpdated: () => void;
};

export function CodeIndexBrainPanel({ brain, brainsApi, onUpdated }: Props) {
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const cfg = (brain.config || {}) as Record<string, unknown>;
  const [codebasePath, setCodebasePath] = useState(String(cfg.codebase_path || ""));
  const [enabled, setEnabled] = useState(Boolean(cfg.enabled ?? true));
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const resolveBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const reloadStatus = useCallback(async () => {
    try {
      const base = await resolveBase();
      const headers: Record<string, string> = {};
      if (apiToken) headers["X-Agx-Desktop-Token"] = apiToken;
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brain.id)}/index`, {
        headers,
      });
      const body = (await res.json()) as { status?: Record<string, unknown> };
      setStatus(body.status ?? {});
    } catch {
      setStatus({});
    }
  }, [apiToken, brain.id, resolveBase]);

  useEffect(() => {
    void reloadStatus();
    const t = window.setInterval(() => void reloadStatus(), 3000);
    return () => window.clearInterval(t);
  }, [reloadStatus]);

  const saveConfig = async () => {
    setBusy(true);
    setMsg("");
    try {
      await brainsApi.patchBrain(brain.id, {
        enabled,
        config: {
          ...cfg,
          codebase_path: codebasePath.trim(),
          enabled,
        },
      });
      setMsg("已保存");
      onUpdated();
    } catch (exc) {
      setMsg(String((exc as Error).message ?? exc));
    } finally {
      setBusy(false);
    }
  };

  const triggerIndex = async () => {
    setBusy(true);
    try {
      const base = await resolveBase();
      const headers: Record<string, string> = {};
      if (apiToken) headers["X-Agx-Desktop-Token"] = apiToken;
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brain.id)}/index`, {
        method: "POST",
        headers,
      });
      const body = await res.json();
      setMsg(JSON.stringify(body));
      await reloadStatus();
    } catch (exc) {
      setMsg(String((exc as Error).message ?? exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs text-text-subtle">
        代码库路径（绝对路径）
        <input
          className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
          value={codebasePath}
          onChange={(e) => setCodebasePath(e.target.value)}
          placeholder="/Users/you/project"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-text-subtle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用此代码脑
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-40"
          onClick={() => void saveConfig()}
        >
          保存配置
        </button>
        <button
          type="button"
          disabled={busy || !codebasePath.trim()}
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-40"
          onClick={() => void triggerIndex()}
        >
          {busy ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : null}
          构建索引
        </button>
      </div>
      <pre className="max-h-40 overflow-auto rounded border border-border bg-surface-panel p-2 text-[10px] text-text-faint">
        {JSON.stringify(status, null, 2)}
      </pre>
      {msg ? <div className="text-xs text-text-muted">{msg}</div> : null}
    </div>
  );
}
