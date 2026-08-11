import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type Avatar } from "../../store";
import { createResizeRafScheduler } from "../../utils/resize-raf";

const MEMBER_PALETTE = [
  "bg-cyan-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-fuchsia-600",
];

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function memberColorClass(id: string): string {
  let h = 0;
  for (const ch of id) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return MEMBER_PALETTE[Math.abs(h) % MEMBER_PALETTE.length]!;
}

export const MembersTabPanel = memo(function MembersTabPanel({
  groupId,
  avatarList,
  metaLeaderLabel,
}: {
  groupId: string;
  avatarList: Avatar[];
  /** Meta-Agent pane title; shown as group coordinator in member grid. */
  metaLeaderLabel: string;
}) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"browse" | "add" | "remove">("browse");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const group = groups.find((g) => g.id === groupId);

  useEffect(() => {
    if (!panelRef.current) return;
    const target = panelRef.current;
    const update = () => setPanelWidth(target.clientWidth);
    const { schedule, cancel } = createResizeRafScheduler(update);
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, []);

  const avatarById = useMemo(() => {
    const map = new Map<string, Avatar>();
    for (const item of avatarList) map.set(item.id, item);
    return map;
  }, [avatarList]);

  const showMetaAgent = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const label = metaLeaderLabel.trim().toLowerCase();
    return (
      "meta-agent".includes(q) ||
      "meta agent".includes(q) ||
      "元智能体".includes(q) ||
      "组长".includes(q) ||
      (label.length > 0 && label.includes(q))
    );
  }, [search, metaLeaderLabel]);

  const filteredIds = useMemo(() => {
    if (!group) return [];
    const q = search.trim().toLowerCase();
    if (!q) return group.avatarIds;
    return group.avatarIds.filter((id) => {
      const a = avatarById.get(id);
      const name = (a?.name ?? id).toLowerCase();
      const role = (a?.role ?? "").toLowerCase();
      return name.includes(q) || role.includes(q);
    });
  }, [group, avatarById, search]);

  const memberGrid = useMemo(() => {
    const width = panelWidth || 320;
    const columns = width <= 250 ? 2 : width <= 360 ? 3 : 4;
    const avatarSize = width <= 250 ? 38 : width <= 360 ? 44 : 48;
    const nameClass = width <= 250 ? "text-[10px]" : "text-[11px]";
    return { columns, avatarSize, nameClass };
  }, [panelWidth]);

  const [dialogChecked, setDialogChecked] = useState<Set<string>>(new Set());
  const [dialogSearch, setDialogSearch] = useState("");

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

  if (!group) {
    return (
      <div ref={panelRef} className="flex h-full flex-col bg-surface-card p-3">
        <p className="text-xs text-text-faint">未找到该群配置，可在侧栏刷新群列表后重试。</p>
      </div>
    );
  }

  const persistMembers = async (nextAvatarIds: string[]) => {
    if (!group || saving) return;
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
    if (!group || !group.avatarIds.includes(avatarId)) return;
    void persistMembers(group.avatarIds.filter((id) => id !== avatarId));
  };

  const openAddDialog = () => {
    setDialogChecked(new Set());
    setDialogSearch("");
    setMode("add");
  };

  const handleDialogConfirm = () => {
    if (!group || dialogChecked.size === 0) return;
    void persistMembers([...group.avatarIds, ...Array.from(dialogChecked)]);
    setMode("browse");
  };

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-card">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索群成员"
          className="w-full rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong"
        />
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
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {filteredIds.length === 0 && !showMetaAgent && search.trim() ? (
          <p className="p-3 text-xs text-text-faint">无匹配成员，换个关键词试试。</p>
        ) : (
          <div
            className="grid gap-x-1 gap-y-3 px-2 py-3"
            style={{ gridTemplateColumns: `repeat(${memberGrid.columns}, minmax(0, 1fr))` }}
          >
            {showMetaAgent ? (
              <div className="relative flex flex-col items-center gap-1.5 rounded-lg text-center">
                <div
                  className="flex shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-[10px] font-bold leading-tight text-white"
                  style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                >
                  {memberInitials(metaLeaderLabel)}
                </div>
                <span
                  className={`w-full truncate px-0.5 text-text-muted ${memberGrid.nameClass}`}
                  title={`${metaLeaderLabel} · 群聊协调者`}
                >
                  {metaLeaderLabel}
                </span>
              </div>
            ) : null}
            {filteredIds.map((id) => {
              const a = avatarById.get(id);
              const label = a?.name ?? id.slice(0, 6);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (mode === "remove") handleRemoveMember(id);
                  }}
                  disabled={saving}
                  className={`relative flex flex-col items-center gap-1.5 rounded-lg text-center transition ${
                    mode === "remove" ? "cursor-pointer hover:bg-surface-hover" : "cursor-default"
                  } disabled:opacity-60`}
                >
                  {a?.avatarUrl ? (
                    <img
                      src={a.avatarUrl}
                      alt=""
                      className="shrink-0 rounded-xl object-cover"
                      style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    />
                  ) : (
                    <div
                      className={`flex shrink-0 items-center justify-center rounded-xl font-bold text-white ${memberColorClass(id)}`}
                      style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    >
                      {memberInitials(label)}
                    </div>
                  )}
                  <span
                    className={`w-full truncate px-0.5 text-text-muted ${memberGrid.nameClass}`}
                    title={`${label}${a?.role ? ` · ${a.role}` : ""}\n${id}`}
                  >
                    {label}
                  </span>
                  {mode === "remove" ? (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold leading-none text-white shadow">
                      −
                    </span>
                  ) : null}
                </button>
              );
            })}
            {!search.trim() ? (
              <>
                <div className="relative flex flex-col items-center gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={openAddDialog}
                    disabled={saving}
                    className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-2xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
                    style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    title="添加成员"
                  >
                    +
                  </button>
                  <span className={`text-text-muted ${memberGrid.nameClass}`}>添加</span>
                </div>
                <div className="relative flex flex-col items-center gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => setMode((prev) => (prev === "remove" ? "browse" : "remove"))}
                    disabled={saving || group.avatarIds.length === 0}
                    className="flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-2xl font-light leading-none text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-strong disabled:opacity-60"
                    style={{ width: memberGrid.avatarSize, height: memberGrid.avatarSize }}
                    title="移出成员"
                  >
                    −
                  </button>
                  <span className={`text-text-muted ${memberGrid.nameClass}`}>移出</span>
                </div>
              </>
            ) : null}
          </div>
        )}
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
                              className="h-4 w-4 shrink-0 accent-cyan-500"
                            />
                            {a.avatarUrl ? (
                              <img
                                src={a.avatarUrl}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <div
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${memberColorClass(a.id)}`}
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
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${memberColorClass(id)}`}
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
                className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
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
});
