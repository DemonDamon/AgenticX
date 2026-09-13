import {

  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Brain, Loader2, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../../../store";
import { createBrainsApi, type BrainRecord } from "./api";
import { displayBrainName } from "./brain-display";
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
import { i18n } from "../../../i18n/i18n";
import {
  KbGlobalChatRetrievalPanel,
  type KbGlobalChatRetrievalHandle,
} from "../knowledge/KbGlobalChatRetrievalPanel";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


export type BrainsSettingsHandle = {
  flushIfDirty: () => Promise<{ ok: boolean; error?: string }>;
};

type DetailTab = "config" | "materials" | "debug" | "wiki";

export const BrainsSettings = forwardRef<BrainsSettingsHandle>(function BrainsSettings(
  _props,
  ref,
) {
  const { t } = useTranslation("settings");
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
      return { ok: false, error: globalRes.error ?? st("brains.chatRetrievalSaveFailed") };
    }

    if (!selectedId || !selected) return { ok: true };

    const scopeRes = await scopePanelRef.current?.flushIfDirty();
    if (scopeRes && !scopeRes.ok) {
      return { ok: false, error: scopeRes.error ?? st("brains.scopeSaveFailed") };
    }

    if (selected.type === "docs") {
      if (JSON.stringify(kbConfig) !== JSON.stringify(kbDraft)) {
        kbConfigLoadIdRef.current += 1;
        try {
          const result = await brainsApi.writeKbConfig(selectedId, kbDraft);
          applyKbConfigFromServer(result.config);
        } catch (exc) {
          const msg = String((exc as Error).message ?? exc);
          setError(st("brains.brainSaveFailed", { reason: msg }));
          return { ok: false, error: msg };
        }
      }
    }

    if (selected.type === "code") {
      const codeRes = await codePanelRef.current?.flushIfDirty();
      if (codeRes && !codeRes.ok) {
        return { ok: false, error: codeRes.error ?? st("brains.codeSaveFailed") };
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
        setBrainSaveMsg(res.error ?? st("brains.saveFailed"));
        return;
      }
      if (hadDirty) {
        setBrainSaveMsg(st("brains.savedDebug"));
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
        name: newName.trim() || st("brains.newBrainName"),
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
    if (!window.confirm(st("brains.deleteConfirm", { name: selected ? displayBrainName(selected) : "" }))) return;
    try {
      await brainsApi.remove(selectedId);
      setSelectedId(null);
      await reloadBrains();
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    }
  };

  const detailTabs: { id: DetailTab; label: string }[] = [
    { id: "config", label: st("brains.tabConfig") },
    { id: "materials", label: st("brains.tabMaterials") },
    { id: "wiki", label: "Wiki" },
    { id: "debug", label: st("brains.tabDebug") },
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
        {st("brains.intro")}
      </p>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-52 shrink-0 flex-col rounded-lg border border-border bg-surface-card p-2 min-h-0">
          <div className="flex shrink-0 items-center justify-between px-1">
            <span className="text-xs font-medium text-text-subtle">{st("brains.listTitle")}</span>
            <button
              type="button"
              className="rounded p-1 text-text-subtle hover:bg-surface-hover"
              title={st("brains.newTitle")}
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {st("brains.loading")}
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
                      <span className="min-w-0 flex-1 truncate">{displayBrainName(b)}</span>
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
              {st("brains.pickOrCreate")}
            </div>
          ) : (
            <>
              <div className="shrink-0 px-4 pt-4 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-text-primary">
                    {displayBrainName(selected)}
                    {selected.id === "default_docs" ? (
                      <span className="ml-2 text-xs font-normal text-text-muted">{st("brains.systemDefault")}</span>
                    ) : null}
                  </h3>
                  {selected.type === "code" ? (
                    <SettingsSwitch
                      checked={codeEnabledDraft}
                      onChange={setCodeEnabledDraft}
                      aria-label={st("brains.enableCodeAria")}
                    />
                  ) : selected.type === "docs" ? (
                    <SettingsSwitch
                      checked={kbDraft.enabled}
                      onChange={(enabled) => applyKbDraft((prev) => ({ ...prev, enabled }))}
                      aria-label={st("brains.enableDocsAria")}
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
                      <Trash2 className="h-3.5 w-3.5" /> {st("brains.delete")}
                    </button>
                  ) : null}
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {brainDirty ? (
                      <span className="text-xs text-amber-500">{st("brains.unsaved")}</span>
                    ) : brainSaveMsg ? (
                      <span className="text-xs text-text-muted">{brainSaveMsg}</span>
                    ) : null}
                    <button
                      type="button"
                      disabled={brainSaving || !brainDirty}
                      className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-hover disabled:opacity-40"
                      onClick={handleCancelBrain}
                    >
                      {st("brains.cancel")}
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
                          {st("brains.saving")}
                        </>
                      ) : (
                        st("brains.save")
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
              {st("brains.createTitle")}
            </h3>
            <label className="mb-2 block text-xs text-text-subtle">
              {st("brains.name")}
              <input
                className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={st("brains.namePh")}
              />
            </label>
            <label className="mb-2 block text-xs text-text-subtle">
              {st("brains.type")}
              <select
                className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={newType}
                onChange={(e) => setNewType(e.target.value as "docs" | "code")}
              >
                <option value="docs">{st("brains.typeDocs")}</option>
                <option value="code">{st("brains.typeCode")}</option>
              </select>
            </label>
            <label className="mb-2 block text-xs text-text-subtle">
              {st("brains.scope")}
              <select
                className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as "global" | "private")}
              >
                <option value="global">{st("brains.scopeGlobal")}</option>
                <option value="private">{st("brains.scopePrivate")}</option>
              </select>
            </label>
            {newScope === "private" ? (
              <label className="mb-3 block text-xs text-text-subtle">
                {st("brains.owner")}
                {avatars.length > 0 ? (
                  <select
                    className="mt-1 w-full rounded border border-border bg-surface-panel px-2 py-1.5 text-sm"
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value)}
                  >
                    <option value="">{st("brains.pickOwner")}</option>
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
                {st("brains.cancel")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)]"
                onClick={() => void handleCreate()}
              >
                {st("brains.create")}
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
