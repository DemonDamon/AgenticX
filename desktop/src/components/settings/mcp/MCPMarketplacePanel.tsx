import { Loader2, Search, ShieldCheck, SquarePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../ds/Modal";

type MarketplaceItem = {
  id: string;
  name?: string;
  chinese_name?: string;
  description?: string;
  categories?: string[];
  is_verified?: boolean;
  is_hosted?: boolean;
};

type Props = {
  loading: boolean;
  items: MarketplaceItem[];
  search: string;
  onSearchChange: (next: string) => void;
  onRefresh: () => Promise<void>;
  onInstall: (serverId: string, env: Record<string, string>) => Promise<void>;
  resolving?: boolean;
  envSchema?: { required: string[] };
};

export function MCPMarketplacePanel({
  loading,
  items,
  search,
  onSearchChange,
  onRefresh,
  onInstall,
  resolving = false,
  envSchema,
}: Props) {
  const [installTarget, setInstallTarget] = useState<MarketplaceItem | null>(null);
  const [envForm, setEnvForm] = useState<Record<string, string>>({});
  const required = useMemo(() => envSchema?.required ?? [], [envSchema]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-text-faint" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onRefresh();
            }}
            className="w-full rounded-md border border-border bg-surface-panel py-1.5 pl-7 pr-2 text-sm"
            placeholder="搜索 MCP 服务"
          />
        </div>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover"
          disabled={loading}
          onClick={() => void onRefresh()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "刷新"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-border bg-surface-card px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-muted">{item.chinese_name || item.name || item.id}</div>
                <div className="line-clamp-2 text-[11px] text-text-faint">{item.description || "无描述"}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-text-faint">
                  <span className="rounded border border-border px-1 py-0.5">{(item.categories || []).join(", ") || "other"}</span>
                  {item.is_verified ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> : null}
                </div>
              </div>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--settings-accent-solid)] px-2 py-1 text-xs text-[var(--settings-accent-solid-text)]"
                onClick={() => {
                  setInstallTarget(item);
                  setEnvForm({});
                }}
              >
                <SquarePlus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={!!installTarget}
        title={installTarget ? `安装 ${installTarget.chinese_name || installTarget.name || installTarget.id}` : ""}
        onClose={() => setInstallTarget(null)}
        footer={(
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover"
              onClick={() => setInstallTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] disabled:opacity-40"
              disabled={!installTarget || resolving}
              onClick={() => {
                if (!installTarget) return;
                void onInstall(installTarget.id, envForm).then(() => setInstallTarget(null));
              }}
            >
              {resolving ? "安装中..." : "确认安装"}
            </button>
          </div>
        )}
      >
        <div className="space-y-2">
          {required.length === 0 ? (
            <div className="text-xs text-text-faint">该服务不需要额外环境变量。</div>
          ) : (
            required.map((key) => (
              <label key={key} className="block text-xs text-text-muted">
                {key}
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                  value={envForm[key] || ""}
                  onChange={(e) => setEnvForm((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </label>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
