import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { useAppStore } from "../../../store";
import type { createBrainsApi, BrainRecord } from "./api";

type Props = {
  brain: BrainRecord;
  brainsApi: ReturnType<typeof createBrainsApi>;
  onUpdated: () => void;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
};

export function CodeIndexBrainPanel({
  brain,
  brainsApi,
  onUpdated,
  enabled: enabledProp,
  onEnabledChange,
}: Props) {
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const cfg = (brain.config || {}) as Record<string, unknown>;
  const [codebasePath, setCodebasePath] = useState(String(cfg.codebase_path || ""));
  const [internalEnabled, setInternalEnabled] = useState(Boolean(cfg.enabled ?? true));
  const enabledControlled = enabledProp !== undefined && onEnabledChange !== undefined;
  const enabled = enabledControlled ? enabledProp : internalEnabled;
  const setEnabled = enabledControlled ? onEnabledChange : setInternalEnabled;
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pathHint, setPathHint] = useState("");

  const chooseCodebaseDirectory = useCallback(async () => {
    setPathHint("");
    try {
      const picker = window.agenticxDesktop.chooseDirectory;
      if (typeof picker !== "function") {
        setPathHint("当前客户端不支持目录选择，请重启桌面端后重试。");
        return;
      }
      const picked = await picker();
      if (picked?.ok && picked.path) {
        setCodebasePath(picked.path);
        return;
      }
      if (picked?.canceled) return;
      setPathHint(picked?.error ? String(picked.error) : "未选择目录");
    } catch (exc) {
      setPathHint(exc instanceof Error ? exc.message : "选择目录失败");
    }
  }, []);

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
    const next = (brain.config || {}) as Record<string, unknown>;
    setCodebasePath(String(next.codebase_path || ""));
    if (!enabledControlled) {
      setInternalEnabled(Boolean(next.enabled ?? true));
    }
  }, [brain.id, brain.config, enabledControlled]);

  useEffect(() => {
    void reloadStatus();
    const t = window.setInterval(() => void reloadStatus(), 3000);
    return () => window.clearInterval(t);
  }, [reloadStatus]);

  const persistConfig = async () => {
    const trimmed = codebasePath.trim();
    if (!trimmed) {
      throw new Error("请先填写代码库路径");
    }
    await brainsApi.patchBrain(brain.id, {
      enabled,
      config: {
        ...cfg,
        codebase_path: trimmed,
        enabled,
      },
    });
    onUpdated();
  };

  const saveConfig = async () => {
    setBusy(true);
    setMsg("");
    try {
      await persistConfig();
      setMsg("已保存");
    } catch (exc) {
      setMsg(String((exc as Error).message ?? exc));
    } finally {
      setBusy(false);
    }
  };

  const triggerIndex = async () => {
    setBusy(true);
    setMsg("");
    try {
      await persistConfig();
      const base = await resolveBase();
      const headers: Record<string, string> = {};
      if (apiToken) headers["X-Agx-Desktop-Token"] = apiToken;
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brain.id)}/index`, {
        method: "POST",
        headers,
      });
      const body = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
      if (!res.ok) {
        setMsg(body.detail || body.error || `构建索引失败（HTTP ${res.status}）`);
        return;
      }
      setMsg("索引任务已提交");
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
        <div className="mt-1 flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
            value={codebasePath}
            onChange={(e) => {
              setCodebasePath(e.target.value);
              if (pathHint) setPathHint("");
            }}
            placeholder="/Users/you/project"
          />
          <button
            type="button"
            title="在系统中浏览并选择文件夹"
            className="shrink-0 rounded border border-border bg-surface-panel px-2.5 py-1.5 text-text-muted transition hover:border-text-faint hover:bg-surface-hover hover:text-text-primary"
            onClick={() => void chooseCodebaseDirectory()}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>
      </label>
      {pathHint ? <p className="text-xs text-rose-400">{pathHint}</p> : null}
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
