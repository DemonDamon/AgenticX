import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe2, Lock, Users } from "lucide-react";
import { useAppStore } from "../../../store";
import type { createBrainsApi, BrainRecord } from "./api";
import { BRAIN_SCOPE_GLOBAL_BADGE, BRAIN_SCOPE_PRIVATE_BADGE } from "./brainScopeUi";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type ScopeMode = "global" | "private";

export type BrainScopePanelHandle = {
  isDirty: () => boolean;
  flushIfDirty: () => Promise<{ ok: boolean; error?: string }>;
  discardChanges: () => void;
};

type Props = {
  brain: BrainRecord;
  brainsApi: ReturnType<typeof createBrainsApi>;
  onUpdated: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function scopeLabel(scope: string): string {
  return scope === "private" ? st("brains.scopePrivateLong") : st("brains.scopeGlobalLong");
}

function typeLabel(type: string): string {
  return type === "code" ? st("brains.typeCodeLong") : st("brains.typeDocsLong");
}

export const BrainScopePanel = forwardRef<BrainScopePanelHandle, Props>(function BrainScopePanel(
  { brain, brainsApi, onUpdated, onDirtyChange },
  ref,
) {
  const { t } = useTranslation("settings");
  const avatars = useAppStore((s) => s.avatars);
  const [scopeMode, setScopeMode] = useState<ScopeMode>(
    brain.scope === "private" ? "private" : "global",
  );
  const [ownerId, setOwnerId] = useState(String(brain.owner_avatar_id || ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isDefaultDocs = brain.id === "default_docs";
  const persistedScope: ScopeMode = brain.scope === "private" ? "private" : "global";
  const persistedOwner = String(brain.owner_avatar_id || "");

  useEffect(() => {
    setScopeMode(brain.scope === "private" ? "private" : "global");
    setOwnerId(String(brain.owner_avatar_id || ""));
    setMsg(null);
  }, [brain.id, brain.scope, brain.owner_avatar_id]);

  const ownerName = useMemo(() => {
    if (!ownerId) return null;
    return avatars.find((a) => a.id === ownerId)?.name ?? ownerId;
  }, [avatars, ownerId]);

  const dirty =
    !isDefaultDocs &&
    (scopeMode !== persistedScope ||
      (scopeMode === "private" && ownerId.trim() !== persistedOwner));

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const saveVisibility = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (isDefaultDocs || !dirty) return { ok: true };
    setBusy(true);
    setMsg(null);
    try {
      if (scopeMode === "private" && !ownerId.trim()) {
        const err = st("brains.pickOwnerRequired");
        setMsg(err);
        return { ok: false, error: err };
      }
      await brainsApi.patchBrain(brain.id, {
        scope: scopeMode,
        owner_avatar_id: scopeMode === "private" ? ownerId.trim() : null,
      });
      setMsg(st("brains.scopeUpdated"));
      onUpdated();
      return { ok: true };
    } catch (exc) {
      const err = String((exc as Error).message ?? exc);
      setMsg(err);
      return { ok: false, error: err };
    } finally {
      setBusy(false);
    }
  }, [brain.id, brainsApi, dirty, isDefaultDocs, onUpdated, ownerId, scopeMode]);

  const discardChanges = useCallback(() => {
    setScopeMode(persistedScope);
    setOwnerId(persistedOwner);
    setMsg(null);
  }, [persistedOwner, persistedScope]);

  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => dirty,
      flushIfDirty: saveVisibility,
      discardChanges,
    }),
    [dirty, discardChanges, saveVisibility],
  );

  const scopeBadgeClass =
    persistedScope === "global" ? BRAIN_SCOPE_GLOBAL_BADGE : BRAIN_SCOPE_PRIVATE_BADGE;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-surface-panel via-surface-card to-surface-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${scopeBadgeClass}`}
            >
              {persistedScope === "global" ? (
                <Globe2 className="h-3.5 w-3.5 text-[var(--brain-scope-global-icon)]" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-[var(--brain-scope-private-icon)]" />
              )}
              {scopeLabel(persistedScope)}
            </span>
            <span className="rounded-full bg-[var(--brain-scope-type-bg)] px-2 py-0.5 text-[11px] text-[var(--brain-scope-type-fg)]">
              {typeLabel(brain.type)}
            </span>
            {brain.enabled ? (
              <span className="rounded-full bg-[var(--brain-scope-enabled-bg)] px-2 py-0.5 text-[11px] text-[var(--brain-scope-enabled-fg)]">
                {st("brains.enabled")}
              </span>
            ) : (
              <span className="rounded-full bg-[var(--brain-scope-type-bg)] px-2 py-0.5 text-[11px] text-[var(--brain-scope-type-fg)]">
                {st("brains.disabled")}
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            {persistedScope === "global" ? (
              <>
                {st("brains.metaDefault")}
              </>
            ) : (
              <>
                {st("brains.ownerOnly")}
                <strong className="mx-1 font-medium text-text-primary">
                  {ownerName || persistedOwner || st("brains.unspecified")}
                </strong>
                {st("brains.ownerOnlyHint")}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mx-4 h-px bg-[var(--border-muted)]" aria-hidden="true" />

      {isDefaultDocs ? (
        <div className="px-4 py-3 text-xs text-text-muted">
          {st("brains.systemFixedGlobal")}
        </div>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <div className="text-xs font-medium text-text-subtle">{st("brains.adjustScope")}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setScopeMode("global")}
              className={`rounded-lg border px-3 py-3 text-left transition ${
                scopeMode === "global"
                  ? "border-[var(--brain-scope-global-ring)] bg-[var(--brain-scope-global-bg)] ring-1 ring-[var(--brain-scope-global-ring)]"
                  : "border-border bg-surface-panel/60 hover:border-text-subtle/40 hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Globe2 className="h-4 w-4 text-[var(--brain-scope-global-icon)]" />
                {st("brains.scopeGlobalLong")}
              </div>
              <p className="mt-1 text-xs leading-snug text-text-muted">
                {st("brains.globalVisibleHint")}
              </p>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setScopeMode("private")}
              className={`rounded-lg border px-3 py-3 text-left transition ${
                scopeMode === "private"
                  ? "border-[var(--brain-scope-private-ring)] bg-[var(--brain-scope-private-bg)] ring-1 ring-[var(--brain-scope-private-ring)]"
                  : "border-border bg-surface-panel/60 hover:border-text-subtle/40 hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Lock className="h-4 w-4 text-[var(--brain-scope-private-icon)]" />
                {st("brains.scopePrivateLong")}
              </div>
              <p className="mt-1 text-xs leading-snug text-text-muted">
                {st("brains.privateVisibleHint")}
              </p>
            </button>
          </div>

          {scopeMode === "private" ? (
            <label className="block text-xs text-text-subtle">
              <span className="mb-1.5 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-text-muted" />
                {st("brains.owner")}
              </span>
              {avatars.length > 0 ? (
                <select
                  className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">{st("brains.pickAvatar")}</option>
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}（{a.id.slice(0, 8)}…）
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  placeholder="avatar_id"
                  disabled={busy}
                />
              )}
            </label>
          ) : null}

          {msg && msg !== st("brains.scopeUpdated") ? (
            <p className="text-xs text-[var(--status-error)]">{msg}</p>
          ) : null}
        </div>
      )}
    </section>
  );
});
