import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  SquarePlus,
  Star,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../ds/Modal";

const CATALOG_PREVIEW_LIMIT = 6;

type MarketplaceItem = {
  id: string;
  name?: string;
  chinese_name?: string;
  description?: string;
  categories?: string[];
  is_verified?: boolean;
  is_hosted?: boolean;
  tags?: string[];
  publisher?: string;
  owner?: string;
  view_count?: number;
  github_stars?: number;
  hosted_service_call_count?: number;
  call_count?: number;
  invocation_count?: number;
  invoke_count?: number;
  source_url?: string;
};

type StatusKind = "info" | "success" | "error";

type Props = {
  loading: boolean;
  items: MarketplaceItem[];
  summary?: string;
  search: string;
  onSearchChange: (next: string) => void;
  onRefresh: () => Promise<void>;
  onInstall: (serverId: string, env: Record<string, string>) => Promise<void>;
  resolving?: boolean;
  envSchema?: { required: string[] };
  installedIds?: Set<string>;
  installingId?: string | null;
  statusMessage?: string;
  statusKind?: StatusKind;
  statusTargetId?: string | null;
};

export function MCPMarketplacePanel({
  loading,
  items,
  summary,
  search,
  onSearchChange,
  onRefresh,
  onInstall,
  resolving = false,
  envSchema,
  installedIds,
  installingId,
  statusMessage,
  statusKind = "info",
  statusTargetId,
}: Props) {
  const [installTarget, setInstallTarget] = useState<MarketplaceItem | null>(null);
  const [envForm, setEnvForm] = useState<Record<string, string>>({});
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const required = useMemo(() => envSchema?.required ?? [], [envSchema]);
  const visibleItems = search.trim() || catalogExpanded
    ? items
    : items.slice(0, CATALOG_PREVIEW_LIMIT);

  const statusClassName = useMemo(() => {
    switch (statusKind) {
      case "success":
        return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
      case "error":
        return "border-rose-500/40 bg-rose-500/10 text-rose-400";
      default:
        return "border-[var(--settings-accent-badge-bg)] bg-[var(--settings-accent-row-bg)] text-[var(--settings-accent-fg)]";
    }
  }, [statusKind]);

  const formatCount = (value: number): string => {
    if (!Number.isFinite(value)) return "0";
    if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
    if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
  };

  const getDeveloper = (item: MarketplaceItem): string => {
    const raw = [item.owner, item.publisher, item.id].find((x) => typeof x === "string" && x.trim());
    if (!raw) return "未知";
    const source = raw.trim();
    const first = source.includes("/") ? source.split("/")[0] : source;
    return first.replace(/^@/, "");
  };

  const getLicense = (tags: string[] | undefined): string | null => {
    if (!Array.isArray(tags) || tags.length === 0) return null;
    const normalized = tags
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    const explicit = normalized.find((x) => /license/i.test(x));
    if (explicit) return explicit;
    const spdx = normalized.find((x) => /MIT|Apache|BSD|GPL|LGPL|MPL|CC/i.test(x));
    return spdx || null;
  };

  const cleanDescription = (input: unknown): string => {
    const raw = String(input ?? "");
    return raw
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  return (
    <section
      className="rounded-xl border border-border bg-surface-panel p-3.5"
      aria-label="MCP 服务目录"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-text-strong">MCP 服务目录</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
            添加前会确认必要配置。
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          disabled={loading}
          aria-label="刷新 MCP 服务目录"
          onClick={() => void onRefresh()}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
          刷新
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
          <input
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setCatalogExpanded(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) void onRefresh();
            }}
            className="h-9 w-full rounded-lg border border-border bg-surface-base pl-8 pr-3 text-xs text-text-primary outline-none transition placeholder:text-text-faint focus:border-[var(--settings-accent-border-strong)]"
            placeholder="搜索名称、用途或发布者"
            aria-label="搜索 MCP 服务"
          />
        </div>
        <button
          type="button"
          className="h-9 shrink-0 rounded-lg border border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)] px-3 text-xs font-medium text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg-hover)] disabled:opacity-50"
          disabled={loading}
          aria-label="搜索 MCP 市场"
          onClick={() => void onRefresh()}
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
      </div>
      {summary ? <div className="mt-2 text-[11px] text-text-faint">{summary}</div> : null}

      {statusMessage && !(statusKind === "error" && statusTargetId) ? (
        <div
          className={`mt-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${statusClassName}`}
          role="status"
          aria-live="polite"
        >
          {statusKind === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : statusKind === "error" ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          )}
          <span className="min-w-0 break-words">{statusMessage}</span>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="status">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-[148px] animate-pulse rounded-xl border border-border bg-surface-card" />
          ))}
        </div>
      ) : visibleItems.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-surface-card px-3 py-2.5">
            {(() => {
              const title = item.chinese_name || item.name || item.id;
              const categories = Array.isArray(item.categories) ? item.categories.filter(Boolean) : [];
              const license = getLicense(item.tags);
              const developer = getDeveloper(item);
              const hostedLabel = item.is_hosted ? "Hosted" : "Local";
              return (
                <>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-text-muted">{title}</span>
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${
                        item.is_hosted
                          ? "border-[var(--settings-accent-badge-bg)] bg-[var(--settings-accent-row-bg)] text-[var(--settings-accent-fg)]"
                          : "border-border bg-surface-panel text-text-faint"
                      }`}
                    >
                      {hostedLabel}
                    </span>
                    {item.is_verified ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : null}
                  </div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-faint">
                    {categories.slice(0, 2).map((cat) => (
                      <span key={cat} className="rounded border border-border px-1 py-0.5">{cat}</span>
                    ))}
                    {license ? <span className="rounded border border-border px-1 py-0.5">{license}</span> : null}
                    <span className="rounded border border-border px-1 py-0.5">开发者: {developer}</span>
                  </div>
                </>
              );
            })()}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="line-clamp-2 text-[11px] text-text-faint">{cleanDescription(item.description) || "无描述"}</div>
                {(() => {
                  const callCount = Number(
                    item.hosted_service_call_count ?? item.call_count ?? item.invocation_count ?? item.invoke_count ?? 0,
                  );
                  const viewCount = Number(item.view_count ?? 0);
                  const githubStars = Number(item.github_stars ?? 0);
                  const metrics = [
                    callCount > 0
                      ? { key: "calls", icon: <Activity className="h-3.5 w-3.5" aria-hidden />, value: formatCount(callCount) }
                      : null,
                    viewCount > 0
                      ? { key: "views", icon: <Eye className="h-3.5 w-3.5" aria-hidden />, value: formatCount(viewCount) }
                      : null,
                    githubStars > 0
                      ? { key: "stars", icon: <Star className="h-3.5 w-3.5" aria-hidden />, value: formatCount(githubStars) }
                      : null,
                  ].filter((x): x is { key: string; icon: JSX.Element; value: string } => Boolean(x));
                  if (metrics.length === 0) return null;
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-faint">
                      {metrics.map((metric) => (
                        <span key={metric.key} className="inline-flex items-center gap-1">
                          {metric.icon}
                          {metric.value}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {installedIds?.has(item.id) ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已添加
                </span>
              ) : installingId === item.id ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--settings-accent-badge-bg)] bg-[var(--settings-accent-row-bg)] px-2 py-1 text-xs font-medium text-[var(--settings-accent-fg)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  安装中...
                </span>
              ) : (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--settings-accent-solid)] px-2 py-1 text-xs text-[var(--settings-accent-solid-text)] disabled:opacity-40"
                  disabled={Boolean(installingId)}
                  onClick={() => {
                    setInstallTarget(item);
                    setEnvForm({});
                  }}
                >
                  <SquarePlus className="h-3.5 w-3.5" />
                  添加
                </button>
              )}
            </div>
            {statusKind === "error" && statusTargetId === item.id && statusMessage ? (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">{statusMessage}</span>
              </div>
            ) : null}
          </div>
        ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-text-muted">
          暂无可展示的服务，可刷新目录或主动搜索。
        </div>
      )}

      {!search.trim() && items.length > CATALOG_PREVIEW_LIMIT ? (
        <button
          type="button"
          className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
          onClick={() => setCatalogExpanded((expanded) => !expanded)}
        >
          {catalogExpanded ? "收起目录" : `查看全部 ${items.length} 个服务`}
        </button>
      ) : null}

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
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] disabled:opacity-40"
              disabled={!installTarget || resolving}
              onClick={() => {
                if (!installTarget) return;
                void onInstall(installTarget.id, envForm).then(() => setInstallTarget(null));
              }}
            >
              {resolving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  安装中...
                </>
              ) : (
                "确认安装"
              )}
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
    </section>
  );
}
