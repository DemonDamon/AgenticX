import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { Panel } from "../ds/Panel";

type WebSearchConfig = {
  enabled: boolean;
  default_provider: string;
  max_results: number;
  fetch_snippet_chars: number;
  providers: Record<string, Record<string, unknown>>;
};

const DEFAULT_CONFIG: WebSearchConfig = {
  enabled: true,
  default_provider: "duckduckgo",
  max_results: 5,
  fetch_snippet_chars: 600,
  providers: {},
};

const PROVIDERS: { id: string; label: string; needsKey: boolean }[] = [
  { id: "duckduckgo", label: "DuckDuckGo（免密钥）", needsKey: false },
  { id: "bocha", label: "Bocha AI", needsKey: true },
  { id: "tavily", label: "Tavily", needsKey: true },
  { id: "serper", label: "Serper (Google)", needsKey: true },
  { id: "google", label: "Google 自定义搜索 (CSE)", needsKey: true },
  { id: "bing", label: "Bing Web Search API", needsKey: true },
];

export function WebSearchSettingsPanel() {
  const apiToken = useAppStore((s) => s.apiToken);
  const apiBase = useAppStore((s) => s.apiBase);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<WebSearchConfig>(DEFAULT_CONFIG);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [cxInput, setCxInput] = useState("");

  const resolveApiBase = useCallback(async () => {
    const u = (apiBase ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [apiBase]);

  const headers = useMemo(
    () => ({ "Content-Type": "application/json", "x-agx-desktop-token": apiToken }),
    [apiToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const base = await resolveApiBase();
      const resp = await fetch(`${base}/api/web-search/config`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { ok?: boolean; config?: WebSearchConfig };
      const cfg = body.config;
      if (cfg) {
        setDraft({
          enabled: cfg.enabled !== false,
          default_provider: cfg.default_provider || "duckduckgo",
          max_results: typeof cfg.max_results === "number" ? cfg.max_results : 5,
          fetch_snippet_chars: typeof cfg.fetch_snippet_chars === "number" ? cfg.fetch_snippet_chars : 600,
          providers: (cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {}) as Record<
            string,
            Record<string, unknown>
          >,
        });
      }
      setApiKeyInput("");
      setCxInput("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [headers, resolveApiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentProviderMeta = PROVIDERS.find((p) => p.id === draft.default_provider);
  const needsKey = currentProviderMeta?.needsKey ?? false;
  const needsCx = draft.default_provider === "google";

  const persist = async () => {
    setSaving(true);
    setMessage("");
    try {
      const base = await resolveApiBase();
      const nextProviders = { ...draft.providers };
      if (needsKey && apiKeyInput.trim()) {
        const cur = { ...(nextProviders[draft.default_provider] || {}) };
        cur.api_key = apiKeyInput.trim();
        nextProviders[draft.default_provider] = cur;
      }
      if (needsCx && cxInput.trim()) {
        const cur = { ...(nextProviders.google || {}) };
        cur.cx = cxInput.trim();
        nextProviders.google = cur;
      }
      const payload = {
        enabled: draft.enabled,
        default_provider: draft.default_provider,
        max_results: draft.max_results,
        fetch_snippet_chars: draft.fetch_snippet_chars,
        providers: nextProviders,
      };
      const resp = await fetch(`${base}/api/web-search/config`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setApiKeyInput("");
      setCxInput("");
      setMessage("已保存。");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setMessage("");
    try {
      const base = await resolveApiBase();
      const resp = await fetch(`${base}/api/web-search/test`, {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: draft.default_provider, query: "AgenticX" }),
      });
      const body = (await resp.json()) as { ok?: boolean; error?: string | null; hits?: unknown[] };
      if (body.ok && body.hits && body.hits.length > 0) {
        setMessage("连通性正常，已返回示例结果。");
      } else {
        setMessage(body.error || "未返回结果，请检查密钥或网络。");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Panel title="联网搜索">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="联网搜索">
      <p className="mb-3 text-xs text-text-faint">
        内置 <code className="text-text-subtle">web_search</code> 工具默认开启（DuckDuckGo 免密钥）。切换为 Bocha / Tavily
        等时需填写 API Key；配置由本机 Studio 写入{" "}
        <code className="text-text-subtle">~/.agenticx/config.yaml</code>。
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-subtle">默认开启联网搜索能力</span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
          className={`relative h-5 w-9 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.55)] ${
            draft.enabled ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
          }`}
        >
          <span
            className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
              draft.enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      <label className="mt-3 block text-sm text-text-muted">
        默认搜索引擎
        <select
          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
          value={draft.default_provider}
          onChange={(e) => setDraft((d) => ({ ...d, default_provider: e.target.value }))}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm text-text-muted">
        单次最大返回结果数（1–20）
        <input
          type="number"
          min={1}
          max={20}
          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
          value={draft.max_results}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              max_results: Math.min(20, Math.max(1, Number(e.target.value) || 5)),
            }))
          }
        />
      </label>
      {needsKey ? (
        <label className="mt-3 block text-sm text-text-muted">
          API Key
          <input
            type="password"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="填写新密钥以更新；留空则保留已保存密钥"
          />
        </label>
      ) : null}
      {needsCx ? (
        <label className="mt-3 block text-sm text-text-muted">
          Search Engine ID (cx)
          <input
            type="text"
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
            value={cxInput}
            onChange={(e) => setCxInput(e.target.value)}
            placeholder="填写新 cx 以更新；留空则保留已保存值"
          />
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void persist()}
          className="rounded-md bg-[rgb(var(--theme-color-rgb,16,185,129))] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          disabled={testing || !draft.enabled}
          onClick={() => void runTest()}
          className="rounded-md border border-border bg-surface-panel px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
        >
          {testing ? "测试中…" : "测试连通"}
        </button>
      </div>
      {message ? <div className="mt-2 text-xs text-text-muted">{message}</div> : null}
    </Panel>
  );
}

export function SuggestedQuestionsSettingsPanel() {
  const apiToken = useAppStore((s) => s.apiToken);
  const apiBase = useAppStore((s) => s.apiBase);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const resolveApiBase = useCallback(async () => {
    const u = (apiBase ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [apiBase]);

  const headers = useMemo(
    () => ({ "Content-Type": "application/json", "x-agx-desktop-token": apiToken }),
    [apiToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = await resolveApiBase();
      const resp = await fetch(`${base}/api/runtime/suggested-questions`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { enabled?: boolean };
      setEnabled(body.enabled !== false);
    } catch {
      setEnabled(true);
    } finally {
      setLoading(false);
    }
  }, [headers, resolveApiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const base = await resolveApiBase();
      const resp = await fetch(`${base}/api/runtime/suggested-questions`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ enabled: next }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setEnabled(next);
      setMessage("已保存。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Panel title="推荐追问">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="推荐追问">
      <p className="mb-3 text-xs text-text-faint">
        关闭后模型不再输出推荐追问块；历史消息已保存的推荐仍可点击。
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-subtle">在助手回复下方显示推荐问题</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={saving}
          onClick={() => void persist(!enabled)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.55)] disabled:opacity-40 ${
            enabled ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
          }`}
        >
          <span
            className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {message ? <div className="mt-2 text-xs text-text-muted">{message}</div> : null}
    </Panel>
  );
}
