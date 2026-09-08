import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

function statusLabel(item: DataSourceInfo, t: (key: string) => string): string {
  if (!item.enabled) return t("dataSources.disabled");
  switch (item.status) {
    case "ready":
      return t("dataSources.enabled");
    case "mcp_disconnected":
      return t("dataSources.mcpOff");
    case "missing_credential":
      return item.stubOnly ? t("dataSources.needEnterprise") : t("dataSources.missingCreds");
    case "unavailable":
      return t("dataSources.unavailable");
    default:
      return t("dataSources.disabled");
  }
}

export function DataSourceCard({ item, onToggle, onTest, onOpenMcp }: Props) {
  const { t } = useTranslation("settings");
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
          <p className="mt-0.5 text-[11px] text-text-subtle">{statusLabel(item, t)}</p>

          {item.stubOnly ? (
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              {t("dataSources.ifindHint")}
            </p>
          ) : null}

          {item.mcpServer ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span>
                {t("dataSources.dependsMcp", { server: item.mcpServer })}
                {item.mcpConnected ? t("dataSources.mcpOn") : t("dataSources.mcpOffParen")}
              </span>
              {onOpenMcp ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[var(--settings-accent-fg)] hover:underline"
                  onClick={() => onOpenMcp(item.mcpServer!)}
                >
                  {t("dataSources.goMcp")}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}

          {item.apis && item.apis.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-text-subtle hover:text-text-primary">
                {t("dataSources.apiCatalog", { count: item.apis.length })}
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
                  : "bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)]"
              }`}
              onClick={() => void handleToggle()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : item.enabled ? t("dataSources.disable") : t("dataSources.enable")}
            </button>
          ) : null}
          {onTest && item.enabled && !item.stubOnly && !item.requiresCredential ? (
            <button
              type="button"
              disabled={testing}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-subtle hover:bg-surface-hover"
              onClick={() => void handleTest()}
            >
              {testing ? t("dataSources.testing") : t("dataSources.testConn")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
