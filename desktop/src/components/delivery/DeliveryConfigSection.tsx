import { useCallback, useEffect, useState } from "react";

type DeliveryConfigSectionProps = {
  apiBase: string;
  apiToken: string;
};

export function DeliveryConfigSection({ apiBase, apiToken }: DeliveryConfigSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [worktreeRoot, setWorktreeRoot] = useState("");
  const [figmaToken, setFigmaToken] = useState("");
  const [playwrightBrowsers, setPlaywrightBrowsers] = useState("chromium");

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiToken) h["x-agx-desktop-token"] = apiToken;
    return h;
  };

  const load = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    try {
      const resp = await fetch(`${apiBase}/api/delivery/config`, { headers: headers() });
      const data = (await resp.json()) as {
        enabled?: boolean;
        worktree_root?: string;
        playwright_browsers?: string;
        has_figma_token?: boolean;
      };
      if (resp.ok) {
        setEnabled(Boolean(data.enabled));
        setWorktreeRoot(String(data.worktree_root ?? ""));
        setPlaywrightBrowsers(String(data.playwright_browsers ?? "chromium"));
        if (data.has_figma_token) setFigmaToken("********");
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = {
        enabled,
        worktree_root: worktreeRoot,
        playwright_browsers: playwrightBrowsers,
      };
      if (figmaToken && !figmaToken.startsWith("*")) {
        body.figma_token = figmaToken;
      }
      const resp = await fetch(`${apiBase}/api/delivery/config`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setMessage("已保存。");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">交付 Loop（POC/MVP）</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        客户物料 → 五阶段交付流水线。Worktree 沙箱目录与 Figma/Playwright 参数写入{" "}
        <code className="rounded bg-surface-panel px-1">~/.agenticx/config.yaml</code> 的{" "}
        <code className="rounded bg-surface-panel px-1">delivery:</code> 节。
      </p>
      <div className="mt-3 space-y-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} disabled={loading} onChange={(e) => setEnabled(e.target.checked)} />
          启用交付任务
        </label>
        <div>
          <span className="text-text-subtle">Worktree 根目录</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 font-mono text-[11px]"
            value={worktreeRoot}
            disabled={loading}
            onChange={(e) => setWorktreeRoot(e.target.value)}
          />
        </div>
        <div>
          <span className="text-text-subtle">Figma API Key</span>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 font-mono text-[11px]"
            value={figmaToken}
            disabled={loading}
            placeholder="可选"
            onChange={(e) => setFigmaToken(e.target.value)}
          />
        </div>
        <div>
          <span className="text-text-subtle">Playwright 浏览器</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5"
            value={playwrightBrowsers}
            disabled={loading}
            onChange={(e) => setPlaywrightBrowsers(e.target.value)}
          >
            <option value="chromium">chromium</option>
            <option value="firefox">firefox</option>
            <option value="webkit">webkit</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={saving || loading}
          className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs text-[var(--ui-btn-primary-fg)] disabled:opacity-50"
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存交付配置"}
        </button>
        {message ? <span className="text-[11px] text-text-faint">{message}</span> : null}
      </div>
    </div>
  );
}
