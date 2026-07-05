import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import type { DataSourceInfo } from "./types";

type Props = {
  item: DataSourceInfo;
  onToggle: (name: string, enabled: boolean) => Promise<void>;
  onTest?: (name: string) => Promise<{ ok: boolean; detail?: string }>;
  onOpenMcp?: (serverName: string) => void;
};

function statusDotClass(status: DataSourceInfo["status"], enabled: boolean): string {
  if (!enabled || status === "disabled") return "bg-rose-400";
  if (status === "ready") return "bg-emerald-400";
  return "bg-rose-400";
}

function statusLabel(item: DataSourceInfo): string {
  if (!item.enabled) return "已停用";
  switch (item.status) {
    case "ready":
      return "已启用";
    case "mcp_disconnected":
      return "MCP 未连接";
    case "missing_credential":
      return item.stubOnly ? "需企业授权" : "凭证缺失";
    case "unavailable":
      return "不可用";
    default:
      return "已停用";
  }
}

export function DataSourceCard({ item, onToggle, onTest, onOpenMcp }: Props) {
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleToggle = async () => {
    setBusy(true);
    try {
      await onToggle(item.name, !item.enabled);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (!onTest) return;
    setTesting(true);
    try {
      await onTest(item.name);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface-panel/60 px-3 py-3">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(item.status, item.enabled)}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-strong">{item.displayName}</span>
            <span className="text-[10px] text-text-faint">{item.domain}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-text-subtle">{statusLabel(item)}</p>

          {item.stubOnly ? (
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              需企业 iFinD 账号与 SDK 授权，当前仅展示 API 目录，暂不可配置凭证。
            </p>
          ) : null}

          {item.mcpServer ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span>
                依赖 MCP: {item.mcpServer}
                {item.mcpConnected ? "（已连接）" : "（未连接）"}
              </span>
              {onOpenMcp ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[var(--settings-accent-fg)] hover:underline"
                  onClick={() => onOpenMcp(item.mcpServer!)}
                >
                  去 MCP 设置连接
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}

          {item.apis && item.apis.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-text-subtle hover:text-text-primary">
                API 目录（{item.apis.length}）
              </summary>
              <ul className="mt-1 space-y-0.5 pl-2 text-[10px] text-text-faint">
                {item.apis.map((api) => (
                  <li key={api.name}>
                    <span className="font-mono text-text-muted">{api.name}</span>
                    <span className="text-text-faint"> — {api.description}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {!item.stubOnly ? (
            <button
              type="button"
              disabled={busy}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                item.enabled
                  ? "border border-border bg-surface-hover text-text-primary"
                  : "bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-fg)]"
              }`}
              onClick={() => void handleToggle()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : item.enabled ? "停用" : "启用"}
            </button>
          ) : null}
          {onTest && item.enabled && !item.stubOnly && !item.requiresCredential ? (
            <button
              type="button"
              disabled={testing}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-subtle hover:bg-surface-hover"
              onClick={() => void handleTest()}
            >
              {testing ? "测试中…" : "测试连通性"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
