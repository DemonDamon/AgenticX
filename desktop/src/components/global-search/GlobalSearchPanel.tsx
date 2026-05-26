import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronUp,
  File,
  FileImage,
  FileText,
  Film,
  Folder,
  Loader2,
  Search,
  X,
} from "lucide-react";
import {
  CATEGORY_TABS,
  formatFileSize,
  formatMtime,
  useGlobalSearch,
  type GlobalSearchItem,
} from "../../hooks/useGlobalSearch";
import { ContextMenu } from "../ContextMenu";
import { Toast } from "../ds/Toast";
import { buildGlobalSearchContextMenuItems } from "./global-search-context-menu";
import { GlobalSearchIdleView, type SearchSuggestion } from "./GlobalSearchIdleView";

type Props = {
  open: boolean;
  onClose: () => void;
};

function itemIcon(item: GlobalSearchItem) {
  switch (item.kind) {
    case "folder":
      return <Folder className="h-4 w-4 text-amber-400" />;
    case "document":
      return <FileText className="h-4 w-4 text-sky-400" />;
    case "application":
      return <File className="h-4 w-4 text-violet-400" />;
    case "image":
      return <FileImage className="h-4 w-4 text-emerald-400" />;
    case "video":
      return <Film className="h-4 w-4 text-rose-400" />;
    default:
      return <File className="h-4 w-4 text-text-subtle" />;
  }
}

/** Marvis 式中段路径折叠：保留首尾，仅压缩中间。 */
function truncatePathMiddle(filePath: string, max = 64): string {
  if (filePath.length <= max) return filePath;
  const head = Math.floor((max - 1) * 0.55);
  const tail = max - 1 - head;
  return `${filePath.slice(0, head)}…${filePath.slice(-tail)}`;
}

type CtxMenuState = {
  x: number;
  y: number;
  item: GlobalSearchItem;
};

export function GlobalSearchPanel({ open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsScrollRef = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [hostPlatform, setHostPlatform] = useState("darwin");
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVariant, setToastVariant] = useState<"default" | "warning">("default");
  const search = useGlobalSearch(open);

  const showToast = useCallback((message: string, variant: "default" | "warning" = "default") => {
    setToastMessage(message);
    setToastVariant(variant);
    setToastOpen(true);
  }, []);

  const revealLabel = useMemo(() => {
    if (hostPlatform === "darwin") return "在访达中显示";
    if (hostPlatform === "win32") return "在资源管理器中显示";
    return "在文件管理器中显示";
  }, [hostPlatform]);

  useEffect(() => {
    void window.agenticxDesktop.platform().then((p) => setHostPlatform(p || "darwin"));
  }, []);

  useEffect(() => {
    if (!open) setCtxMenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShowScrollTop(false);
      return;
    }
    resultsScrollRef.current?.scrollTo({ top: 0 });
  }, [open, search.query, search.category]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handlePickSuggestion = useCallback(
    (suggestion: SearchSuggestion) => {
      if (suggestion.category) search.setCategory(suggestion.category);
      search.setQuery(suggestion.query);
      search.submitQuery(suggestion.query);
    },
    [search.setCategory, search.setQuery, search.submitQuery]
  );

  if (!open) return null;

  const isIdle = !search.query.trim();
  const filteredGroups = search.groupedResults;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-none"
      onClick={onClose}
    >
      <div
        className={`flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl ${
          isIdle
            ? "h-auto max-h-[min(560px,calc(100vh-12vh))]"
            : "h-[min(720px,calc(100vh-12vh))]"
        }`}
        style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        {/* Header：搜索框 + 关闭 */}
        <div className="shrink-0 border-b border-border bg-surface-panel px-5 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-text-subtle" />
            <input
              ref={inputRef}
              value={search.query}
              onChange={(event) => search.setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(event) => {
                if (composing) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  search.submitQuery(search.query);
                }
              }}
              placeholder="搜索电脑中的文件、文件夹与应用"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-text-strong outline-none placeholder:text-text-faint"
            />
            {search.loading ? (
              <div className="flex items-center gap-1 text-xs text-text-subtle">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {(search.elapsedMs / 1000).toFixed(1)}s
              </div>
            ) : null}
            <button
              type="button"
              className="rounded-md p-1 text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={onClose}
              aria-label="关闭搜索"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

        </div>

        {/* 分类 tab：Marvis 式带竖线分隔 */}
        <div className="shrink-0 border-b border-border bg-surface-panel px-5">
          <div className="flex items-center gap-3 overflow-x-auto py-2.5">
            {CATEGORY_TABS.map((tab, idx) => {
              const active = search.category === tab.id;
              const count =
                tab.id === "all"
                  ? search.results.length
                  : search.categoryCounts[tab.id];
              return (
                <div key={tab.id} className="flex shrink-0 items-center">
                  {idx > 0 ? (
                    <span className="mx-3 h-3 w-px bg-border" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    className={`flex items-center gap-1 text-[13px] transition ${
                      active
                        ? "font-semibold text-text-strong"
                        : "text-text-subtle hover:text-text-strong"
                    }`}
                    onClick={() => search.setCategory(tab.id)}
                  >
                    {tab.label}
                    <span className="text-text-faint">{count}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {search.warning ? (
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-200">
            {search.warning}
          </div>
        ) : null}

        {search.error ? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-5 py-2 text-xs text-rose-200">
            {search.error}
          </div>
        ) : null}

        {/* 结果区：单列 + 分组 + 每行点击展开元信息 */}
        <div className={isIdle ? "relative shrink-0" : "relative min-h-0 flex-1"}>
          <div
            ref={resultsScrollRef}
            className={
              isIdle
                ? "overflow-y-auto px-5 pb-3 pt-2"
                : "h-full overflow-y-auto px-5 py-4"
            }
            onScroll={(event) => {
              setShowScrollTop(event.currentTarget.scrollTop > 120);
            }}
          >
          {isIdle ? (
            <GlobalSearchIdleView
              history={search.history}
              onPickHistory={(value) => {
                search.setQuery(value);
                search.submitQuery(value);
              }}
              onClearHistory={search.clearHistory}
              onPickSuggestion={handlePickSuggestion}
            />
          ) : search.loading && search.results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-subtle">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在搜索…
            </div>
          ) : search.query.trim() && filteredGroups.length === 0 ? (
            <div className="py-16 text-center text-sm text-text-faint">
              无匹配文件
            </div>
          ) : (
            filteredGroups.map(([label, items]) => (
              <div key={label} className="mb-5 last:mb-0">
                <div className="mb-1.5 flex items-baseline gap-1 text-[13px] font-semibold text-text-strong">
                  {label}
                  <span className="text-text-faint">({items.length})</span>
                </div>
                <div>
                  {items.map((item) => {
                    const active = search.selectedPath === item.path;
                    return (
                      <ResultRow
                        key={item.path}
                        item={item}
                        active={active}
                        onSelect={() =>
                          search.setSelectedPath(active ? null : item.path)
                        }
                        onOpen={() => {
                          search.setSelectedPath(item.path);
                          void search.openSelected();
                        }}
                        onReveal={() => {
                          search.setSelectedPath(item.path);
                          void search.revealSelected();
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setCtxMenu({ x: event.clientX, y: event.clientY, item });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
          </div>

          {showScrollTop ? (
            <button
              type="button"
              className="absolute bottom-4 right-5 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-card text-text-subtle shadow-lg transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => {
                resultsScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
              aria-label="回到顶部"
            >
              <ChevronUp className="h-4 w-4" strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
      </div>

      <ContextMenu
        open={!!ctxMenu}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        items={
          ctxMenu
            ? buildGlobalSearchContextMenuItems({
                item: ctxMenu.item,
                revealLabel,
                hostPlatform,
                onToast: showToast,
                onClosePanel: onClose,
              })
            : []
        }
      />

      <Toast
        open={toastOpen}
        message={toastMessage}
        variant={toastVariant}
        onClose={() => setToastOpen(false)}
      />
    </div>,
    document.body
  );
}

function ResultRow({
  item,
  active,
  onSelect,
  onOpen,
  onReveal,
  onContextMenu,
}: {
  item: GlobalSearchItem;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <button
        type="button"
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition ${
          active ? "bg-surface-card-strong" : "hover:bg-surface-hover"
        }`}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
      >
        <span className="shrink-0">{itemIcon(item)}</span>
        <span className="truncate text-[13px] text-text-strong">{item.name}</span>
        <span
          className="truncate text-right text-[12px] text-text-faint"
          title={item.path}
        >
          {truncatePathMiddle(item.path)}
        </span>
        <span className="shrink-0 text-[12px] text-text-faint">
          {formatMtime(item.mtime).slice(0, 10)}
        </span>
      </button>

      {active ? (
        <div className="mx-2 mt-1 rounded-lg border border-border bg-surface-card px-3 py-2.5">
          <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px] leading-relaxed">
            <span className="text-text-faint">文件名:</span>
            <span className="truncate text-text-strong">{item.name}</span>
            <span className="text-text-faint">文件大小:</span>
            <span className="text-text-strong">{formatFileSize(item.size)}</span>
            <span className="text-text-faint">修改时间:</span>
            <span className="text-text-strong">{formatMtime(item.mtime)}</span>
            <span className="text-text-faint">本地路径:</span>
            <span className="break-all text-text-strong">{item.path}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-3 py-1 text-[12px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              打开
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-surface-panel px-3 py-1 text-[12px] text-text-strong transition hover:bg-surface-hover"
              onClick={(event) => {
                event.stopPropagation();
                onReveal();
              }}
            >
              所在位置
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GlobalSearchHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener("near:open-global-search", onOpen);
    window.addEventListener("near:close-global-search", onClose);
    return () => {
      window.removeEventListener("near:open-global-search", onOpen);
      window.removeEventListener("near:close-global-search", onClose);
    };
  }, []);

  return (
    <GlobalSearchPanel
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}
