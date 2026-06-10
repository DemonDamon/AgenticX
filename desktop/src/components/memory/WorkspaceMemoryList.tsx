import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "../ds/Button";
import { Modal } from "../ds/Modal";
import { Panel } from "../ds/Panel";
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  fetchWorkspaceMemory,
  updateWorkspaceEntry,
} from "./memory-graph-api";
import type { WorkspaceMemorySection } from "./memory-graph-types";

/** Fallback when MEMORY.md has no sections yet; matches loader.MEMORY_TEMPLATE. */
const FALLBACK_SECTION = "User Anchors";

type Props = {
  apiBase: string;
  apiToken: string;
};

type PendingDelete = { section: string; index: number; text: string } | null;

export function WorkspaceMemoryList({ apiBase, apiToken }: Props) {
  const [sections, setSections] = useState<WorkspaceMemorySection[]>([]);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupPick, setGroupPick] = useState(FALLBACK_SECTION);
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newText, setNewText] = useState("");
  const newGroupInputId = useId();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  const sectionNames = useMemo(() => sections.map((s) => s.section), [sections]);

  useEffect(() => {
    if (isNewGroup) return;
    setGroupPick((prev) => {
      if (sectionNames.includes(prev)) return prev;
      if (sectionNames.length > 0) return sectionNames[0];
      return FALLBACK_SECTION;
    });
  }, [sectionNames, isNewGroup]);

  const resolvedSection = isNewGroup ? newGroupName.trim() : groupPick.trim() || FALLBACK_SECTION;

  const reload = useCallback(async () => {
    if (!apiBase.trim()) {
      setError("后端未连接");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const doc = await fetchWorkspaceMemory(apiBase, apiToken);
      setSections(doc.sections);
      setPath(doc.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载用户记忆失败");
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const entryKey = (section: string, index: number) => `${section}::${index}`;

  const onCreate = async () => {
    const text = newText.trim();
    const section = resolvedSection;
    if (!text || !section || !apiBase.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createWorkspaceEntry(apiBase, apiToken, section, text);
      setNewText("");
      setIsNewGroup(false);
      setNewGroupName("");
      setGroupPick(section);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失败");
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (section: string, index: number) => {
    const text = editText.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await updateWorkspaceEntry(apiBase, apiToken, section, index, text);
      setEditingKey(null);
      setEditText("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWorkspaceEntry(apiBase, apiToken, pendingDelete.section, pendingDelete.index);
      setPendingDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const totalEntries = sections.reduce((sum, sec) => sum + sec.entries.length, 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-text-subtle">
        加载用户记忆…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <Panel title="新增记忆" collapsible defaultCollapsed={totalEntries > 0}>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-1 text-[11px] text-text-faint">
            <div className="flex items-center justify-between gap-2">
              <span>分组</span>
              {!isNewGroup ? (
                <button
                  type="button"
                  className="shrink-0 text-[10px] text-text-muted transition hover:text-text-strong"
                  onClick={() => {
                    setIsNewGroup(true);
                    setNewGroupName("");
                  }}
                >
                  + 新建分组
                </button>
              ) : (
                <button
                  type="button"
                  className="shrink-0 text-[10px] text-text-muted transition hover:text-text-strong"
                  onClick={() => {
                    setIsNewGroup(false);
                    setNewGroupName("");
                  }}
                >
                  取消
                </button>
              )}
            </div>
            {isNewGroup ? (
              <input
                id={newGroupInputId}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newText.trim() && newGroupName.trim()) void onCreate();
                }}
                placeholder="输入新分组名，如「工作偏好」"
                autoFocus
                className="w-full min-w-0 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary"
              />
            ) : (
              <select
                value={groupPick}
                onChange={(e) => setGroupPick(e.target.value)}
                className="w-full min-w-0 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary"
              >
                {(sectionNames.length > 0 ? sectionNames : [FALLBACK_SECTION]).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <span className="text-[10px] leading-relaxed text-text-faint">
              {isNewGroup
                ? "保存首条记忆后会在 MEMORY.md 中创建对应的 ## 分组标题。"
                : "分组对应 MEMORY.md 中的 ## 标题；也可点「新建分组」添加。"}
            </span>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-text-faint">
            内容
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreate();
              }}
              placeholder="输入长期记忆内容…"
              className="w-full min-w-0 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary"
            />
          </label>
          <button
            type="button"
            disabled={busy || !newText.trim() || !resolvedSection}
            onClick={() => void onCreate()}
            className="inline-flex w-fit items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--ui-btn-primary-bg)", color: "var(--ui-btn-primary-text)" }}
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>
      </Panel>

      {error ? (
        <div className="rounded-md bg-status-error/10 px-3 py-2 text-[11px] text-status-error">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-panel/60 p-2">
        {totalEntries === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-text-subtle">暂无用户记忆条目</p>
            <p className="max-w-sm text-xs leading-relaxed text-text-faint">
              上方添加内容后会写入 MEMORY.md，并参与对话侧文本记忆检索。
            </p>
            {path ? <p className="text-[10px] text-text-faint break-all">{path}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            {sections.map((group) => (
              <section key={group.section} className="rounded-md border border-border bg-surface-card">
                <header className="border-b border-[var(--border-muted)] px-3 py-2 text-xs font-semibold text-text-strong">
                  {group.section}
                  <span className="ml-2 font-normal text-text-faint">{group.entries.length} 条</span>
                </header>
                <ul className="divide-y divide-[var(--border-muted)]">
                  {group.entries.map((entry) => {
                    const key = entryKey(group.section, entry.index);
                    const isEditing = editingKey === key;
                    return (
                      <li key={key} className="px-3 py-2">
                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={3}
                              className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" disabled={busy} onClick={() => setEditingKey(null)}>
                                取消
                              </Button>
                              <Button
                                variant="primary"
                                disabled={busy || !editText.trim()}
                                onClick={() => void onSaveEdit(group.section, entry.index)}
                              >
                                保存
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary">
                              {entry.text}
                            </p>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                className="rounded px-1.5 py-1 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                                title="编辑"
                                onClick={() => {
                                  setEditingKey(key);
                                  setEditText(entry.text);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded px-1.5 py-1 text-[10px] text-status-error hover:bg-status-error/10"
                                title="删除"
                                onClick={() =>
                                  setPendingDelete({
                                    section: group.section,
                                    index: entry.index,
                                    text: entry.text,
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {path ? (
        <div className="text-[10px] text-text-faint break-all">文件：{path}</div>
      ) : null}

      <Modal
        open={pendingDelete != null}
        title="删除记忆"
        onClose={() => setPendingDelete(null)}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void onConfirmDelete()}>
              确认删除
            </Button>
          </div>
        )}
      >
        <p className="text-sm text-text-primary">确定删除这条用户记忆吗？此操作会写回 MEMORY.md。</p>
        {pendingDelete ? (
          <p className="mt-2 rounded-md border border-border bg-surface-panel p-2 text-xs text-text-subtle break-words">
            {pendingDelete.text}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
