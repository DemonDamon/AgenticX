import { useEffect, useMemo, useState } from "react";
import type { Avatar, GroupChat } from "../../store";
import {
  extractUnknownAvatarIdFromError,
  getGroupSaveErrorMessage,
  sanitizeGroupAvatarIds,
} from "../../utils/group-editor-utils";

/**
 * Group create/edit dialog. Extracted verbatim from AvatarSidebar so it can be
 * reused by ProjectsView. `initialName` / `initialAvatarIds` support template
 * pre-fill on the create path.
 */
export function GroupEditorInline({
  avatars,
  initialGroup,
  initialName,
  initialAvatarIds,
  onDelete,
  onClose,
  onSaved,
}: {
  avatars: Avatar[];
  initialGroup?: GroupChat;
  initialName?: string;
  initialAvatarIds?: string[];
  onDelete?: (groupId: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialGroup?.name ?? initialName ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialGroup?.avatarIds ?? initialAvatarIds ?? [])
  );
  const [loading, setLoading] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const validAvatarIds = useMemo(
    () => avatars.map((item) => String(item.id ?? "").trim()).filter(Boolean),
    [avatars]
  );

  useEffect(() => {
    if (validAvatarIds.length === 0) return;
    const current = Array.from(selectedIds);
    const normalized = sanitizeGroupAvatarIds({
      requestedIds: current,
      validAvatarIds,
    });
    if (normalized.removedIds.length === 0) return;
    setSelectedIds(new Set(normalized.avatarIds));
    setSaveNotice({
      type: "warning",
      text: `已自动移除 ${normalized.removedIds.length} 个失效成员，请点击保存同步群成员。`,
    });
  }, [selectedIds, validAvatarIds]);

  const toggle = (id: string) => {
    setSaveNotice(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (validAvatarIds.length === 0) {
      setSaveNotice({ type: "error", text: "分身列表尚未加载完成，请稍后再保存。" });
      return;
    }
    const normalized = sanitizeGroupAvatarIds({
      requestedIds: Array.from(selectedIds),
      validAvatarIds,
    });
    if (normalized.removedIds.length > 0) {
      setSelectedIds(new Set(normalized.avatarIds));
    }
    if (!name.trim() || normalized.avatarIds.length === 0) {
      setSaveNotice({ type: "error", text: "请至少选择 1 个有效分身后再保存。" });
      return;
    }
    setLoading(true);
    setSaveNotice(null);
    try {
      if (initialGroup) {
        const result = await window.agenticxDesktop.updateGroup({
          id: initialGroup.id,
          name: name.trim(),
          avatar_ids: normalized.avatarIds,
          routing: "intelligent",
        });
        if (result.ok) {
          onSaved();
          setSaveNotice({ type: "success", text: "保存成功。" });
        } else {
          const staleId = extractUnknownAvatarIdFromError(result.error);
          if (staleId) {
            setSelectedIds((prev) => {
              if (!prev.has(staleId)) return prev;
              const next = new Set(prev);
              next.delete(staleId);
              return next;
            });
          }
          setSaveNotice({ type: "error", text: getGroupSaveErrorMessage(result.error) });
        }
      } else {
        const result = await window.agenticxDesktop.createGroup({
          name: name.trim(),
          avatar_ids: normalized.avatarIds,
          routing: "intelligent",
        });
        if (result.ok) {
          onSaved();
        } else {
          const staleId = extractUnknownAvatarIdFromError(result.error);
          if (staleId) {
            setSelectedIds((prev) => {
              if (!prev.has(staleId)) return prev;
              const next = new Set(prev);
              next.delete(staleId);
              return next;
            });
          }
          setSaveNotice({ type: "error", text: getGroupSaveErrorMessage(result.error) });
        }
      }
    } catch (err) {
      setSaveNotice({
        type: "error",
        text: err instanceof Error ? err.message : "保存失败，请稍后重试。",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-80 max-w-[95vw] rounded-xl border border-border bg-surface-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-[15px] font-semibold text-white">
          {initialGroup ? "编辑群聊" : "新建群聊"}
        </h3>

        <label className="mb-1 block text-xs text-text-subtle">群名称</label>
        <input
          className="mb-3 w-full rounded-md border border-border bg-surface-card px-2.5 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入群聊名称"
          autoFocus
        />

        <label className="mb-1 block text-xs text-text-subtle">选择分身</label>
        <div className="mb-3 max-h-36 overflow-y-auto rounded-md border border-border bg-surface-card p-1.5">
          {avatars.length === 0 && (
            <div className="py-2 text-center text-xs text-text-faint">暂无可用分身</div>
          )}
          {avatars.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] text-text-muted hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(a.id)}
                onChange={() => toggle(a.id)}
                className="accent-cyan-500"
              />
              <span className="truncate">{a.name}</span>
              {a.role && <span className="ml-auto truncate text-xs text-text-faint">{a.role}</span>}
            </label>
          ))}
        </div>

        {saveNotice ? (
          <div
            className={`mb-3 rounded-md border px-2.5 py-2 text-xs ${
              saveNotice.type === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : saveNotice.type === "warning"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-300"
            }`}
          >
            {saveNotice.text}
          </div>
        ) : null}

        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {initialGroup ? (
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-[13px] text-rose-400 transition hover:bg-rose-500/10"
                onClick={() => {
                  if (!onDelete || !initialGroup) return;
                  void onDelete(initialGroup.id);
                }}
              >
                删除群聊
              </button>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-[13px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
              disabled={!name.trim() || selectedIds.size === 0 || loading}
              onClick={() => void handleSave()}
            >
              {loading ? "保存中..." : initialGroup ? "保存" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
