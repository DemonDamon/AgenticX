import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, ChevronDown, Folder, FolderPlus, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../store";
import { useAttachWorkspaceSources } from "../../hooks/useAttachWorkspaceSources";
import { readScopedLocalStorage, writeScopedLocalStorage } from "../../utils/backend-scope";
import { NEAR_ARTIFACT_TASKSPACES_SYNCED } from "../../utils/workspace-sidebar-events";
import { MountModeDialog } from "./MountModeDialog";

const RECENT_DIRS_KEY = "agx-recent-workspace-dirs-v1";
const RECENT_LIMIT = 8;

type RecentDir = {
  path: string;
  label: string;
  addedAt: number;
};

export type BoundFolderChip = {
  key: string;
  label: string;
  path: string;
  taskspaceId: string | null;
};

export type ComposerWorkspaceFoldersApi = {
  folders: BoundFolderChip[];
  recent: RecentDir[];
  defaultFolder: RecentDir | null;
  errorText: string;
  activeTaskspaceId: string | null;
  attach: ReturnType<typeof useAttachWorkspaceSources>;
  activate: (folder: BoundFolderChip) => Promise<void>;
  remove: (folder: BoundFolderChip) => Promise<void>;
  requestAttach: (paths: string[]) => void;
};

export type ComposerWorkspaceFoldersProps = {
  paneId: string;
  sessionId: string;
  paneAvatarId: string | null;
  paneAvatarName: string;
  onEnsureSessionForWorkspace?: () => Promise<string | null>;
};

function folderLabelFromPath(path: string): string {
  const bits = String(path || "").split(/[\\/]/).filter(Boolean);
  return bits[bits.length - 1] || path || "文件夹";
}

function normalizePath(path: string): string {
  return String(path || "").trim().replace(/\/+$/, "");
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

function readRecentDirs(): RecentDir[] {
  const raw = readScopedLocalStorage(RECENT_DIRS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Partial<RecentDir>;
        const path = String(row.path ?? "").trim();
        if (!path) return null;
        return {
          path,
          label: String(row.label ?? "").trim() || folderLabelFromPath(path),
          addedAt: Number(row.addedAt) || 0,
        };
      })
      .filter((item): item is RecentDir => !!item)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function rememberRecentDir(path: string): void {
  const clean = normalizePath(path);
  if (!clean) return;
  const next: RecentDir[] = [
    { path: clean, label: folderLabelFromPath(clean), addedAt: Date.now() },
    ...readRecentDirs().filter((item) => !pathsEqual(item.path, clean)),
  ].slice(0, RECENT_LIMIT);
  writeScopedLocalStorage(RECENT_DIRS_KEY, JSON.stringify(next));
}

function panelPlacement(rect: DOMRect): { panel: CSSProperties; listMaxHeight: number } {
  const width = 340;
  const margin = 8;
  const gap = 6;
  const chrome = 92;
  const viewport = window.visualViewport;
  const viewWidth = viewport?.width ?? window.innerWidth;
  const viewHeight = viewport?.height ?? window.innerHeight;
  const viewLeft = viewport?.offsetLeft ?? 0;
  const viewBottom = (viewport?.offsetTop ?? 0) + viewHeight;
  const left = Math.max(
    viewLeft + margin,
    Math.min(rect.left, viewLeft + viewWidth - width - margin),
  );
  const spaceBelow = Math.max(0, viewBottom - rect.bottom - margin - gap);
  return {
    panel: {
      position: "fixed",
      left,
      top: rect.bottom + gap,
      width,
      zIndex: 280,
    },
    listMaxHeight: Math.max(96, Math.min(220, Math.floor(spaceBelow - chrome))),
  };
}

async function registerTaskspaces(sessionId: string, sources: string[]): Promise<string | null> {
  if (typeof window.agenticxDesktop.addTaskspace !== "function") return null;
  let lastId: string | null = null;
  for (const source of sources) {
    const path = normalizePath(source);
    if (!path) continue;
    const added = await window.agenticxDesktop.addTaskspace({
      sessionId,
      path,
      label: folderLabelFromPath(path),
    });
    if (added.ok && added.workspace?.id) lastId = added.workspace.id;
    rememberRecentDir(path);
  }
  return lastId;
}

function dispatchWorkspaceSynced(sessionId: string, added: number): void {
  window.dispatchEvent(
    new CustomEvent(NEAR_ARTIFACT_TASKSPACES_SYNCED, {
      detail: { sessionId, added },
    }),
  );
}

function toPickedChip(path: string, taskspaceId: string | null = null): BoundFolderChip {
  const clean = normalizePath(path);
  return {
    key: taskspaceId || `pick:${clean}`,
    label: folderLabelFromPath(clean),
    path: clean,
    taskspaceId,
  };
}

function mergePicked(current: BoundFolderChip[], incoming: BoundFolderChip[]): BoundFolderChip[] {
  const next = [...current];
  for (const item of incoming) {
    const idx = next.findIndex((row) => pathsEqual(row.path, item.path));
    if (idx >= 0) {
      next[idx] = { ...next[idx], ...item, path: next[idx].path };
    } else {
      next.push(item);
    }
  }
  return next;
}

async function listWorkspaceBindings(sessionId: string): Promise<BoundFolderChip[]> {
  const effective = String(sessionId || "").trim();
  if (!effective || typeof window.agenticxDesktop.listTaskspaces !== "function") return [];
  const listed = await window.agenticxDesktop.listTaskspaces(effective);
  const workspaces = listed.ok && Array.isArray(listed.workspaces) ? listed.workspaces : [];
  const chips: BoundFolderChip[] = workspaces
    .filter((item) => item.id !== "default")
    .map((item) => ({
      key: item.id,
      label: item.label || folderLabelFromPath(item.path),
      path: item.path,
      taskspaceId: item.id,
    }));
  if (typeof window.agenticxDesktop.listTaskspaceFiles !== "function") return chips;
  const files = await window.agenticxDesktop.listTaskspaceFiles({
    sessionId: effective,
    taskspaceId: "default",
    path: ".",
  });
  if (!files.ok) return chips;
  for (const entry of files.files ?? []) {
    const source = String(entry.source_path || "").trim();
    if (!source || entry.type !== "dir") continue;
    if (chips.some((chip) => pathsEqual(chip.path, source))) continue;
    chips.push({
      key: `mount:${entry.name}`,
      label: entry.name || folderLabelFromPath(source),
      path: source,
      taskspaceId: null,
    });
  }
  return chips;
}

async function unbindFolder(
  sessionId: string,
  folder: BoundFolderChip,
  activeTaskspaceId: string | null,
  paneId: string,
  setActiveTaskspace: (paneId: string, taskspaceId: string | null) => void,
): Promise<void> {
  if (folder.taskspaceId && folder.taskspaceId !== "default") {
    await window.agenticxDesktop.removeTaskspace({
      sessionId,
      taskspaceId: folder.taskspaceId,
    });
    if (activeTaskspaceId === folder.taskspaceId) {
      setActiveTaskspace(paneId, null);
    }
  }
  const unlink = window.agenticxDesktop.unlinkFromSessionWorkspace;
  if (typeof unlink === "function" && folder.path) {
    await unlink({ sessionId, sources: [folder.path] });
  }
}

export function useComposerWorkspaceFolders({
  paneId,
  sessionId,
  paneAvatarId,
  paneAvatarName,
  onEnsureSessionForWorkspace,
}: ComposerWorkspaceFoldersProps): ComposerWorkspaceFoldersApi {
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);
  const activeTaskspaceId = useAppStore(
    (s) => s.panes.find((p) => p.id === paneId)?.activeTaskspaceId ?? null,
  );
  const [folders, setFolders] = useState<BoundFolderChip[]>([]);
  const foldersRef = useRef<BoundFolderChip[]>([]);
  foldersRef.current = folders;
  const [errorText, setErrorText] = useState("");
  const [recent, setRecent] = useState<RecentDir[]>(() => readRecentDirs());
  const [defaultFolder, setDefaultFolder] = useState<RecentDir | null>(null);

  const refreshRecent = useCallback(() => {
    setRecent(readRecentDirs());
  }, []);

  useEffect(() => {
    const loader = window.agenticxDesktop.loadWorkspaceConfig;
    if (typeof loader !== "function") return;
    void loader().then((res) => {
      const path = normalizePath(String(res.resolvedPath || res.workspaceDir || ""));
      if (!path) return;
      setDefaultFolder({
        path,
        label: folderLabelFromPath(path),
        addedAt: 0,
      });
    });
  }, []);

  const attach = useAttachWorkspaceSources({
    paneId,
    sessionId,
    paneAvatarId,
    paneAvatarName,
    onEnsureSessionForWorkspace,
    onError: setErrorText,
    onAttached: async (sid, sources) => {
      const incoming = sources.map((source) => toPickedChip(source));
      const next = mergePicked(foldersRef.current, incoming);
      foldersRef.current = next;
      setFolders(next);
      for (const source of sources) rememberRecentDir(source);
      refreshRecent();
      const keep = next.map((item) => item.path);
      const leftovers = (await listWorkspaceBindings(sid)).filter(
        (item) => !keep.some((path) => pathsEqual(path, item.path)),
      );
      for (const leftover of leftovers) {
        await unbindFolder(sid, leftover, activeTaskspaceId, paneId, setActiveTaskspace);
      }
      dispatchWorkspaceSynced(sid, sources.length);
    },
  });

  const activate = useCallback(
    async (folder: BoundFolderChip) => {
      if (folder.taskspaceId) {
        setActiveTaskspace(paneId, folder.taskspaceId);
        return;
      }
      const sid = String(sessionId || "").trim();
      if (!sid) return;
      const lastId = await registerTaskspaces(sid, [folder.path]);
      if (lastId) setActiveTaskspace(paneId, lastId);
      dispatchWorkspaceSynced(sid, 1);
    },
    [paneId, sessionId, setActiveTaskspace],
  );

  const remove = useCallback(
    async (folder: BoundFolderChip) => {
      const next = foldersRef.current.filter((item) => !pathsEqual(item.path, folder.path));
      foldersRef.current = next;
      setFolders(next);
      const sid = String(sessionId || "").trim();
      if (!sid) return;
      const bindings = await listWorkspaceBindings(sid);
      const matches = bindings.filter((item) => pathsEqual(item.path, folder.path));
      if (matches.length === 0) {
        await unbindFolder(sid, folder, activeTaskspaceId, paneId, setActiveTaskspace);
      } else {
        for (const match of matches) {
          await unbindFolder(sid, match, activeTaskspaceId, paneId, setActiveTaskspace);
        }
      }
      dispatchWorkspaceSynced(sid, 0);
    },
    [activeTaskspaceId, paneId, sessionId, setActiveTaskspace],
  );

  const setPendingMountMode = attach.setPendingMountMode;
  const setPendingMountSources = attach.setPendingMountSources;
  const requestAttach = useCallback(
    (paths: string[]) => {
      const cleaned = paths.map(normalizePath).filter(Boolean);
      if (cleaned.length === 0) return;
      setPendingMountMode("reference");
      setPendingMountSources(cleaned);
    },
    [setPendingMountMode, setPendingMountSources],
  );

  return {
    folders,
    recent,
    defaultFolder,
    errorText,
    activeTaskspaceId,
    attach,
    activate,
    remove,
    requestAttach,
  };
}

export function WorkspaceFolderPicker({ api }: { api: ComposerWorkspaceFoldersApi }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [listMaxHeight, setListMaxHeight] = useState(220);
  const anchorRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const boundPaths = useMemo(() => api.folders.map((item) => item.path), [api.folders]);

  const syncPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const next = panelPlacement(el.getBoundingClientRect());
    setStyle(next.panel);
    setListMaxHeight(next.listMaxHeight);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncPosition();
    const onReflow = () => syncPosition();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, syncPosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const chooseDirectory = async () => {
    setOpen(false);
    const picker = window.agenticxDesktop.chooseDirectory;
    if (typeof picker !== "function") return;
    const picked = await picker();
    if (!picked.ok || !picked.path) return;
    api.requestAttach([picked.path]);
  };

  const singleFolder = api.folders.length === 1 ? api.folders[0] : null;
  const triggerTitle =
    api.folders.length === 1
      ? api.folders[0].path
      : api.folders.length > 1
        ? api.folders.map((folder) => folder.path).join("\n")
        : "绑定工作目录，可添加多个";

  const listItems = useMemo(() => {
    const items: RecentDir[] = [];
    const seen: string[] = [];
    const push = (item: { path: string; label: string; addedAt?: number }) => {
      if (seen.some((path) => pathsEqual(path, item.path))) return;
      seen.push(item.path);
      items.push({
        path: item.path,
        label: item.label,
        addedAt: item.addedAt ?? 0,
      });
    };
    if (api.defaultFolder) push(api.defaultFolder);
    for (const folder of api.folders) push(folder);
    for (const item of api.recent) push(item);
    return items;
  }, [api.defaultFolder, api.folders, api.recent]);

  const toggleFolder = (item: RecentDir) => {
    const boundFolder = api.folders.find((folder) => pathsEqual(folder.path, item.path));
    if (boundFolder) {
      void api.remove(boundFolder);
      return;
    }
    setOpen(false);
    api.requestAttach([item.path]);
  };

  return (
    <div className="relative min-w-0">
      {singleFolder ? (
        <div
          ref={anchorRef}
          className="inline-flex h-7 max-w-[240px] items-center gap-1 rounded-lg bg-surface-hover px-1.5 text-[12px] text-text-primary"
        >
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 px-0.5"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            title={triggerTitle}
          >
            <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{singleFolder.label}</span>
          </button>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-card hover:text-text-primary"
            title="移除"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              void api.remove(singleFolder);
            }}
          >
            <X className="h-3 w-3" strokeWidth={2.2} />
          </button>
        </div>
      ) : (
        <button
          ref={anchorRef}
          type="button"
          className={`inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-lg px-2 text-[12px] text-text-subtle transition-colors ${
            open ? "bg-surface-hover text-text-strong" : "hover:bg-surface-hover hover:text-text-primary"
          }`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={triggerTitle}
        >
          <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate">
            {api.folders.length > 1 ? `${api.folders.length} 个文件夹` : "选择文件夹（可选）"}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
        </button>
      )}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="rounded-xl border border-border bg-surface-base p-1 shadow-2xl"
              style={style}
              role="listbox"
            >
              {listItems.length > 0 ? (
                <>
                  <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-text-faint">最近</div>
                  <div
                    className="preview-scrollbar overflow-y-scroll pr-0.5"
                    style={{ maxHeight: listMaxHeight }}
                  >
                    {listItems.map((item) => {
                      const bound = boundPaths.some((path) => pathsEqual(path, item.path));
                      return (
                        <button
                          key={item.path}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover"
                          onClick={() => toggleFolder(item)}
                        >
                          <Folder className="h-4 w-4 shrink-0 text-text-faint" strokeWidth={1.8} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] leading-tight text-text-primary">
                              {item.label}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-faint">
                              {item.path}
                            </span>
                          </span>
                          {bound ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-[#22c55e]" strokeWidth={2.6} />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="my-1 h-px bg-border" />
                </>
              ) : null}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-primary hover:bg-surface-hover"
                onClick={() => void chooseDirectory()}
              >
                <FolderPlus className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.8} />
                <span>选择文件夹</span>
              </button>
              {api.errorText ? (
                <div className="px-2.5 py-1.5 text-[11px] text-rose-300">{api.errorText}</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {api.attach.pendingMountSources ? (
        <MountModeDialog
          sources={api.attach.pendingMountSources}
          mode={api.attach.pendingMountMode}
          adding={api.attach.adding}
          onModeChange={api.attach.setPendingMountMode}
          onCancel={() => api.attach.setPendingMountSources(null)}
          onConfirm={() => void api.attach.confirmMountModeAndAttach()}
        />
      ) : null}
    </div>
  );
}
