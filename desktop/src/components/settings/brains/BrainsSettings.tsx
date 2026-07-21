import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Brain, Loader2, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../../../store";
import { createBrainsApi, type BrainRecord } from "./api";
import { KnowledgeConfigPanel } from "../knowledge/KnowledgeConfigPanel";
import { KnowledgeMaterialsPanel } from "../knowledge/KnowledgeMaterialsPanel";
import { KnowledgeDebugPanel } from "../knowledge/KnowledgeDebugPanel";
import { KnowledgeWikiPanel } from "../knowledge/KnowledgeWikiPanel";
import { createKbApi } from "../knowledge/api";
import type { KBConfig, KBStats } from "../knowledge/types";
import { defaultKBConfig, normalizeKbConfig } from "../knowledge/types";
import { BrainScopePanel, type BrainScopePanelHandle } from "./BrainScopePanel";
import { brainScopeBadge, brainTypeShort } from "./brainScopeUi";
import { CodeIndexBrainPanel, type CodeIndexBrainPanelHandle } from "./CodeIndexBrainPanel";
import { SettingsSwitch } from "../SettingsSwitch";
import { BackendDepsPanel } from "../knowledge/BackendDepsPanel";
import {
  KbGlobalChatRetrievalPanel,
  type KbGlobalChatRetrievalHandle,
} from "../knowledge/KbGlobalChatRetrievalPanel";

export type BrainsSettingsHandle = {
  flushIfDirty: () => Promise<{ ok: boolean; error?: string }>;
};

type DetailTab = "config" | "materials" | "debug" | "wiki";

export const BrainsSettings = forwardRef<BrainsSettingsHandle>(function BrainsSettings(
  _props,
  ref,
) {
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const avatars = useAppStore((s) => s.avatars);
  const providerCatalog = useAppStore((s) => s.settings.providers);

  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const brainsApi = useMemo(() => createBrainsApi(apiToken, resolveApiBase), [apiToken, resolveApiBase]);

  const [brains, setBrains] = useState<BrainRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("config");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"docs" | "code">("docs");
  const [newScope, setNewScope] = useState<"global" | "private">("global");
  const [newOwner, setNewOwner] = useState("");

  const [kbConfig, setKbConfig] = useState<KBConfig>(defaultKBConfig());
  const [kbDraft, setKbDraft] = useState<KBConfig>(defaultKBConfig());
  const [kbStats, setKbStats] = useState<KBStats | null>(null);
  const [codeEnabledDraft, setCodeEnabledDraft] = useState(true);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [codeDirty, setCodeDirty] = useState(false);
  const [brainSaving, setBrainSaving] = useState(false);
  const [brainSaveMsg, setBrainSaveMsg] = useState<string | null>(null);
  const scopePanelRef = useRef<BrainScopePanelHandle>(null);
  const codePanelRef = useRef<CodeIndexBrainPanelHandle>(null);
  const globalKbRetrievalRef = useRef<KbGlobalChatRetrievalHandle>(null);
  const [globalKbRetrievalDirty, setGlobalKbRetrievalDirty] = useState(false);
  /** Guards against stale readKbConfig responses overwriting a just-saved draft. */
  const kbConfigLoadIdRef = useRef(0);

  const applyKbDraft = useCallback((next: KBConfig | ((prev: KBConfig) => KBConfig)) => {
    setKbDraft((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      return normalizeKbConfig(resolved);
    });
  }, []);

  const applyKbConfigFromServer = useCallback((config: KBConfig) => {
    const normalized = normalizeKbConfig(config);
    setKbConfig(normalized);
    applyKbDraft(normalized);
  }, [applyKbDraft]);

  const selected = brains.find((b) => b.id === selectedId) ?? null;

  const kbApi = useMemo(() => {
    if (!selectedId || selected?.type !== "docs") return null;
    const baseResolve = resolveApiBase;
    return createKbApi(
      apiToken,
      async () => {
        const base = await baseResolve();
        return `${base}/api/brains/${encodeURIComponent(selectedId)}`;
      },
      "brain",
    );
  }, [apiToken, resolveApiBase, selectedId, selected?.type]);

  const reloadBrains = useCallback(async () => {
    setLoading(true);
    try {
      const list = await brainsApi.list();
      setBrains(list);
      setError(null);
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setLoading(false);
    }
  }, [brainsApi, selectedId]);

  useEffect(() => {
    void reloadBrains();
  }, [reloadBrains]);

  useEffect(() => {
    if (!selectedId || selected?.type !== "docs") return;
    const loadId = ++kbConfigLoadIdRef.current;
    void (async () => {
      try {
        const body = await brainsApi.readKbConfig(selectedId);
        if (kbConfigLoadIdRef.current !== loadId) return;
        applyKbConfigFromServer(body.config);
        setKbStats(body.stats);
      } catch (exc) {
        if (kbConfigLoadIdRef.current !== loadId) return;
        setError(String((exc as Error).message ?? exc));
      }
    })();
  }, [applyKbConfigFromServer, selectedId, selected?.type, brainsApi]);

  useEffect(() => {
    if (selected?.type !== "code") return;
    const cfg = (selected.config || {}) as Record<string, unknown>;
    setCodeEnabledDraft(Boolean(cfg.enabled ?? true));
  }, [selected?.id, selected?.type, selected?.config]);

  useEffect(() => {
    setScopeDirty(false);
    setCodeDirty(false);
    setBrainSaveMsg(null);
  }, [selectedId]);

  const kbDirty =
    selected?.type === "docs" && JSON.stringify(kbConfig) !== JSON.stringify(kbDraft);
  const brainDirty = kbDirty || scopeDirty || codeDirty || globalKbRetrievalDirty;

  const saveSelectedBrain = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!brainDirty) return { ok: true };

    const globalRes = await globalKbRetrievalRef.current?.flushIfDirty();
    if (globalRes && !globalRes.ok) {
      return { ok: false, error: globalRes.error ?? "对话检索设置保存失败" };
    }

    if (!selectedId || !selected) return { ok: true };

    const scopeRes = await scopePanelRef.current?.flushIfDirty();
    if (scopeRes && !scopeRes.ok) {
      return { ok: false, error: scopeRes.error ?? "可见范围保存失败" };
    }

    if (selected.type === "docs") {
      if (JSON.stringify(kbConfig) !== JSON.stringify(kbDraft)) {
        kbConfigLoadIdRef.current += 1;
        try {
          const result = await brainsApi.writeKbConfig(selectedId, kbDraft);
          applyKbConfigFromServer(result.config);
        } catch (exc) {
          const msg = String((exc as Error).message ?? exc);
          setError(`保存知识脑配置失败：${msg}`);
          return { ok: false, error: msg };
        }
      }
    }

    if (selected.type === "code") {
      const codeRes = await codePanelRef.current?.flushIfDirty();
      if (codeRes && !codeRes.ok) {
        return { ok: false, error: codeRes.error ?? "代码库配置保存失败" };
      }
    }

    await reloadBrains();
    return { ok: true };
  }, [applyKbConfigFromServer, brainDirty, brainsApi, kbConfig, kbDraft, reloadBrains, selected, selectedId]);

  useImperativeHandle(
    ref,
    () => ({
      async flushIfDirty() {
        return saveSelectedBrain();
      },
    }),
    [saveSelectedBrain],
  );

  const handleSaveBrain = async () => {
    const hadDirty = brainDirty;
    setBrainSaving(true);
    setBrainSaveMsg(null);
    setError(null);
    try {
      const res = await saveSelectedBrain();
      if (!res.ok) {
        setBrainSaveMsg(res.error ?? "保存失败");
        return;
      }
      if (hadDirty) {
        setBrainSaveMsg("已保存，可继续在本页调试或测试");
      }
    } finally {
      setBrainSaving(false);
    }
  };

  const handleCancelBrain = () => {
    if (!brainDirty) return;
    setBrainSaveMsg(null);
    setError(null);
    scopePanelRef.current?.discardChanges();
    if (selected?.type === "docs") {
      applyKbDraft(kbConfig);
    }
    if (selected?.type === "code") {
      codePanelRef.current?.discardChanges();
      const cfg = (selected.config || {}) as Record<string, unknown>;
      setCodeEnabledDraft(Boolean(cfg.enabled ?? true));
    }
  };

  const handleCreate = async () => {
    try {
      const b = await brainsApi.create({
        name: newName.trim() || "新知识脑",
        type: newType,
        scope: newScope,
        owner_avatar_id: newScope === "private" ? newOwner.trim() : undefined,
        config:
          newType === "code"
            ? { codebase_path: "", enabled: true }
            : { enabled: true },
      });
      setShowCreate(false);
      setNewName("");
      await reloadBrains();
      setSelectedId(b.id);
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(`确定删除知识脑「${selected?.name}」？此操作不可恢复。`)) return;
    try {
      await brainsApi.remove(selectedId);
      setSelectedId(null);
      await reloadBrains();
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    }
  };

  const detailTabs: { id: DetailTab; label: string }[] = [
    { id: "config", label: "配置" },
    { id: "materials", label: "资料" },
    { id: "wiki", label: "Wiki" },
    { id: "debug", label: "调试" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <BackendDepsPanel />
      <KbGlobalChatRetrievalPanel
        ref={globalKbRetrievalRef}
        apiToken={apiToken}
        resolveApiBase={resolveApiBase}
        onDirtyChange={setGlobalKbRetrievalDirty}
      />
      <p className="shrink-0 text-xs leading-relaxed text-text-muted">
        每个<strong className="font-medium text-text-primary">知识脑</strong>是独立实例（文档库或代码库）。分身可在设置中挂载 0–N
        个脑；Meta 默认仅使用全局脑。
      </p>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-52 shrink-0 flex-col rounded-lg border border-border bg-surface-card p-2 min-h-0">
          <div className="flex shrink-0 items-center justify-between px-1">
            <span className="text-xs font-medium text-text-subtle">知识脑</span>
            <button
              type="button"
              className="rounded p-1 text-text-subtle hover:bg-surface-hover"
              title="新建"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载…
            </div>
          ) : (
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {brains.map((b) => {
                const badge = brainScopeBadge(b.scope);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full rounded-lg px-2 py-2 text-left text-xs transition ${
                      selectedId === b.id
                        ? "bg-[var(--settings-accent-solid)] text-[var(--settings-accent-solid-text)]"
                        : "hover:bg-surface-hover text-text-muted"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      <Brain className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ring-1 ${
                          selectedId === b.id ? "ring-white/20 bg-white/15" : badge.className
                        }`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div
                      className={`mt-0.5 truncate text-[11px] ${
                        selectedId === b.id ? "opacity-90" : "text-text-subtle"
                      }`}
                    >
                      {brainTypeShort(b.type)}
                      {b.scope === "private" && b.owner_avatar_id
                        ? ` · ${b.owner_avatar_id.slice(0, 8)}`
                        : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface-card">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center py-12 text-center text-sm text-text-muted">
              选择或新建一个知识脑
            </div>
          ) : (
            <>
              <div className="shrink-0 px-4 pt-4 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-text-primary">
                    {selected.name}
                    {selected.id === "default_docs" ? (
                      <span className="ml-2 text-xs font-normal text-text-muted">系统默认</span>
                    ) : null}
                  </h3>
                  {selected.type === "code" ? (
                    <SettingsSwitch
                      checked={codeEnabledDraft}
                      onChange={setCodeEnabledDraft}
                      aria-label="启用此代码脑"
                    />
                  ) : selected.type === "docs" ? (
                    <SettingsSwitch
                      checked={kbDraft.enabled}
                      onChange={(enabled) => applyKbDraft((prev) => ({ ...prev, enabled }))}
                      aria-label="启用此文档库"
                    />
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
                <BrainScopePanel
                  ref={scopePanelRef}
                  brain={selected}
                  brainsApi={brainsApi}
                  onUpdated={reloadBrains}
                  onDirtyChange={setScopeDirty}
                />

                {selected.type === "docs" && kbApi ? (
                  <div className="flex overflow-hidden rounded-md border border-border text-xs">
                    {detailTabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`px-3 py-1 transition ${
                          detailTab === t.id
                            ? "bg-[var(--settings-accent-solid)] font-medium text-[var(--settings-accent-solid-text)]"
                            : "bg-transparent text-text-muted hover:bg-surface-hover"
                        }`}
                        onClick={() => setDetailTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {selected.type === "docs" && kbApi ? (
                  <>
                    {detailTab === "config" ? (
                      <KnowledgeConfigPanel
                        api={kbApi}
                        persistedConfig={kbConfig}
                        draft={kbDraft}
                        onDraftChange={applyKbDraft}
                        initialStats={kbStats}
                        providerCatalog={providerCatalog}
                      />
                    ) : null}
                    {detailTab === "materials" ? (
                      <KnowledgeMaterialsPanel
                        api={kbApi}
                        enabled={kbDraft.enabled}
                        extensions={kbDraft.file_filters.extensions}
                      />
                    ) : null}
                    {detailTab === "debug" ? (
                      <KnowledgeDebugPanel api={kbApi} config={kbConfig} />
                    ) : null}
                    {detailTab === "wiki" ? <KnowledgeWikiPanel api={kbApi} /> : null}
                  </>
                ) : null}

                {selected.type === "code" ? (
                  <CodeIndexBrainPanel
                    ref={codePanelRef}
                    brain={selected}
                    brainsApi={brainsApi}
                    onUpdated={reloadBrains}
                    enabled={codeEnabledDraft}
                    onEnabledChange={setCodeEnabledDraft}
                    onDirtyChange={setCodeDirty}
                  />
                ) : null}
              </div>

              <div className="shrink-0 border-t border-[var(--border-muted)] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {selected.id !== "default_docs" ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                      onClick={() => void handleDelete()}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> 删除
                    </button>
                  ) : null}
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {brainDirty ? (
                      <span className="text-xs text-amber-500">有未保存的改动</span>
                    ) : brainSaveMsg ? (
                      <span className="text-xs text-text-muted">{brainSaveMsg}</span>
                    ) : null}
                    <button
                      type="button"
                      disabled={brainSaving || !brainDirty}
                      className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-hover disabled:opacity-40"
                      onClick={handleCancelBrain}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={brainSaving || !brainDirty}
                      className="rounded-lg bg-[var(--settings-accent-solid)] px-4 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                      onClick={() => void handleSaveBrain()}
                    >
                      {brainSaving ? (
                        <>
                          <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                          保存中…
                        </>
                      ) : (
                        "保存"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="shrink-0 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {showCreate
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]"
              role="presentation"
              onClick={() => setShowCreate(false)}
            >
              <div
                role="dialog"
                aria-labelledby="create-brain-title"
                className="relative isolate w-full max-w-md rounded-xl border border-border p-5 shadow-2xl"
                style={{ backgroundColor: "var(--surface-base-fallback, #1a1b1f)" }}
                onClick={(e) => e.stopPropagation()}
              >
            <h3 id="create-brain-title" className="mb-4 text-sm font-semibold text-text-strong">
              新建知识脑
            </h3>
            <label className="mb-2 block text-xs text-text-subtle">
              名称
              <input
                className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：产品文档库"
              />
            </label>
            <label className="mb-2 block text-xs text-text-subtle">
              类型
              <select
                className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={newType}
                onChange={(e) => setNewType(e.target.value as "docs" | "code")}
              >
                <option value="docs">文档库（PDF/Office 等）</option>
                <option value="code">代码库（语义索引）</option>
              </select>
            </label>
            <label className="mb-2 block text-xs text-text-subtle">
              范围
              <select
                className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as "global" | "private")}
              >
                <option value="global">全局（Meta + 分身可挂）</option>
                <option value="private">分身私有</option>
              </select>
            </label>
            {newScope === "private" ? (
              <label className="mb-3 block text-xs text-text-subtle">
                所属分身
                {avatars.length > 0 ? (
                  <select
                    className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value)}
                  >
                    <option value="">请选择…</option>
                    {avatars.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value)}
                    placeholder="avatar_id"
                  />
                )}
              </label>
            ) : null}
            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                className="rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-xs text-text-subtle hover:bg-surface-hover"
                onClick={() => setShowCreate(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)]"
                onClick={() => void handleCreate()}
              >
                创建
              </button>
            </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
