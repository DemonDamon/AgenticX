import { useEffect, useMemo, useRef, useState } from "react";
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
  avatarUrl?: string;
  payload: ForwardConfirmPayload;
};

type ForwardTargetItem = {
  key: string;
  title: string;
  subtitle: string;
  avatarUrl?: string;
  /** Empty string = meta-agent (主智能体). */
  avatarContextId: string;
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

function TargetAvatar({ title, avatarUrl }: { title: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={title} className="h-7 w-7 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-card-strong text-[11px] font-semibold text-text-strong">
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
      newPayload: { type: "meta", forceNewSession: true },
    };
    const avatarRows: ForwardTargetItem[] = avatars.map((avatar) => ({
      key: `avatar:${avatar.id}`,
      title: avatar.name,
      subtitle: "专家",
      avatarUrl: avatar.avatarUrl || undefined,
      avatarContextId: avatar.id,
      newPayload: { type: "avatar", avatarId: avatar.id, displayName: avatar.name, forceNewSession: true },
    }));
    const groupRows: ForwardTargetItem[] = groups.map((group) => ({
      key: `group:${group.id}`,
      title: group.name,
      subtitle: "群聊",
      avatarContextId: `group:${group.id}`,
      newPayload: { type: "group", groupId: group.id, displayName: group.name, forceNewSession: true },
    }));
    return [metaRow, ...avatarRows, ...groupRows];
  }, [avatars, groups, metaAvatarUrl]);

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
              subtitle: `session: ${sid}`,
              avatarUrl: selectedTarget.avatarUrl,
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
          row.subtitle.toLowerCase().includes(sessionQuery)
      )
    : sessionRows;

  if (!open) return null;

  const rowBase =
    "flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs transition outline-none";
  const rowInactive = "border-border bg-surface-panel text-text-subtle hover:bg-surface-hover";
  /** 与设置面板侧栏选中态一致：浅色用深色描边，深色/暗灰用浅色描边 */
  const rowActive =
    "[html[data-theme=light]_&]:border-neutral-900/45 [html[data-theme=light]_&]:bg-neutral-900/[0.06] " +
    "[html[data-theme=dark]_&]:border-white/35 [html[data-theme=dark]_&]:bg-white/[0.06] " +
    "[html[data-theme=dim]_&]:border-white/35 [html[data-theme=dim]_&]:bg-white/[0.06] " +
    "text-text-strong";

  const renderSelectableRow = (row: {
    key: string;
    title: string;
    subtitle: string;
    avatarUrl?: string;
    onClick: () => void;
    active: boolean;
  }) => {
    return (
      <button
        key={row.key}
        type="button"
        onClick={row.onClick}
        className={`${rowBase} ${row.active ? rowActive : rowInactive}`}
      >
        <TargetAvatar title={row.title} avatarUrl={row.avatarUrl} />
        <div className="min-w-0">
          <div className="truncate text-sm text-text-strong">{row.title}</div>
          <div className="truncate text-[11px] text-text-faint">{row.subtitle}</div>
        </div>
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-none"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
        style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-text-strong">选择转发目标</div>
          <div className="mt-1 text-xs text-text-faint">
            先在左侧点选主智能体/专家/群聊，再在右侧选择新会话或搜索并继续历史会话。
          </div>
        </div>
        <div className="grid flex-1 min-h-0 grid-cols-2 gap-3 overflow-hidden p-4">
          <div className="min-h-0 overflow-y-auto">
            <div className="mb-2 text-xs font-medium text-text-muted">主智能体 / 专家 / 群聊</div>
            <div className="space-y-2">
              {targetItems.length > 0 ? (
                targetItems.map((target) =>
                  renderSelectableRow({
                    key: target.key,
                    title: target.title,
                    subtitle: target.subtitle,
                    avatarUrl: target.avatarUrl,
                    onClick: () => setSelectedTargetKey(target.key),
                    active: selectedTargetKey === target.key,
                  })
                )
              ) : (
                <div className="text-xs text-text-faint">暂无可用目标</div>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="mb-2 text-xs font-medium text-text-muted">
              {selectedTarget ? `${selectedTarget.title} · 历史会话` : "历史会话"}
            </div>
            <input
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              disabled={!selectedTarget}
              className={
                "mb-2 h-9 w-full shrink-0 rounded-lg border border-border bg-surface-card px-3 text-sm text-text-primary outline-none placeholder:text-text-faint disabled:opacity-50 " +
                "focus:ring-2 focus:ring-offset-0 focus:ring-neutral-900/15 [html[data-theme=light]_&]:focus:border-neutral-900/55 " +
                "[html[data-theme=dark]_&]:focus:border-white/45 [html[data-theme=dark]_&]:focus:ring-white/12 " +
                "[html[data-theme=dim]_&]:focus:border-white/45 [html[data-theme=dim]_&]:focus:ring-white/12"
              }
              placeholder="搜索历史会话标题或 session id"
            />
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {selectedTarget
                ? renderSelectableRow({
                    key: `new:${selectedTarget.key}`,
                    title: "在新会话中继续",
                    subtitle: "默认新建一个会话并自动发送转发内容",
                    avatarUrl: selectedTarget.avatarUrl,
                    onClick: () => setSelectedPayload(selectedTarget.newPayload),
                    active:
                      !!selectedPayload && payloadKey(selectedPayload) === payloadKey(selectedTarget.newPayload),
                  })
                : null}
              {sessionsLoading ? <div className="text-xs text-text-faint">正在加载历史会话...</div> : null}
              {!sessionsLoading && sessionsError ? <div className="text-xs text-amber-400">{sessionsError}</div> : null}
              {!sessionsLoading && !sessionsError
                ? filteredSessionRows.map((row) =>
                    renderSelectableRow({
                      key: row.key,
                      title: row.title,
                      subtitle: row.subtitle,
                      avatarUrl: row.avatarUrl,
                      onClick: () => setSelectedPayload(row.payload),
                      active:
                        !!selectedPayload && payloadKey(selectedPayload) === payloadKey(row.payload),
                    })
                  )
                : null}
              {!sessionsLoading && !sessionsError && selectedTarget && sessionRows.length === 0 ? (
                <div className="text-xs text-text-faint">该目标暂无可继续的历史会话</div>
              ) : null}
              {!sessionsLoading &&
              !sessionsError &&
              selectedTarget &&
              sessionRows.length > 0 &&
              filteredSessionRows.length === 0 ? (
                <div className="text-xs text-text-faint">没有匹配的历史会话</div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="border-t border-border px-4 py-2">
          <div className="mb-1 text-xs font-medium text-text-muted">可补充一句说明（选填）</div>
          <textarea
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            rows={2}
            placeholder="例如：你怎么看？"
            className={
              "w-full resize-none rounded-lg border border-border bg-surface-card px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-faint " +
              "focus:ring-2 focus:ring-offset-0 focus:ring-neutral-900/15 [html[data-theme=light]_&]:focus:border-neutral-900/55 " +
              "[html[data-theme=dark]_&]:focus:border-white/45 [html[data-theme=dark]_&]:focus:ring-white/12 " +
              "[html[data-theme=dim]_&]:focus:border-white/45 [html[data-theme=dim]_&]:focus:ring-white/12"
            }
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selectedPayload || submitting}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover)]"
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
