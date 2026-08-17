import { useMemo, useState } from "react";
import { useAppStore, type Avatar, type Message } from "../../store";
import { avatarBgClass, avatarFgClass } from "../../utils/avatar-color";
import {
  groupMemberActivityTitle,
  resolveGroupMemberActivity,
  type GroupMemberActivity,
} from "../../utils/group-member-activity";

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

const AVATAR_SIZE = 36;
const NAME_CLASS = "text-[10px]";

/**
 * Inline group members strip for task-summary Section「成员」.
 * Add / remove stay in-panel (no separate WorkPanel tab).
 */
function activityDotClass(state: GroupMemberActivity["state"]): string {
  if (state === "running") return "bg-[var(--status-warning)]";
  if (state === "replied") return "bg-[var(--status-success)]";
  return "border border-current bg-transparent text-text-faint";
}

export function GroupMembersSummaryList({
  groupId,
  avatarList,
  metaLeaderLabel,
  messages = [],
  activeAgentIds = [],
}: {
  groupId: string;
  avatarList: Avatar[];
  metaLeaderLabel: string;
  messages?: Array<Pick<Message, "role" | "agentId" | "toolName" | "timestamp">>;
  activeAgentIds?: string[];
}) {
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const group = groups.find((g) => g.id === groupId);

  const [mode, setMode] = useState<"browse" | "add" | "remove">("browse");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [dialogChecked, setDialogChecked] = useState<Set<string>>(new Set());
  const [dialogSearch, setDialogSearch] = useState("");

  const avatarById = useMemo(() => {
    const map = new Map<string, Avatar>();
    for (const item of avatarList) map.set(item.id, item);
    return map;
  }, [avatarList]);

  const dialogCandidates = useMemo(() => {
    if (mode !== "add" || !group) return [];
    const existing = new Set(group.avatarIds);
    const q = dialogSearch.trim().toLowerCase();
    return avatarList.filter((a) => {
      if (existing.has(a.id)) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
    });
  }, [mode, group, avatarList, dialogSearch]);

  const activityById = useMemo(
    () => resolveGroupMemberActivity(messages, group?.avatarIds ?? [], activeAgentIds),
    [messages, group?.avatarIds, activeAgentIds],
  );
  const executedCount = useMemo(() => {
    let n = 0;
    for (const item of activityById.values()) {
      if (item.state !== "idle") n += 1;
    }
    return n;
  }, [activityById]);

  if (!group) {
    return <p className="text-xs text-text-faint">未找到该群配置，可在侧栏刷新群列表后重试。</p>;
  }

  const persistMembers = async (nextAvatarIds: string[]) => {
    if (saving) return;
    setSaving(true);
    setErrorText("");
    const prevAvatarIds = group.avatarIds;
    setGroups(
      groups.map((item) => (item.id === group.id ? { ...item, avatarIds: nextAvatarIds } : item)),
    );
    try {
      const res = await window.agenticxDesktop.updateGroup({
        id: group.id,
        avatar_ids: nextAvatarIds,
      });
      if (!res.ok) {
        throw new Error(res.error || "更新群成员失败");
      }
    } catch (err) {
      setGroups(
        groups.map((item) => (item.id === group.id ? { ...item, avatarIds: prevAvatarIds } : item)),
      );
      setErrorText(err instanceof Error ? err.message : "更新群成员失败");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = (avatarId: string) => {
    if (!group.avatarIds.includes(avatarId)) return;
    void persistMembers(group.avatarIds.filter((id) => id !== avatarId));
  };

  const openAddDialog = () => {
    setDialogChecked(new Set());
    setDialogSearch("");
    setMode("add");
  };

  const handleDialogConfirm = () => {
    if (dialogChecked.size === 0) return;
    void persistMembers([...group.avatarIds, ...Array.from(dialogChecked)]);
    setMode("browse");
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-faint">
        本会话已执行 {executedCount}/{group.avatarIds.length}
      </p>
      {errorText ? <p className="text-[10px] text-rose-300">{errorText}</p> : null}
      {mode === "remove" ? (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-rose-300">点击成员头像移出群聊</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setMode("browse")}
          >
            完成
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-3 gap-y-2.5">
        <div className="flex w-[52px] flex-col items-center gap-1 text-center">
          <div
            className="flex shrink-0 items-center justify-center rounded-xl text-[10px] font-bold leading-tight"
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              background: "var(--ui-btn-primary-bg)",
              color: "var(--ui-btn-primary-text)",
            }}
          >
            {memberInitials(metaLeaderLabel)}
          </div>
          <span
            className={`w-full truncate text-text-muted ${NAME_CLASS}`}
            title={`${metaLeaderLabel} · 群聊协调者`}
          >
            {metaLeaderLabel}
          </span>
        </div>

        {group.avatarIds.map((id) => {
          const a = avatarById.get(id);
          const label = a?.name ?? id.slice(0, 6);
          const activity = activityById.get(id);
          const statusTitle = activity ? groupMemberActivityTitle(activity) : "未执行";
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (mode === "remove") handleRemoveMember(id);
              }}
              disabled={saving}
              className={`relative flex w-[52px] flex-col items-center gap-1 text-center transition ${
                mode === "remove" ? "cursor-pointer hover:opacity-90" : "cursor-default"
              } disabled:opacity-60`}
            >
              <div
                className="relative shrink-0"
                style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
              >
                {a?.avatarUrl ? (
                  <img
                    src={a.avatarUrl}
                    alt=""
                    className="h-full w-full rounded-xl object-cover"
                  />
                ) : (
                  <div
                    className={`flex h-full w-full items-center justify-center rounded-xl text-[10px] font-bold ${avatarBgClass(a?.color)} ${avatarFgClass(a?.color)}`}
                  >
                    {memberInitials(label)}
                  </div>
                )}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ${activityDotClass(activity?.state ?? "idle")}`}
                  title={statusTitle}
                />
              </div>
              <span
                className={`w-full truncate text-text-muted ${NAME_CLASS}`}
                title={`${label}${a?.role ? ` · ${a.role}` : ""} · ${statusTitle}`}
              >
                {label}
              </span>
              {mode === "remove" ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold leading-none text-white shadow">
                  −
                </span>
              ) : null}
            </button>
          );
        })}

        <div className="flex w-[52px] flex-col items-center gap-1 text-center">
          <button
            type="button"
            onClick={openAddDialog}
            disabled={saving}
            className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            title="添加成员"
          >
            +
          </button>
          <span className={`text-text-muted ${NAME_CLASS}`}>添加</span>
        </div>
        <div className="flex w-[52px] flex-col items-center gap-1 text-center">
          <button
            type="button"
            onClick={() => setMode((prev) => (prev === "remove" ? "browse" : "remove"))}
            disabled={saving || group.avatarIds.length === 0}
            className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            title="移出成员"
          >
            −
          </button>
          <span className={`text-text-muted ${NAME_CLASS}`}>移出</span>
        </div>
      </div>

      {mode === "add" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setMode("browse")}
        >
          <div
            className="flex h-[480px] w-[520px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-text-strong">添加群成员</span>
              <span className="text-xs text-text-faint">
                {dialogChecked.size > 0 ? `已选 ${dialogChecked.size} 人` : ""}
              </span>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 flex-1 flex-col border-r border-border">
                <div className="shrink-0 px-3 py-2">
                  <input
                    type="search"
                    value={dialogSearch}
                    onChange={(e) => setDialogSearch(e.target.value)}
                    placeholder="搜索"
                    autoFocus
                    className="w-full rounded-lg border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                  {dialogCandidates.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-text-faint">
                      {dialogSearch.trim() ? "无匹配结果" : "所有分身都已在群里"}
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {dialogCandidates.map((a) => {
                        const checked = dialogChecked.has(a.id);
                        return (
                          <label
                            key={a.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition hover:bg-surface-hover"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setDialogChecked((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(a.id)) next.delete(a.id);
                                  else next.add(a.id);
                                  return next;
                                });
                              }}
                              className="h-4 w-4 shrink-0 accent-[var(--ui-btn-primary-bg)]"
                            />
                            {a.avatarUrl ? (
                              <img
                                src={a.avatarUrl}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <div
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${avatarBgClass(a.color)} ${avatarFgClass(a.color)}`}
                              >
                                {memberInitials(a.name || a.id)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs text-text-primary">
                                {a.name || a.id}
                              </div>
                              {a.role ? (
                                <div className="truncate text-[10px] text-text-faint">{a.role}</div>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex w-[160px] shrink-0 flex-col bg-surface-card">
                <div className="shrink-0 px-3 py-2">
                  <span className="text-[11px] text-text-faint">已选成员</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2">
                  {dialogChecked.size === 0 ? (
                    <p className="px-1 text-[11px] text-text-faint">勾选左侧分身</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {Array.from(dialogChecked).map((id) => {
                        const a = avatarById.get(id);
                        const label = a?.name ?? id.slice(0, 6);
                        return (
                          <div key={id} className="flex items-center gap-2 rounded-md px-1 py-1">
                            {a?.avatarUrl ? (
                              <img
                                src={a.avatarUrl}
                                alt=""
                                className="h-7 w-7 shrink-0 rounded-md object-cover"
                              />
                            ) : (
                              <div
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${avatarBgClass(a?.color)} ${avatarFgClass(a?.color)}`}
                              >
                                {memberInitials(label)}
                              </div>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
                              {label}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 text-xs text-text-faint transition hover:text-rose-400"
                              onClick={() =>
                                setDialogChecked((prev) => {
                                  const n = new Set(prev);
                                  n.delete(id);
                                  return n;
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => setMode("browse")}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--ui-btn-primary-bg)] px-4 py-1.5 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:opacity-50"
                disabled={dialogChecked.size === 0 || saving}
                onClick={handleDialogConfirm}
              >
                添加{dialogChecked.size > 0 ? ` (${dialogChecked.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
