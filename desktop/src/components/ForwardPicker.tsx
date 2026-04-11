import { useEffect, useMemo, useState } from "react";
import type { Avatar, ChatPane, GroupChat } from "../store";

/** Resolved on confirm: either an existing session or avatar/group to wake via createSession. */
export type ForwardConfirmPayload =
  | { type: "session"; sessionId: string }
  | { type: "avatar"; avatarId: string; displayName: string }
  | { type: "group"; groupId: string; displayName: string };

type ForwardPickerProps = {
  open: boolean;
  currentSessionId: string;
  panes: ChatPane[];
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

function payloadKey(payload: ForwardConfirmPayload): string {
  if (payload.type === "session") return `s:${payload.sessionId}`;
  if (payload.type === "avatar") return `a:${payload.avatarId}`;
  return `g:${payload.groupId}`;
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
  panes,
  avatars,
  groups,
  onClose,
  onConfirm,
}: ForwardPickerProps) {
  const [search, setSearch] = useState("");
  const [selectedPayload, setSelectedPayload] = useState<ForwardConfirmPayload | null>(null);
  const [followUpNote, setFollowUpNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedPayload(null);
      setFollowUpNote("");
      setSubmitting(false);
    }
  }, [open]);

  const recentTargets = useMemo<ForwardRow[]>(() => {
    const seen = new Set<string>();
    const rows: ForwardRow[] = [];
    for (const pane of panes) {
      const sessionId = String(pane.sessionId || "").trim();
      if (!sessionId || sessionId === currentSessionId || seen.has(sessionId)) continue;
      seen.add(sessionId);
      rows.push({
        key: `pane:${sessionId}`,
        title: pane.avatarName || "会话",
        subtitle: `session: ${sessionId}`,
        payload: { type: "session", sessionId },
      });
    }
    return rows;
  }, [currentSessionId, panes]);

  const avatarTargets = useMemo<ForwardRow[]>(() => {
    return avatars.map((avatar) => {
      const pane = panes.find((item) => item.avatarId === avatar.id && String(item.sessionId || "").trim());
      const sessionId = String(pane?.sessionId || "").trim();
      const payload: ForwardConfirmPayload = sessionId
        ? { type: "session", sessionId }
        : { type: "avatar", avatarId: avatar.id, displayName: avatar.name };
      return {
        key: `avatar:${avatar.id}`,
        title: avatar.name,
        subtitle: sessionId ? `分身会话: ${sessionId}` : "未打开会话，确认后将创建并打开",
        avatarUrl: avatar.avatarUrl || undefined,
        payload,
      };
    });
  }, [avatars, panes]);

  const groupTargets = useMemo<ForwardRow[]>(() => {
    return groups.map((group) => {
      const groupAvatarId = `group:${group.id}`;
      const pane = panes.find((item) => item.avatarId === groupAvatarId && String(item.sessionId || "").trim());
      const sessionId = String(pane?.sessionId || "").trim();
      const payload: ForwardConfirmPayload = sessionId
        ? { type: "session", sessionId }
        : { type: "group", groupId: group.id, displayName: group.name };
      return {
        key: `group:${group.id}`,
        title: group.name,
        subtitle: sessionId ? `群聊会话: ${sessionId}` : "未打开会话，确认后将创建并打开",
        payload,
      };
    });
  }, [groups, panes]);

  const lowered = search.trim().toLowerCase();
  const applyFilter = (rows: ForwardRow[]) =>
    lowered
      ? rows.filter((row) => {
          const sid =
            row.payload.type === "session"
              ? row.payload.sessionId
              : row.payload.type === "avatar"
                ? row.payload.avatarId
                : row.payload.groupId;
          return (
            row.title.toLowerCase().includes(lowered) ||
            row.subtitle.toLowerCase().includes(lowered) ||
            String(sid || "").toLowerCase().includes(lowered)
          );
        })
      : rows;
  const filteredRecent = applyFilter(recentTargets);
  const filteredAvatars = applyFilter(avatarTargets);
  const filteredGroups = applyFilter(groupTargets);

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

  const renderTarget = (target: ForwardRow) => {
    const active = !!selectedPayload && payloadKey(selectedPayload) === payloadKey(target.payload);
    return (
      <button
        key={target.key}
        type="button"
        onClick={() => setSelectedPayload(target.payload)}
        className={`${rowBase} ${active ? rowActive : rowInactive}`}
      >
        <TargetAvatar title={target.title} avatarUrl={target.avatarUrl} />
        <div className="min-w-0">
          <div className="truncate text-sm text-text-strong">{target.title}</div>
          <div className="truncate text-[11px] text-text-faint">{target.subtitle}</div>
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
            支持已打开会话、分身与群聊。未打开的分身/群聊会在确认时自动创建会话并打开对应窗格（类似微信「发送给」）。
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={
              "mt-2 h-9 w-full rounded-lg border border-border bg-surface-card px-3 text-sm text-text-primary outline-none placeholder:text-text-faint " +
              "focus:ring-2 focus:ring-offset-0 focus:ring-neutral-900/15 [html[data-theme=light]_&]:focus:border-neutral-900/55 " +
              "[html[data-theme=dark]_&]:focus:border-white/45 [html[data-theme=dark]_&]:focus:ring-white/12 " +
              "[html[data-theme=dim]_&]:focus:border-white/45 [html[data-theme=dim]_&]:focus:ring-white/12"
            }
            placeholder="搜索名称 / session id"
          />
        </div>
        <div className="grid flex-1 min-h-0 grid-cols-2 gap-3 overflow-hidden p-4">
          <div className="min-h-0 overflow-y-auto">
            <div className="mb-2 text-xs font-medium text-text-muted">最近会话</div>
            <div className="space-y-2">
              {filteredRecent.length > 0 ? filteredRecent.map(renderTarget) : <div className="text-xs text-text-faint">暂无可选会话</div>}
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto">
            <div className="mb-2 text-xs font-medium text-text-muted">分身 / 群聊</div>
            <div className="space-y-2">
              {filteredAvatars.map(renderTarget)}
              {filteredGroups.map(renderTarget)}
              {filteredAvatars.length === 0 && filteredGroups.length === 0 ? (
                <div className="text-xs text-text-faint">暂无匹配目标</div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="border-t border-border px-4 py-2">
          <div className="mb-1 text-xs font-medium text-text-muted">附加说明（可选）</div>
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
