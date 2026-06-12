import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "../ds/Button";
import { Modal } from "../ds/Modal";
import { Panel } from "../ds/Panel";
import {
  createWorkspaceEntry,
  deleteWorkspaceEntriesBatch,
  deleteWorkspaceEntry,
  fetchWorkspaceMemory,
  updateWorkspaceEntry,
} from "./memory-graph-api";
import type { WorkspaceMemoryEntry, WorkspaceMemorySection } from "./memory-graph-types";

/** Fallback when MEMORY.md has no sections yet; matches loader.MEMORY_TEMPLATE. */
const FALLBACK_SECTION = "User Anchors";

type Props = {
  apiBase: string;
  apiToken: string;
};

type PendingDelete = { section: string; index: number; text: string } | null;

const entryKey = (section: string, index: number) => `${section}::${index}`;

function parseEntryKey(key: string): { section: string; index: number } | null {
  const sep = key.lastIndexOf("::");
  if (sep <= 0) return null;
  const section = key.slice(0, sep);
  const index = Number.parseInt(key.slice(sep + 2), 10);
  if (!section || Number.isNaN(index)) return null;
  return { section, index };
}

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
  const [editChildrenText, setEditChildrenText] = useState("");
  const [editingHasChildren, setEditingHasChildren] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());

  const sectionNames = useMemo(() => sections.map((s) => s.section), [sections]);

  const allEntryKeys = useMemo(
    () =>
      sections.flatMap((group) =>
        group.entries.map((entry) => entryKey(group.section, entry.index)),
      ),
    [sections],
  );

  const selectedCount = selectedKeys.size;

  const expandSectionsWithEntries = useCallback(() => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      for (const group of sections) {
        if (group.entries.length > 0) next.add(group.section);
      }
      return next;
    });
  }, [sections]);

  const enterSelectMode = () => {
    expandSectionsWithEntries();
    setSelectMode(true);
    setSelectedKeys(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  };

  const beginEdit = (section: string, key: string, entry: WorkspaceMemoryEntry) => {
    setExpandedSections((prev) => new Set(prev).add(section));
    if (selectMode) exitSelectMode();
    setEditingKey(key);
    setEditText(entry.text);
    setEditChildrenText((entry.children ?? []).join("\n"));
    setEditingHasChildren((entry.children?.length ?? 0) > 0);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditText("");
    setEditChildrenText("");
    setEditingHasChildren(false);
  };

  const formatEntryPreview = (entry: WorkspaceMemoryEntry) => {
    if (!entry.children?.length) return entry.text;
    return `${entry.text}\n${entry.children.map((child) => `  - ${child}`).join("\n")}`;
  };

  const toggleEntrySelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSectionSelect = (group: WorkspaceMemorySection) => {
    const keys = group.entries.map((entry) => entryKey(group.section, entry.index));
    const allSelected = keys.length > 0 && keys.every((key) => selectedKeys.has(key));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const key of keys) next.delete(key);
      } else {
        for (const key of keys) next.add(key);
      }
      return next;
    });
  };

  const sectionSelectionState = (group: WorkspaceMemorySection): "none" | "partial" | "all" => {
    if (group.entries.length === 0) return "none";
    const selectedInSection = group.entries.filter((entry) =>
      selectedKeys.has(entryKey(group.section, entry.index)),
    ).length;
    if (selectedInSection === 0) return "none";
    if (selectedInSection === group.entries.length) return "all";
    return "partial";
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

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
      setExpandedSections((prev) => new Set(prev).add(section));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失败");
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (section: string, index: number) => {
    if (editingHasChildren) {
      const parentText = editText.trim();
      const children = editChildrenText
        .split("\n")
        .map((line) => line.replace(/^[-*]\s+/, "").trim())
        .filter(Boolean);
      if (!parentText || children.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        await updateWorkspaceEntry(apiBase, apiToken, section, index, parentText, children);
        cancelEdit();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setBusy(false);
      }
      return;
    }
    const text = editText.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await updateWorkspaceEntry(apiBase, apiToken, section, index, text);
      cancelEdit();
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

  const onConfirmBatchDelete = async () => {
    if (selectedKeys.size === 0) return;
    const entries = Array.from(selectedKeys)
      .map((key) => parseEntryKey(key))
      .filter((item): item is { section: string; index: number } => item != null);
    if (entries.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWorkspaceEntriesBatch(apiBase, apiToken, entries);
      setPendingBatchDelete(false);
      exitSelectMode();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量删除失败");
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
    <div className="flex flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3">
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

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-text-strong">记忆列表</h3>
            <span className="rounded-md border border-border bg-surface-card px-2 py-0.5 text-[10px] font-medium text-text-muted">
              长期记忆
            </span>
            <span className="text-[10px] text-text-faint">{totalEntries} 条</span>
            {totalEntries > 0 ? (
              selectMode ? (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-text-muted">已选 {selectedCount} 条</span>
                  <button
                    type="button"
                    disabled={busy || allEntryKeys.length === 0}
                    onClick={() => setSelectedKeys(new Set(allEntryKeys))}
                    className="text-[10px] text-text-muted transition hover:text-text-strong disabled:opacity-50"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedKeys(new Set())}
                    className="text-[10px] text-text-muted transition hover:text-text-strong disabled:opacity-50"
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    disabled={busy || selectedCount === 0}
                    onClick={() => setPendingBatchDelete(true)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-status-error transition hover:bg-status-error/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    删除所选
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={exitSelectMode}
                    className="text-[10px] text-text-muted transition hover:text-text-strong disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={enterSelectMode}
                  className="ml-auto text-[10px] text-text-muted transition hover:text-text-strong disabled:opacity-50"
                  title="勾选多条后批量删除；单条仍可用右侧编辑/删除"
                >
                  批量管理
                </button>
              )
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
            长期记忆写入 MEMORY.md，跨会话保留并参与对话侧文本检索；日记类短期记忆在 memory/ 目录，不在此列表展示。
            {selectMode ? " 勾选多条后可一次性删除。" : ""}
          </p>
        </div>
      </div>

      <div>
        {totalEntries === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-text-subtle">暂无长期记忆条目</p>
            <p className="max-w-sm text-xs leading-relaxed text-text-faint">
              展开上方「新增记忆」添加内容后会写入 MEMORY.md，并参与 memory_search 检索。
            </p>
            {path ? <p className="text-[10px] text-text-faint break-all">{path}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            {selectMode ? (
              <div
                className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-panel/95 px-3 py-2 backdrop-blur-sm"
              >
                <span className="text-[11px] font-medium text-text-strong">批量选择</span>
                <span className="text-[10px] text-text-muted">已选 {selectedCount} 条</span>
                <button
                  type="button"
                  disabled={busy || selectedCount === 0}
                  onClick={() => setPendingBatchDelete(true)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-status-error transition hover:bg-status-error/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  删除所选
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={exitSelectMode}
                  className="ml-auto text-[10px] text-text-muted transition hover:text-text-strong disabled:opacity-50"
                >
                  完成
                </button>
              </div>
            ) : null}
            {sections.map((group) => {
              const expanded =
                expandedSections.has(group.section) ||
                selectMode ||
                (editingKey != null &&
                  group.entries.some((entry) => entryKey(group.section, entry.index) === editingKey));
              const sectionSelect = sectionSelectionState(group);
              return (
              <section key={group.section} className="rounded-md border border-border bg-surface-card">
                <header className={expanded ? "border-b border-[var(--border-muted)]" : ""}>
                  <div className="flex w-full items-center gap-1.5 px-3 py-2">
                    {selectMode ? (
                      <input
                        type="checkbox"
                        checked={sectionSelect === "all"}
                        ref={(el) => {
                          if (el) el.indeterminate = sectionSelect === "partial";
                        }}
                        onChange={() => toggleSectionSelect(group)}
                        className="h-3.5 w-3.5 shrink-0 accent-[var(--ui-btn-primary-bg)]"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`选择分组 ${group.section}`}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-text-strong transition hover:text-text-primary"
                      onClick={() => {
                        if (selectMode) {
                          toggleSectionSelect(group);
                          return;
                        }
                        toggleSection(group.section);
                      }}
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform ${expanded ? "" : "-rotate-90"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{group.section}</span>
                      <span className="shrink-0 font-normal text-text-faint">{group.entries.length} 条</span>
                    </button>
                  </div>
                </header>
                {expanded ? (
                <ul className="divide-y divide-[var(--border-muted)]">
                  {group.entries.map((entry) => {
                    const key = entryKey(group.section, entry.index);
                    const isEditing = editingKey === key;
                    const entryContent = (
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary">
                          {entry.text}
                        </p>
                        {entry.children && entry.children.length > 0 ? (
                          <ul className="mt-1.5 space-y-0.5 border-l border-border/50 pl-3">
                            {entry.children.map((child, childIdx) => (
                              <li
                                key={`${key}-child-${childIdx}`}
                                className="text-[11px] leading-relaxed text-text-subtle"
                              >
                                {child}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                    const entryActions = (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="rounded px-1.5 py-1 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                          title="编辑"
                          disabled={busy}
                          onClick={() => beginEdit(group.section, key, entry)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded px-1.5 py-1 text-[10px] text-status-error hover:bg-status-error/10"
                          title="删除"
                          disabled={busy}
                          onClick={() =>
                            setPendingDelete({
                              section: group.section,
                              index: entry.index,
                              text: formatEntryPreview(entry),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                    return (
                      <li key={key} className="px-3 py-2">
                        {selectMode ? (
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(key)}
                              onChange={() => toggleEntrySelect(key)}
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--ui-btn-primary-bg)]"
                              aria-label={`选择 ${entry.text.slice(0, 40)}`}
                            />
                            {entryContent}
                            {entryActions}
                          </div>
                        ) : isEditing ? (
                          <div className="space-y-2">
                            {editingHasChildren ? (
                              <>
                                <p className="text-xs font-medium text-text-strong">{editText}</p>
                                <label className="block text-[10px] text-text-faint">
                                  子项（每行一条）
                                  <textarea
                                    value={editChildrenText}
                                    onChange={(e) => setEditChildrenText(e.target.value)}
                                    rows={Math.max(3, editChildrenText.split("\n").length)}
                                    placeholder="数学/物理理论能力强"
                                    className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary"
                                  />
                                </label>
                              </>
                            ) : (
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={3}
                                className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary"
                              />
                            )}
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" disabled={busy} onClick={cancelEdit}>
                                取消
                              </Button>
                              <Button
                                variant="primary"
                                disabled={
                                  busy ||
                                  (editingHasChildren
                                    ? !editText.trim() ||
                                      !editChildrenText
                                        .split("\n")
                                        .map((line) => line.replace(/^[-*]\s+/, "").trim())
                                        .some(Boolean)
                                    : !editText.trim())
                                }
                                onClick={() => void onSaveEdit(group.section, entry.index)}
                              >
                                保存
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            {entryContent}
                            {entryActions}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                ) : null}
              </section>
            );
            })}
          </div>
        )}

        {path ? (
          <div className="pt-2 text-[10px] text-text-faint break-all">文件：{path}</div>
        ) : null}
      </div>

      <Modal
        open={pendingBatchDelete}
        title="批量删除记忆"
        onClose={() => setPendingBatchDelete(false)}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setPendingBatchDelete(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={busy || selectedCount === 0} onClick={() => void onConfirmBatchDelete()}>
              确认删除 {selectedCount} 条
            </Button>
          </div>
        )}
      >
        <p className="text-sm text-text-primary">
          确定删除已选择的 {selectedCount} 条用户记忆吗？此操作会写回 MEMORY.md，且不可撤销。
        </p>
      </Modal>

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
