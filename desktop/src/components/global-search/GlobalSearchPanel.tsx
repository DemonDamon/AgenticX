import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  File,
  FileImage,
  FileText,
  Film,
  Folder,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  CATEGORY_TABS,
  formatFileSize,
  formatMtime,
  useGlobalSearch,
  type GlobalSearchItem,
} from "../../hooks/useGlobalSearch";

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

function truncatePath(filePath: string, max = 56): string {
  if (filePath.length <= max) return filePath;
  const head = filePath.slice(0, 18);
  const tail = filePath.slice(-max + 21);
  return `${head}…${tail}`;
}

function PreviewPane({
  item,
  preview,
  previewLoading,
  onOpen,
  onReveal,
}: {
  item: GlobalSearchItem | null;
  preview: ReturnType<typeof useGlobalSearch>["preview"];
  previewLoading: boolean;
  onOpen: () => void;
  onReveal: () => void;
}) {
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-text-faint">
        选择左侧结果以预览
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden border-b border-border-subtle bg-surface-panel/40 p-4">
        {previewLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-subtle">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载预览…
          </div>
        ) : preview?.kind === "text" && preview.content ? (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-surface-card p-3 font-mono text-xs leading-relaxed text-text-strong">
            {preview.content}
            {preview.truncated ? "\n\n…（内容已截断）" : ""}
          </pre>
        ) : preview?.kind === "image" && preview.fileUrl ? (
          <div className="flex h-full items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-card p-3">
            <img
              src={preview.fileUrl}
              alt={item.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle bg-surface-card/60 px-6 text-center text-sm text-text-subtle">
            {itemIcon(item)}
            <div>{preview?.error ?? "该类型暂不支持内容预览，可查看下方文件信息"}</div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-3 p-4">
        <div>
          <div className="truncate text-base font-semibold text-text-strong">{item.name}</div>
          <div className="mt-1 text-xs text-text-subtle">
            {item.ext ? item.ext.replace(/^\./, "").toUpperCase() : "文件夹"} | {formatFileSize(item.size)}
          </div>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-xs text-text-subtle">
          <div className="break-all">{item.path}</div>
          <div className="mt-1 text-text-faint">修改时间：{formatMtime(item.mtime)}</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-btnPrimary px-4 py-2 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
            onClick={() => void onOpen()}
          >
            打开
          </button>
          <button
            type="button"
            className="rounded-lg border border-border-subtle bg-surface-card px-4 py-2 text-sm text-text-strong transition hover:bg-surface-hover"
            onClick={() => void onReveal()}
          >
            所在位置
          </button>
        </div>
      </div>
    </div>
  );
}

export function GlobalSearchPanel({ open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [composing, setComposing] = useState(false);
  const search = useGlobalSearch(open);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

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

  if (!open) return null;

  const showHistory = !search.query.trim() && search.history.length > 0;
  const filteredGroups = search.groupedResults;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="flex h-[min(720px,calc(100vh-12vh))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        <div className="shrink-0 border-b border-border-subtle px-4 py-3">
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
              className="min-w-0 flex-1 bg-transparent text-sm text-text-strong outline-none placeholder:text-text-faint"
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

          <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1">
            {CATEGORY_TABS.map((tab) => {
              const active = search.category === tab.id;
              const count =
                tab.id === "all"
                  ? search.results.length
                  : search.categoryCounts[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`shrink-0 rounded-full px-3 py-1 text-xs transition ${
                    active
                      ? "bg-surface-card-strong text-text-strong"
                      : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
                  }`}
                  onClick={() => search.setCategory(tab.id)}
                >
                  {tab.label}
                  <span className="ml-1 text-text-faint">{count}</span>
                </button>
              );
            })}
            <div className="ml-auto shrink-0 rounded-md p-1 text-text-faint">
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>

        {search.warning ? (
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            {search.warning}
          </div>
        ) : null}

        {search.error ? (
          <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
            {search.error}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-border-subtle">
            {showHistory ? (
              <div className="border-b border-border-subtle px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium text-text-subtle">最近搜索</div>
                  <button
                    type="button"
                    className="text-xs text-text-faint transition hover:text-text-strong"
                    onClick={search.clearHistory}
                  >
                    清空
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {search.history.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="rounded-full border border-border-subtle bg-surface-card px-3 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => {
                        search.setQuery(item);
                        search.submitQuery(item);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!search.query.trim() ? (
              <div className="px-4 py-10 text-center text-sm text-text-faint">
                输入关键词开始搜索本机文件
              </div>
            ) : search.loading && search.results.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-text-subtle">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在搜索…
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-text-faint">
                无匹配文件
              </div>
            ) : (
              filteredGroups.map(([label, items]) => (
                <div key={label} className="px-2 py-2">
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-text-faint">
                    {label}
                  </div>
                  {items.map((item) => {
                    const active = search.selectedPath === item.path;
                    return (
                      <button
                        key={item.path}
                        type="button"
                        className={`mb-1 flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition ${
                          active ? "bg-surface-card-strong" : "hover:bg-surface-hover"
                        }`}
                        onClick={() => search.setSelectedPath(item.path)}
                        onDoubleClick={() => {
                          search.setSelectedPath(item.path);
                          void search.openSelected();
                        }}
                      >
                        <div className="mt-0.5 shrink-0">{itemIcon(item)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-text-strong">{item.name}</div>
                          <div className="truncate text-xs text-text-faint">{truncatePath(item.path)}</div>
                        </div>
                        <div className="shrink-0 text-[11px] text-text-faint">
                          {formatMtime(item.mtime).slice(0, 10)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <PreviewPane
            item={search.selectedItem}
            preview={search.preview}
            previewLoading={search.previewLoading}
            onOpen={search.openSelected}
            onReveal={search.revealSelected}
          />
        </div>
      </div>
    </div>,
    document.body
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
