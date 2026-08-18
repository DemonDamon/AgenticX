import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { Avatar, GroupChat } from "../store";
import { useAppStore } from "../store";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";

/** Resolved on confirm: either an existing session or avatar/group/meta to wake via createSession. */
export type ForwardConfirmPayload =
  | { type: "session"; sessionId: string; avatarId?: string | null; displayName?: string }
  | { type: "meta"; forceNewSession?: boolean }
  | { type: "avatar"; avatarId: string; displayName: string; forceNewSession?: boolean }
  | { type: "group"; groupId: string; displayName: string; forceNewSession?: boolean };

type ForwardPickerProps = {
  open: boolean;
  currentSessionId: string;
  currentAvatarId?: string | null;
  avatars: Avatar[];
  groups: GroupChat[];
  onClose: () => void;
  onConfirm: (payload: ForwardConfirmPayload, followUpNote: string) => Promise<void> | void;
};

type ForwardRow = {
  key: string;
  title: string;
  subtitle: string;
  /** Kept for search; not always shown. */
  sessionId?: string;
  payload: ForwardConfirmPayload;
};

type ForwardTargetItem = {
  key: string;
  title: string;
  subtitle: string;
  avatarUrl?: string;
  /** Empty string = meta-agent (主智能体). */
  avatarContextId: string;
  kind: "meta" | "expert" | "group";
  newPayload: ForwardConfirmPayload;
};

function payloadKey(payload: ForwardConfirmPayload): string {
  if (payload.type === "session") return `s:${payload.sessionId}`;
  if (payload.type === "meta") return `m:${payload.forceNewSession ? "new" : "reuse"}`;
  if (payload.type === "avatar") return `a:${payload.avatarId}:${payload.forceNewSession ? "new" : "reuse"}`;
  return `g:${payload.groupId}:${payload.forceNewSession ? "new" : "reuse"}`;
}

function isMetaSessionRow(avatarId: unknown): boolean {
  return String(avatarId ?? "").trim().length === 0;
}

/** Display helper: "今天 14:32" / "昨天 10:18" / "7月23日". */
function formatRelativeSessionTime(updatedAt: number): string {
  const raw = Number(updatedAt);
  if (!Number.isFinite(raw) || raw <= 0) return "";
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThat) / 86_400_000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `昨天 ${hm}`;
  if (dayDiff === 2) return `前天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function TargetAvatar({
  title,
  avatarUrl,
  squared,
}: {
  title: string;
  avatarUrl?: string;
  squared?: boolean;
}) {
  const shape = squared ? "rounded-[6px]" : "rounded-full";
  if (avatarUrl) {
    return <img src={avatarUrl} alt={title} className={`h-6 w-6 shrink-0 ${shape} object-cover`} />;
  }
  return (
    <div
      className={`flex h-6 w-6 shrink-0 items-center justify-center ${shape} bg-surface-card-strong text-[10px] font-semibold text-text-strong`}
    >
      {title.slice(0, 1) || "?"}
    </div>
  );
}

export function ForwardPicker({
  open,
  currentSessionId,
  currentAvatarId,
  avatars,
  groups,
  onClose,
  onConfirm,
}: ForwardPickerProps) {
  const metaAvatarUrl = useAppStore((s) => s.metaAvatarUrl);
  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const [sessionRows, setSessionRows] = useState<ForwardRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string>("");
  const [selectedPayload, setSelectedPayload] = useState<ForwardConfirmPayload | null>(null);
  const [followUpNote, setFollowUpNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastTargetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSessionSearch("");
      setSelectedTargetKey(null);
      setSessionRows([]);
      setSessionsLoading(false);
      setSessionsError("");
      setSelectedPayload(null);
      setFollowUpNote("");
      setSubmitting(false);
      lastTargetKeyRef.current = null;
    }
  }, [open]);

  const targetItems = useMemo<ForwardTargetItem[]>(() => {
    const metaRow: ForwardTargetItem = {
      key: "meta",
      title: META_AGENT_DISPLAY_NAME,
      subtitle: "主智能体",
      avatarUrl: metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL,
      avatarContextId: "",
      kind: "meta",
      newPayload: { type: "meta", forceNewSession: true },
    };
    const avatarRows: ForwardTargetItem[] = avatars.map((avatar) => ({
      key: `avatar:${avatar.id}`,
      title: avatar.name,
      subtitle: "专家",
      avatarUrl: avatar.avatarUrl || undefined,
      avatarContextId: avatar.id,
      kind: "expert",
      newPayload: { type: "avatar", avatarId: avatar.id, displayName: avatar.name, forceNewSession: true },
    }));
    const groupRows: ForwardTargetItem[] = groups.map((group) => ({
      key: `group:${group.id}`,
      title: group.name,
      subtitle: "群聊",
      avatarContextId: `group:${group.id}`,
      kind: "group",
      newPayload: { type: "group", groupId: group.id, displayName: group.name, forceNewSession: true },
    }));
    return [metaRow, ...avatarRows, ...groupRows];
  }, [avatars, groups, metaAvatarUrl]);

  const primaryTargets = useMemo(
    () => targetItems.filter((item) => item.kind !== "group"),
    [targetItems]
  );
  const groupTargets = useMemo(
    () => targetItems.filter((item) => item.kind === "group"),
    [targetItems]
  );

  const selectedTarget = useMemo(
    () => targetItems.find((item) => item.key === selectedTargetKey) ?? null,
    [selectedTargetKey, targetItems]
  );

  useEffect(() => {
    if (!open || selectedTargetKey) return;
    const preferred =
      (currentAvatarId
        ? targetItems.find((item) => item.avatarContextId === currentAvatarId)
        : targetItems.find((item) => item.key === "meta")) ??
      targetItems[0] ??
      null;
    if (!preferred) return;
    setSelectedTargetKey(preferred.key);
    setSelectedPayload(preferred.newPayload);
    lastTargetKeyRef.current = preferred.key;
  }, [currentAvatarId, open, selectedTargetKey, targetItems]);

  useEffect(() => {
    if (!open || !selectedTarget) return;
    if (lastTargetKeyRef.current !== selectedTarget.key) {
      setSelectedPayload(selectedTarget.newPayload);
      setSessionSearch("");
      lastTargetKeyRef.current = selectedTarget.key;
    }
  }, [open, selectedTarget]);

  useEffect(() => {
    if (!open || !selectedTarget) return;
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError("");
    setSessionRows([]);
    const listArg = selectedTarget.avatarContextId || undefined;
    void window.agenticxDesktop
      .listSessions(listArg)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setSessionsError("读取历史会话失败，请稍后重试");
          return;
        }
        const isMetaTarget = selectedTarget.key === "meta";
        const targetAvatarId = isMetaTarget ? null : selectedTarget.avatarContextId;
        const rows = (result.sessions || [])
          .filter((row) => !row.archived)
          .filter((row) => {
            const aid = String(row.avatar_id ?? "").trim();
            if (isMetaTarget) return isMetaSessionRow(aid);
            return aid === String(targetAvatarId ?? "").trim();
          })
          .filter((row) => String(row.session_id || "").trim() && String(row.session_id || "").trim() !== currentSessionId)
          .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
          .map<ForwardRow>((row) => {
            const sid = String(row.session_id || "").trim();
            return {
              key: `session:${sid}`,
              title: String(row.session_name || "").trim() || "未命名会话",
              subtitle: formatRelativeSessionTime(Number(row.updated_at || 0)),
              sessionId: sid,
              payload: {
                type: "session",
                sessionId: sid,
                avatarId: isMetaTarget ? null : selectedTarget.avatarContextId,
                displayName: selectedTarget.title,
              },
            };
          });
        setSessionRows(rows);
      })
      .catch(() => {
        if (!cancelled) setSessionsError("读取历史会话失败，请稍后重试");
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSessionId, open, selectedTarget]);

  const sessionQuery = sessionSearch.trim().toLowerCase();
  const filteredSessionRows = sessionQuery
    ? sessionRows.filter(
        (row) =>
          row.title.toLowerCase().includes(sessionQuery) ||
          (row.sessionId || "").toLowerCase().includes(sessionQuery) ||
          row.subtitle.toLowerCase().includes(sessionQuery)
      )
    : sessionRows;

  if (!open) return null;

  const newSessionActive =
    !!selectedTarget &&
    !!selectedPayload &&
    payloadKey(selectedPayload) === payloadKey(selectedTarget.newPayload);

  const renderTargetRow = (target: ForwardTargetItem) => {
    const active = selectedTargetKey === target.key;
    return (
      <button
        key={target.key}
        type="button"
        onClick={() => setSelectedTargetKey(target.key)}
        className={
          "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition " +
          (active
            ? "bg-black/[0.05] [html[data-theme=dark]_&]:bg-white/[0.07] [html[data-theme=dim]_&]:bg-white/[0.07]"
            : "hover:bg-black/[0.03] [html[data-theme=dark]_&]:hover:bg-white/[0.04] [html[data-theme=dim]_&]:hover:bg-white/[0.04]")
        }
      >
        {active ? (
          <span
            aria-hidden
            className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-[rgb(var(--theme-color-rgb))]"
          />
        ) : null}
        <TargetAvatar title={target.title} avatarUrl={target.avatarUrl} squared={target.kind === "group"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text-strong">{target.title}</div>
          <div className="truncate text-[11px] text-text-faint">{target.subtitle}</div>
        </div>
      </button>
    );
  };

  const renderSessionChoice = (opts: {
    key: string;
    title: string;
    subtitle?: string;
    active: boolean;
    onClick: () => void;
  }) => {
    return (
      <button
        key={opts.key}
        type="button"
        onClick={opts.onClick}
        className={
          "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left outline-none transition " +
          (opts.active
            ? "bg-black/[0.05] [html[data-theme=dark]_&]:bg-white/[0.07] [html[data-theme=dim]_&]:bg-white/[0.07]"
            : "hover:bg-black/[0.03] [html[data-theme=dark]_&]:hover:bg-white/[0.04] [html[data-theme=dim]_&]:hover:bg-white/[0.04]")
        }
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-text-strong">{opts.title}</div>
          {opts.subtitle ? (
            <div className="mt-0.5 truncate text-[11px] text-text-faint">{opts.subtitle}</div>
          ) : null}
        </div>
        {opts.active ? (
          <Check
            className="h-4 w-4 shrink-0 text-[rgb(var(--theme-color-fg-rgb))]"
            strokeWidth={2.25}
            aria-hidden
          />
        ) : null}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(600px,70vh)] w-full max-w-[900px] flex-col overflow-hidden rounded-[20px] border border-border shadow-2xl"
        style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative px-5 pb-3 pt-4">
          <div className="pr-8 text-[15px] font-semibold text-text-strong">转发到</div>
          <div className="mt-1 text-xs text-text-faint">选择一个对象，再决定新会话或继续历史会话</div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
            aria-label="关闭"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)] overflow-hidden border-t border-border">
          {/* Left: targets */}
          <div className="min-h-0 overflow-y-auto border-r border-border px-2 py-3">
            <div className="mb-1.5 px-2 text-[11px] font-medium tracking-wide text-text-faint">对象</div>
            <div className="space-y-0.5">
              {primaryTargets.length > 0 ? primaryTargets.map(renderTargetRow) : null}
              {groupTargets.length > 0 ? (
                <>
                  <div className="my-2 border-t border-border" />
                  {groupTargets.map(renderTargetRow)}
                </>
              ) : null}
              {targetItems.length === 0 ? (
                <div className="px-2 text-xs text-text-faint">暂无可用目标</div>
              ) : null}
            </div>
          </div>

          {/* Right: sessions — search + rows share the same horizontal padding / width */}
          <div className="flex min-h-0 flex-col overflow-hidden px-3 py-3">
            <div className="relative mb-2 shrink-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
                disabled={!selectedTarget}
                className={
                  "h-9 w-full rounded-[10px] border-0 bg-black/[0.04] pl-9 pr-3 text-[13px] text-text-primary outline-none " +
                  "placeholder:text-text-faint disabled:opacity-50 " +
                  "[html[data-theme=dark]_&]:bg-white/[0.06] [html[data-theme=dim]_&]:bg-white/[0.06] " +
                  "focus:ring-2 focus:ring-[rgba(var(--theme-color-rgb),0.28)]"
                }
                placeholder="搜索历史会话"
              />
            </div>

            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {selectedTarget
                ? renderSessionChoice({
                    key: `new:${selectedTarget.key}`,
                    title: "在新会话中继续",
                    active: newSessionActive,
                    onClick: () => setSelectedPayload(selectedTarget.newPayload),
                  })
                : null}

              {selectedTarget && (sessionsLoading || filteredSessionRows.length > 0 || sessionsError) ? (
                <div className="my-1.5 border-t border-border" />
              ) : null}

              {sessionsLoading ? <div className="px-3 py-2 text-xs text-text-faint">正在加载历史会话...</div> : null}
              {!sessionsLoading && sessionsError ? (
                <div className="px-3 py-2 text-xs text-amber-500">{sessionsError}</div>
              ) : null}
              {!sessionsLoading && !sessionsError
                ? filteredSessionRows.map((row) =>
                    renderSessionChoice({
                      key: row.key,
                      title: row.title,
                      subtitle: row.subtitle || undefined,
                      active: !!selectedPayload && payloadKey(selectedPayload) === payloadKey(row.payload),
                      onClick: () => setSelectedPayload(row.payload),
                    })
                  )
                : null}
              {!sessionsLoading && !sessionsError && selectedTarget && sessionRows.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-faint">该目标暂无可继续的历史会话</div>
              ) : null}
              {!sessionsLoading &&
              !sessionsError &&
              selectedTarget &&
              sessionRows.length > 0 &&
              filteredSessionRows.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-faint">没有匹配的历史会话</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-5 py-3">
          <input
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            placeholder="补充一句说明（选填）"
            className={
              "h-9 min-w-0 flex-1 rounded-[10px] border-0 bg-black/[0.04] px-3 text-[13px] text-text-primary outline-none " +
              "placeholder:text-text-faint " +
              "[html[data-theme=dark]_&]:bg-white/[0.06] [html[data-theme=dim]_&]:bg-white/[0.06] " +
              "focus:ring-2 focus:ring-[rgba(var(--theme-color-rgb),0.28)]"
            }
          />
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[13px] text-text-faint transition hover:text-text-strong"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selectedPayload || submitting}
            className="shrink-0 rounded-[10px] bg-[var(--ui-btn-primary-bg)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:opacity-50"
            onClick={async () => {
              if (!selectedPayload) return;
              setSubmitting(true);
              try {
                await onConfirm(selectedPayload, followUpNote);
                onClose();
              } catch {
                // Parent may throw; keep dialog open for retry
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "转发中..." : "确认转发"}
          </button>
        </div>
      </div>
    </div>
  );
}
