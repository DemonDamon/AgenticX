import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, Lock, Loader2, Users } from "lucide-react";
import { useAppStore } from "../../../store";
import type { createBrainsApi, BrainRecord } from "./api";

type ScopeMode = "global" | "private";

type Props = {
  brain: BrainRecord;
  brainsApi: ReturnType<typeof createBrainsApi>;
  onUpdated: () => void;
};

function scopeLabel(scope: string): string {
  return scope === "private" ? "分身专属" : "全局可见";
}

function typeLabel(type: string): string {
  return type === "code" ? "代码库" : "文档库";
}

export function BrainScopePanel({ brain, brainsApi, onUpdated }: Props) {
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

  const saveVisibility = useCallback(async () => {
    if (isDefaultDocs) return;
    setBusy(true);
    setMsg(null);
    try {
      if (scopeMode === "private" && !ownerId.trim()) {
        setMsg("请选择所属分身");
        return;
      }
      await brainsApi.patchBrain(brain.id, {
        scope: scopeMode,
        owner_avatar_id: scopeMode === "private" ? ownerId.trim() : null,
      });
      setMsg("可见范围已更新");
      onUpdated();
    } catch (exc) {
      setMsg(String((exc as Error).message ?? exc));
    } finally {
      setBusy(false);
    }
  }, [brain.id, brainsApi, isDefaultDocs, onUpdated, ownerId, scopeMode]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-surface-panel via-surface-card to-surface-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                persistedScope === "global"
                  ? "bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/25"
                  : "bg-amber-500/12 text-amber-100 ring-1 ring-amber-400/25"
              }`}
            >
              {persistedScope === "global" ? (
                <Globe2 className="h-3.5 w-3.5" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              {scopeLabel(persistedScope)}
            </span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-faint">
              {typeLabel(brain.type)}
            </span>
            {brain.enabled ? (
              <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] text-emerald-300">
                已启用
              </span>
            ) : (
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-faint">
                已关闭
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-text-faint">
            {persistedScope === "global" ? (
              <>
                <strong className="font-medium text-text-subtle">Meta</strong> 默认可用；分身默认挂载全局脑，也可在分身设置中勾选挂载。
              </>
            ) : (
              <>
                仅所属分身
                <strong className="mx-1 font-medium text-text-subtle">
                  {ownerName || persistedOwner || "（未指定）"}
                </strong>
                及其挂载策略可见；<strong className="font-medium text-text-subtle">Meta 默认看不到</strong>。
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mx-4 h-px bg-[var(--border-muted)]" aria-hidden="true" />

      {isDefaultDocs ? (
        <div className="px-4 py-3 text-xs text-text-faint">
          系统默认文档库固定为全局可见，不可改为分身专属。
        </div>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-faint">调整可见范围</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setScopeMode("global")}
              className={`rounded-lg border px-3 py-3 text-left transition ${
                scopeMode === "global"
                  ? "border-violet-400/40 bg-violet-500/10 ring-1 ring-violet-400/30"
                  : "border-border bg-surface-panel/60 hover:border-text-faint/30 hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Globe2 className="h-4 w-4 text-violet-300" />
                全局可见
              </div>
              <p className="mt-1 text-[11px] leading-snug text-text-faint">
                Machi（Meta）与分身均可检索；适合团队共享资料与代码库。
              </p>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setScopeMode("private")}
              className={`rounded-lg border px-3 py-3 text-left transition ${
                scopeMode === "private"
                  ? "border-amber-400/40 bg-amber-500/10 ring-1 ring-amber-400/30"
                  : "border-border bg-surface-panel/60 hover:border-text-faint/30 hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Lock className="h-4 w-4 text-amber-200" />
                分身专属
              </div>
              <p className="mt-1 text-[11px] leading-snug text-text-faint">
                仅绑定的一个分身默认可见；Meta 不会自动挂载此脑。
              </p>
            </button>
          </div>

          {scopeMode === "private" ? (
            <label className="block text-xs text-text-subtle">
              <span className="mb-1.5 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-text-faint" />
                所属分身
              </span>
              {avatars.length > 0 ? (
                <select
                  className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">请选择分身…</option>
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}（{a.id.slice(0, 8)}…）
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  placeholder="avatar_id"
                  disabled={busy}
                />
              )}
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !dirty}
              className="rounded-lg bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] disabled:opacity-40"
              onClick={() => void saveVisibility()}
            >
              {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
              保存可见范围
            </button>
            {dirty ? (
              <span className="text-[11px] text-amber-200/90">有未保存的可见范围变更</span>
            ) : null}
            {msg ? (
              <span
                className={`text-[11px] ${msg.includes("已更新") ? "text-emerald-300" : "text-rose-300"}`}
              >
                {msg}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
