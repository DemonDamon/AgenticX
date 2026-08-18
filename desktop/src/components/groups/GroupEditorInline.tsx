import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, UsersRound, X } from "lucide-react";
import type { Avatar, GroupChat } from "../../store";
import {
  extractUnknownAvatarIdFromError,
  getGroupSaveErrorMessage,
  sanitizeGroupAvatarIds,
} from "../../utils/group-editor-utils";
import { GroupMemberAvatar } from "./GroupMemberAvatar";

type Notice = { type: "success" | "error" | "warning"; text: string };

/**
 * Group settings surface.
 *
 * Members are managed as individual rows: adding is an explicit「加入」action
 * and removing is an explicit action on that member. The group itself has a
 * separate destructive action in the footer, so deleting the group can never
 * be confused with selecting members to remove.
 */
export function GroupEditorInline({
  avatars,
  initialGroup,
  onDelete,
  onClose,
  onSaved,
}: {
  avatars: Avatar[];
  initialGroup?: GroupChat;
  onDelete?: (groupId: string) => Promise<boolean | undefined>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialGroup?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>(initialGroup?.avatarIds ?? []);
  const [memberQuery, setMemberQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveNotice, setSaveNotice] = useState<Notice | null>(null);

  const validAvatarIds = useMemo(
    () => avatars.map((item) => String(item.id ?? "").trim()).filter(Boolean),
    [avatars],
  );
  const avatarById = useMemo(
    () => new Map(avatars.map((avatar) => [avatar.id, avatar] as const)),
    [avatars],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMembers = useMemo(
    () => selectedIds.map((id) => ({ id, avatar: avatarById.get(id) })).filter((item) => item.avatar),
    [avatarById, selectedIds],
  );
  const availableMembers = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase();
    return avatars.filter((avatar) => {
      if (selectedSet.has(avatar.id)) return false;
      if (!query) return true;
      return (
        avatar.name.toLocaleLowerCase().includes(query) ||
        avatar.role.toLocaleLowerCase().includes(query) ||
        (avatar.description ?? "").toLocaleLowerCase().includes(query)
      );
    });
  }, [avatars, memberQuery, selectedSet]);

  useEffect(() => {
    if (validAvatarIds.length === 0) return;
    const normalized = sanitizeGroupAvatarIds({
      requestedIds: selectedIds,
      validAvatarIds,
    });
    if (normalized.removedIds.length === 0) return;
    setSelectedIds(normalized.avatarIds);
    setSaveNotice({
      type: "warning",
      text: `已隐藏 ${normalized.removedIds.length} 个失效成员，请保存后同步群聊。`,
    });
  }, [selectedIds, validAvatarIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading && !deleting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, loading, onClose]);

  const addMember = (id: string) => {
    setSaveNotice(null);
    setSelectedIds((current) => (current.includes(id) ? current : [...current, id]));
  };

  const removeMember = (id: string) => {
    setSaveNotice(null);
    setSelectedIds((current) => current.filter((item) => item !== id));
  };

  const handleSave = async () => {
    if (loading || deleting) return;
    if (validAvatarIds.length === 0) {
      setSaveNotice({ type: "error", text: "数字专家列表尚未加载完成，请稍后再保存。" });
      return;
    }

    const normalized = sanitizeGroupAvatarIds({
      requestedIds: selectedIds,
      validAvatarIds,
    });
    if (normalized.removedIds.length > 0) setSelectedIds(normalized.avatarIds);
    if (!name.trim()) {
      setSaveNotice({ type: "error", text: "请先填写群聊名称。" });
      return;
    }
    if (normalized.avatarIds.length === 0) {
      setSaveNotice({ type: "error", text: "请至少加入 1 位成员后再保存。" });
      return;
    }

    setLoading(true);
    setSaveNotice(null);
    const routing = initialGroup?.routing?.trim() || "intelligent";
    try {
      const result = initialGroup
        ? await window.agenticxDesktop.updateGroup({
            id: initialGroup.id,
            name: name.trim(),
            avatar_ids: normalized.avatarIds,
            routing,
          })
        : await window.agenticxDesktop.createGroup({
            name: name.trim(),
            avatar_ids: normalized.avatarIds,
            routing: "intelligent",
          });

      if (result.ok) {
        setSaveNotice({ type: "success", text: initialGroup ? "群聊设置已保存。" : "群聊已创建。" });
        onSaved();
        return;
      }

      const staleId = extractUnknownAvatarIdFromError(result.error);
      if (staleId) removeMember(staleId);
      setSaveNotice({ type: "error", text: getGroupSaveErrorMessage(result.error) });
    } catch (error) {
      setSaveNotice({
        type: "error",
        text: error instanceof Error ? error.message : "保存失败，请稍后重试。",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!initialGroup || !onDelete || loading || deleting) return;
    setDeleting(true);
    setSaveNotice(null);
    try {
      const result = await onDelete(initialGroup.id);
      if (result === false) {
        setSaveNotice({ type: "error", text: "删除群聊失败，请稍后重试。" });
      }
    } catch (error) {
      setSaveNotice({
        type: "error",
        text: error instanceof Error ? error.message : "删除群聊失败，请稍后重试。",
      });
    } finally {
      setDeleting(false);
    }
  };

  const isBusy = loading || deleting;
  const title = initialGroup ? "群聊设置" : "新建群聊";

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-editor-title"
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-[min(860px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[rgba(var(--theme-color-rgb,59,130,246),0.14)] text-[rgb(var(--theme-color-fg-rgb,59,130,246))]">
            <UsersRound className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="group-editor-title" className="text-base font-semibold text-text-strong">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-text-faint">
              {initialGroup ? "调整群聊名称和成员组成" : "先命名群聊，再加入需要协作的成员"}
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full bg-surface-card px-2.5 py-1 text-[11px] text-text-subtle sm:inline-flex">
            {selectedIds.length} 位成员 · 自动协作
          </span>
          <button
            type="button"
            className="agx-topbar-btn agx-topbar-btn--icon-only shrink-0"
            aria-label="关闭群聊设置"
            title="关闭"
            disabled={isBusy}
            onClick={onClose}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1.12fr)_minmax(260px,0.88fr)] md:overflow-hidden">
          <section className="min-h-0 overflow-y-auto px-5 py-5 md:border-r md:border-border">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-text-subtle">群聊名称</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaveNotice(null);
                }}
                placeholder="例如：产品需求全流程"
                autoFocus
                disabled={isBusy}
                className="w-full rounded-xl border border-border bg-surface-card px-3.5 py-3 text-[15px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-[rgba(var(--theme-color-rgb,59,130,246),0.6)] focus:ring-2 focus:ring-[rgba(var(--theme-color-rgb,59,130,246),0.12)] disabled:opacity-60"
              />
            </label>

            <div className="mt-6 flex items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-strong">群成员</h3>
                  <span className="rounded-full bg-surface-card px-2 py-0.5 text-[11px] tabular-nums text-text-subtle">
                    {selectedMembers.length}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-faint">
                  每位成员都可以单独移出；删除整个群聊请使用底部的危险操作。
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {selectedMembers.length === 0 ? (
                <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-card/45 px-4 text-center">
                  <UsersRound className="h-7 w-7 text-text-faint" strokeWidth={1.5} aria-hidden />
                  <p className="mt-2 text-sm text-text-muted">还没有群成员</p>
                  <p className="mt-1 text-xs text-text-faint">从右侧选择数字专家加入群聊</p>
                </div>
              ) : (
                selectedIds.map((id) => {
                  const avatar = avatarById.get(id);
                  const label = avatar?.name || "失效成员";
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-3 py-2.5 transition hover:border-border-strong"
                    >
                      <GroupMemberAvatar avatar={avatar} label={label} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">{label}</div>
                        <div className="mt-0.5 truncate text-xs text-text-faint">
                          {avatar?.role || (avatar ? "数字专家" : "该成员已不存在")}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isBusy}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-faint transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                        aria-label={`移出成员 ${label}`}
                        title={`移出 ${label}`}
                        onClick={() => removeMember(id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                        <span className="hidden sm:inline">移出</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {saveNotice ? (
              <div
                role={saveNotice.type === "error" ? "alert" : "status"}
                className={`mt-4 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
                  saveNotice.type === "success"
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                    : saveNotice.type === "warning"
                      ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
                      : "border-rose-500/35 bg-rose-500/10 text-rose-300"
                }`}
              >
                {saveNotice.text}
              </div>
            ) : null}
          </section>

          <aside className="min-h-0 bg-surface-card/35 px-5 py-5 md:overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text-strong">添加成员</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-faint">点击「加入」即可加入当前群聊。</p>
              </div>
              <Plus className="mt-0.5 h-4 w-4 text-text-faint" strokeWidth={1.8} aria-hidden />
            </div>
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" strokeWidth={1.8} aria-hidden />
              <input
                type="search"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="搜索名称或职责"
                disabled={isBusy}
                className="w-full rounded-lg border border-border bg-surface-panel py-2 pl-9 pr-3 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong disabled:opacity-60"
              />
            </label>

            <div className="mt-3 space-y-1.5">
              {validAvatarIds.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs leading-relaxed text-text-faint">
                  数字专家列表尚未加载完成
                </div>
              ) : availableMembers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs leading-relaxed text-text-faint">
                  {memberQuery.trim() ? "没有匹配的可加入成员" : "所有数字专家都已加入"}
                </div>
              ) : (
                availableMembers.map((avatar) => (
                  <div
                    key={avatar.id}
                    className="flex items-center gap-2.5 rounded-xl border border-transparent px-2 py-2 transition hover:border-border hover:bg-surface-panel"
                  >
                    <GroupMemberAvatar avatar={avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-text-primary">{avatar.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-text-faint">{avatar.role || "数字专家"}</div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[rgba(var(--theme-color-rgb,59,130,246),0.12)] px-2 py-1.5 text-[11px] font-medium text-[rgb(var(--theme-color-fg-rgb,59,130,246))] transition hover:bg-[rgba(var(--theme-color-rgb,59,130,246),0.2)] disabled:opacity-40"
                      onClick={() => addMember(avatar.id)}
                    >
                      <Plus className="h-3 w-3" strokeWidth={2} aria-hidden />
                      加入
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <div className="min-w-0">
            {initialGroup && onDelete ? (
              <button
                type="button"
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-40"
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {deleting ? "删除中…" : "删除群聊"}
              </button>
            ) : (
              <span className="hidden text-xs text-text-faint sm:inline">群聊创建后可继续调整成员</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              className="rounded-lg px-3.5 py-2 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              disabled={isBusy || !name.trim() || selectedIds.length === 0}
              className="rounded-lg bg-[var(--ui-btn-primary-bg)] px-4 py-2 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void handleSave()}
            >
              {loading ? "保存中…" : initialGroup ? "保存更改" : "创建群聊"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
