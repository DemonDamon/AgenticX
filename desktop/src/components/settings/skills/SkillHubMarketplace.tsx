import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import { SkillPuzzleIcon } from "../../icons/SkillPuzzleIcon";
import {
  filterSkillHubCatalog,
  loadSkillHubCatalog as loadSkillHubCatalogSnapshot,
  normalizeSkillHubFullSearchResults,
  SKILLHUB_CATALOG_CATEGORIES,
  skillHubCatalogItemKey,
  type SkillHubCatalogCategoryId,
  type SkillHubCatalogItem,
} from "../../../utils/skillhub-catalog";
import type { SkillHubMarketItem } from "../../../utils/skillhub-market";

export type SkillHubInstallState =
  | "idle"
  | "installed"
  | "installing"
  | "queued"
  | "pending";

type Props = {
  installStatusMessage?: string;
  installStatusTone?: "neutral" | "success" | "warning";
  getInstallState: (item: SkillHubMarketItem) => SkillHubInstallState;
  getInstallMessage?: (item: SkillHubMarketItem) => string;
  onInstall: (item: SkillHubMarketItem) => void;
};

const CATALOG_PREVIEW_LIMIT = 12;

function formatDownloads(value: SkillHubMarketItem["downloads"]): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value);
  }
  return String(value);
}

export function getSkillHubDetailUrl(item: SkillHubMarketItem): string | null {
  const isNative =
    item.origin_source === "skillhub_api" ||
    (!item.origin_source && item.source_type === "skillhub");
  return isNative
    ? `https://skillhub.cn/skills/${encodeURIComponent(item.slug)}`
    : null;
}

export function SkillMarketCard({
  item,
  installState,
  installMessage,
  onInstall,
}: {
  item: SkillHubMarketItem;
  installState: SkillHubInstallState;
  installMessage?: string;
  onInstall: () => void;
}) {
  const author = item.author && item.author !== "unknown" ? item.author : "";
  const downloads = formatDownloads(item.downloads);
  const iconUrl = /^https:\/\//iu.test(item.icon_url || "") ? item.icon_url : "";
  const detailUrl = getSkillHubDetailUrl(item);
  const isBusy = installState === "installing" || installState === "queued";
  const isDisabled = installState !== "idle";
  const installLabel =
    installState === "installed"
      ? "已安装"
      : installState === "installing"
        ? "安装中"
        : installState === "queued"
          ? "排队中"
          : installState === "pending"
            ? "待确认"
            : "安装";

  return (
    <article className="group flex min-h-[148px] min-w-0 flex-col rounded-xl border border-border bg-surface-card p-3 transition-colors hover:border-border-strong hover:bg-surface-hover">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--settings-accent-border-muted)] bg-[var(--settings-accent-subtle-bg)] text-[var(--settings-accent-fg)]">
          <SkillPuzzleIcon className="h-[18px] w-[18px]" strokeWidth={2.1} />
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              className="absolute inset-0 h-full w-full bg-surface-card object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="line-clamp-2 text-[13px] font-semibold leading-5 text-text-strong">
              {item.name || item.slug}
            </h4>
            <button
              type="button"
              className="flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--settings-accent-border-muted)] px-2 text-[11px] font-medium text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg)] disabled:cursor-default disabled:border-border disabled:text-text-faint disabled:opacity-80"
              disabled={isDisabled}
              aria-label={`${installLabel} ${item.name || item.slug}`}
              onClick={onInstall}
            >
              {installState === "installed" ? (
                <Check className="h-3.5 w-3.5" />
              ) : isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : installState === "pending" ? (
                <Clock3 className="h-3.5 w-3.5" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>{installLabel}</span>
            </button>
          </div>
          {author || downloads ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-text-faint">
              {author ? <span className="truncate">{author}</span> : null}
              {downloads ? <span>下载 {downloads}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-2 line-clamp-3 flex-1 text-[11px] leading-[17px] text-text-muted">
        {item.description || "该技能暂未提供说明，可打开详情查看发布信息。"}
      </p>

      {item.origin_hint ? (
        <p className="mt-1 text-[10px] leading-4 text-text-faint">{item.origin_hint}</p>
      ) : null}
      {installMessage ? (
        <p className="mt-1 text-[10px] leading-4 text-text-muted" aria-live="polite">
          {installMessage}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="min-w-0 truncate text-[10px] text-text-faint">
          {item.canonical_name || item.slug}
        </span>
        {detailUrl ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-[10px] text-text-subtle transition hover:text-text-primary"
            aria-label={`查看 ${item.name || item.slug} 详情`}
            onClick={() => window.open(detailUrl, "_blank", "noopener,noreferrer")}
          >
            详情
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function SkillHubMarketplace({
  installStatusMessage = "",
  installStatusTone = "neutral",
  getInstallState,
  getInstallMessage,
  onInstall,
}: Props) {
  const [catalogItems, setCatalogItems] = useState<SkillHubCatalogItem[]>([]);
  const [catalogCategory, setCatalogCategory] =
    useState<SkillHubCatalogCategoryId>("all");
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SkillHubMarketItem[]>([]);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchHint, setSearchHint] = useState("");
  const catalogRequestSeqRef = useRef(0);
  const searchRequestSeqRef = useRef(0);

  const loadCatalog = useCallback(async (force = false) => {
    const requestSeq = ++catalogRequestSeqRef.current;
    setCatalogLoading(true);
    setCatalogMessage("");

    try {
      const snapshot = await loadSkillHubCatalogSnapshot(
        (query) => window.agenticxDesktop.searchSkillHub({ q: query }),
        { force },
      );
      if (requestSeq !== catalogRequestSeqRef.current) return;
      const nextItems = snapshot.items;
      setCatalogItems(nextItems);
      if (nextItems.length === 0) {
        setCatalogMessage(
          snapshot.failedRequests > 0
            ? "技能目录暂时不可用，可刷新重试或直接搜索。"
            : "暂未发现适合当前分类的技能，可直接搜索更多内容。",
        );
      } else if (snapshot.hints.length > 0) {
        setCatalogMessage(snapshot.hints.join(" "));
      } else if (snapshot.failedRequests > 0) {
        setCatalogMessage("部分分类暂时不可用，已展示其余可安装技能。");
      }
    } catch {
      if (requestSeq === catalogRequestSeqRef.current) {
        setCatalogMessage("技能目录暂时不可用，可刷新重试或直接搜索。");
      }
    } finally {
      if (requestSeq === catalogRequestSeqRef.current) setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    return () => {
      catalogRequestSeqRef.current += 1;
      searchRequestSeqRef.current += 1;
    };
  }, [loadCatalog]);

  const filteredCatalog = useMemo(
    () => filterSkillHubCatalog(catalogItems, catalogCategory),
    [catalogCategory, catalogItems],
  );
  const visibleCatalog = catalogExpanded
    ? filteredCatalog
    : filteredCatalog.slice(0, CATALOG_PREVIEW_LIMIT);

  const submitSearch = async () => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      searchRequestSeqRef.current += 1;
      setSearchSubmitted(false);
      setSearchResults([]);
      setSearchMessage("");
      setSearchHint("");
      return;
    }

    const requestSeq = ++searchRequestSeqRef.current;
    setSearchSubmitted(true);
    setSearchLoading(true);
    setSearchResults([]);
    setSearchMessage("");
    setSearchHint("");
    try {
      const response = await window.agenticxDesktop.searchSkillHub({ q: normalizedQuery });
      if (requestSeq !== searchRequestSeqRef.current) return;
      if (!response.ok) {
        setSearchResults([]);
        setSearchMessage("搜索暂时不可用，请稍后重试。");
        return;
      }
      const nextResults = normalizeSkillHubFullSearchResults(response.items, {
        source: response.source,
        hint: response.hint,
      });
      setSearchResults(nextResults);
      setSearchHint(typeof response.hint === "string" ? response.hint : "");
      if (nextResults.length === 0) setSearchMessage("未找到相关技能，试试更短的关键词。");
    } catch {
      if (requestSeq !== searchRequestSeqRef.current) return;
      setSearchResults([]);
      setSearchMessage("搜索暂时不可用，请稍后重试。");
    } finally {
      if (requestSeq === searchRequestSeqRef.current) setSearchLoading(false);
    }
  };

  const clearSearch = () => {
    searchRequestSeqRef.current += 1;
    setQuery("");
    setSearchSubmitted(false);
    setSearchResults([]);
    setSearchMessage("");
    setSearchHint("");
    setSearchLoading(false);
  };

  const installStatusClass =
    installStatusTone === "warning"
      ? "text-amber-400"
      : installStatusTone === "success"
        ? "text-[var(--settings-accent-fg)]"
        : "text-text-muted";

  return (
    <section
      className="rounded-xl border border-border bg-surface-panel p-3.5"
      aria-label="SkillHub 技能目录"
      aria-busy={catalogLoading || searchLoading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-text-strong">SkillHub 技能目录</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
            浏览常用技能，安装前会先下载完整包并进行安全检查。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            disabled={catalogLoading}
            aria-label="刷新技能目录"
            onClick={() => void loadCatalog(true)}
          >
            <RefreshCw className={`h-3 w-3 ${catalogLoading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 text-[10px] text-text-faint transition hover:text-text-primary"
            onClick={() => window.open("https://skillhub.cn/", "_blank", "noopener,noreferrer")}
          >
            访问市场
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            className="h-9 w-full rounded-lg border border-border bg-surface-base pl-8 pr-3 text-xs text-text-primary outline-none transition placeholder:text-text-faint focus:border-[var(--settings-accent-border-strong)]"
            placeholder="搜索名称、用途或发布者"
            aria-label="搜索技能"
            value={query}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              if (!nextValue.trim() && searchSubmitted) clearSearch();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitSearch();
            }}
          />
        </div>
        <button
          type="button"
          className="h-9 shrink-0 rounded-lg border border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)] px-3 text-xs font-medium text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg-hover)] disabled:opacity-50"
          disabled={searchLoading}
          aria-label="搜索技能市场"
          onClick={() => void submitSearch()}
        >
          {searchLoading ? "搜索中…" : "搜索"}
        </button>
      </div>

      {installStatusMessage ? (
        <div
          className={`mt-2 whitespace-pre-wrap text-[11px] leading-4 ${installStatusClass}`}
          aria-live="polite"
        >
          {installStatusMessage}
        </div>
      ) : null}

      {searchSubmitted ? (
        <div className="mt-4" aria-busy={searchLoading}>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-text-strong">
                搜索结果{searchResults.length > 0 ? ` · ${searchResults.length}` : ""}
              </div>
              {searchHint ? <div className="mt-0.5 text-[10px] text-text-faint">{searchHint}</div> : null}
            </div>
            <button
              type="button"
              className="text-[11px] text-text-subtle transition hover:text-text-primary"
              onClick={clearSearch}
            >
              返回目录
            </button>
          </div>
          {searchMessage ? (
            <div
              className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-text-muted"
              role="status"
              aria-live="polite"
            >
              {searchMessage}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {searchResults.map((item) => (
                <SkillMarketCard
                  key={skillHubCatalogItemKey(item)}
                  item={item}
                  installState={getInstallState(item)}
                  installMessage={getInstallMessage?.(item)}
                  onInstall={() => onInstall(item)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="技能分类">
            {SKILLHUB_CATALOG_CATEGORIES.map((category) => {
              const count = filterSkillHubCatalog(catalogItems, category.id).length;
              const active = catalogCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${
                    active
                      ? "border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)] text-[var(--settings-accent-fg)]"
                      : "border-border bg-surface-base text-text-subtle hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  title={category.description}
                  aria-pressed={active}
                  onClick={() => {
                    setCatalogCategory(category.id);
                    setCatalogExpanded(false);
                  }}
                >
                  {category.label}
                  {count > 0 ? ` ${count}` : ""}
                </button>
              );
            })}
          </div>

          {catalogMessage ? (
            <div
              className="mt-2 text-[11px] leading-4 text-text-muted"
              role="status"
              aria-live="polite"
            >
              {catalogMessage}
            </div>
          ) : null}

          {catalogLoading && catalogItems.length === 0 ? (
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="h-[148px] animate-pulse rounded-xl border border-border bg-surface-card"
                />
              ))}
            </div>
          ) : visibleCatalog.length > 0 ? (
            <>
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {visibleCatalog.map((item) => (
                  <SkillMarketCard
                    key={skillHubCatalogItemKey(item)}
                    item={item}
                    installState={getInstallState(item)}
                    installMessage={getInstallMessage?.(item)}
                    onInstall={() => onInstall(item)}
                  />
                ))}
              </div>
              {filteredCatalog.length > CATALOG_PREVIEW_LIMIT ? (
                <button
                  type="button"
                  className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                  onClick={() => setCatalogExpanded((expanded) => !expanded)}
                >
                  {catalogExpanded
                    ? "收起目录"
                    : `查看全部 ${filteredCatalog.length} 个技能`}
                </button>
              ) : null}
            </>
          ) : !catalogLoading ? (
            <div className="mt-2.5 rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-text-muted">
              当前分类暂无结果，可切换分类或直接搜索。
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
