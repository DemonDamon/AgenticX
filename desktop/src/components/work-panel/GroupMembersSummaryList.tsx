import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, UsersRound, X } from "lucide-react";
import { useAppStore, type Avatar, type Message } from "../../store";
import { resolveCrewSlots } from "../../utils/group-member-activity";
import { EMPTY_PANE_GRAPH_STATE } from "../graph/graph-types";
import { deriveRunningToolByAgent } from "../graph/span-derive";
import { useGraphRunStore } from "../graph/useGraphRun";
import { GroupMemberAvatar } from "../groups/GroupMemberAvatar";
import { CrewWorkstationWall } from "./CrewWorkstationWall";

const STATUS_LABEL: Record<"idle" | "running" | "waiting" | "replied" | "failed", string> = {
  idle: "未执行",
  running: "执行中",
  waiting: "等待确认",
  replied: "已回复",
  failed: "执行失败",
};

function activityDotClass(phase: "idle" | "running" | "waiting" | "replied" | "failed"): string {
  if (phase === "running" || phase === "waiting") return "bg-[var(--status-warning)]";
  if (phase === "failed") return "bg-[var(--status-danger)]";
  if (phase === "replied") return "bg-[var(--status-success)]";
  return "border border-current bg-transparent text-text-faint";
}

/**
 * Group workbench member surface.
 *
 * Execution status and membership administration are intentionally separate:
 * the wall answers「谁在执行什么」，the list below answers「群里有哪些人」。
 * Removing a member is a direct action on that row; there is no selection mode.
 */
export function GroupMembersSummaryList({
  groupId,
  paneId,
  avatarList,
  metaLeaderLabel,
  messages = [],
  activeAgentIds = [],
  activityHintById = {},
  phaseOverrideById = {},
  onAppendDirective,
  onSwitchModel,
  onInterrupt,
}: {
  groupId: string;
  paneId: string;
  avatarList: Avatar[];
  metaLeaderLabel: string;
  messages?: Array<Pick<Message, "role" | "agentId" | "toolName" | "timestamp">>;
  activeAgentIds?: string[];
  activityHintById?: Record<string, string>;
  phaseOverrideById?: Record<string, "waiting" | "failed">;
  onAppendDirective?: (agentId: string) => void;
  onSwitchModel?: (agentId: string) => void;
  onInterrupt?: (agentId: string) => void;
}) {
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const group = groups.find((item) => item.id === groupId);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [dialogSearch, setDialogSearch] = useState("");

  const avatarById = useMemo(() => {
    const map = new Map<string, Avatar>();
    for (const item of avatarList) map.set(item.id, item);
    return map;
  }, [avatarList]);

  const dialogCandidates = useMemo(() => {
    if (!addOpen || !group) return [];
    const existing = new Set(group.avatarIds);
    const query = dialogSearch.trim().toLocaleLowerCase();
    return avatarList.filter((avatar) => {
      if (existing.has(avatar.id)) return false;
      if (!query) return true;
      return (
        avatar.name.toLocaleLowerCase().includes(query) ||
        avatar.role.toLocaleLowerCase().includes(query) ||
        (avatar.description ?? "").toLocaleLowerCase().includes(query)
      );
    });
  }, [addOpen, avatarList, dialogSearch, group]);

  const toolStepsByNode = useGraphRunStore(
    (state) => state.byPane[paneId]?.toolStepsByNode ?? EMPTY_PANE_GRAPH_STATE.toolStepsByNode,
  );
  const runningToolByAgent = useMemo(
    () => deriveRunningToolByAgent(toolStepsByNode),
    [toolStepsByNode],
  );
  const hasLiveWork = useMemo(
    () =>
      activeAgentIds.length > 0 ||
      Object.keys(runningToolByAgent).length > 0 ||
      Object.keys(phaseOverrideById).length > 0,
    [activeAgentIds, phaseOverrideById, runningToolByAgent],
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasLiveWork) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveWork]);

  const wallIds = useMemo(() => ["__meta__", ...(group?.avatarIds ?? [])], [group?.avatarIds]);
  const slots = useMemo(
    () =>
      resolveCrewSlots({
        avatarIds: wallIds,
        messages,
        activeAgentIds,
        activityHintById,
        runningToolByAgent,
        phaseOverrideById,
        nowMs,
      }),
    [
      activeAgentIds,
      activityHintById,
      messages,
      nowMs,
      phaseOverrideById,
      runningToolByAgent,
      wallIds,
    ],
  );
  const executedCount = useMemo(
    () => slots.filter((slot) => slot.agentId !== "__meta__" && slot.phase !== "idle").length,
    [slots],
  );
  const phaseById = useMemo(() => {
    const map = new Map<string, (typeof slots)[number]>();
    for (const slot of slots) map.set(slot.agentId, slot);
    return map;
  }, [slots]);

  if (!group) {
    return <p className="text-xs text-text-faint">未找到该群配置，可刷新群列表后重试。</p>;
  }

  const persistMembers = async (nextAvatarIds: string[]): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setErrorText("");
    const previous = group.avatarIds;
    setGroups(
      groups.map((item) => (item.id === group.id ? { ...item, avatarIds: nextAvatarIds } : item)),
    );
    try {
      const result = await window.agenticxDesktop.updateGroup({
        id: group.id,
        avatar_ids: nextAvatarIds,
      });
      if (!result.ok) throw new Error(result.error || "更新群成员失败");
      return true;
    } catch (error) {
      setGroups(
        groups.map((item) => (item.id === group.id ? { ...item, avatarIds: previous } : item)),
      );
      setErrorText(error instanceof Error ? error.message : "更新群成员失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (avatarId: string) => {
    if (!group.avatarIds.includes(avatarId) || group.avatarIds.length <= 1) {
      setErrorText("群聊至少需要保留 1 位成员。");
      return;
    }
    const avatar = avatarById.get(avatarId);
    const api = window.agenticxDesktop;
    if (typeof api.confirmDialog === "function") {
      const result = await api.confirmDialog({
        title: "移出群成员",
        message: `确定将「${avatar?.name || "该成员"}」移出群聊吗？`,
        detail: "只会解除群聊关联，不会删除该数字专家。",
        confirmText: "移出成员",
        cancelText: "取消",
        destructive: true,
      });
      if (!result.confirmed) return;
    }
    await persistMembers(group.avatarIds.filter((id) => id !== avatarId));
  };

  const handleAddMember = async (avatarId: string) => {
    if (group.avatarIds.includes(avatarId)) return;
    await persistMembers([...group.avatarIds, avatarId]);
  };

  const closeAddDialog = () => {
    if (saving) return;
    setAddOpen(false);
    setDialogSearch("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-card px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound className="h-4 w-4 shrink-0 text-text-subtle" strokeWidth={1.8} aria-hidden />
            <span className="text-xs font-semibold text-text-primary">群聊成员</span>
            <span className="rounded-full bg-surface-panel px-1.5 py-0.5 text-[10px] tabular-nums text-text-faint">
              {group.avatarIds.length + 1}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-text-faint">
            本轮已执行 {executedCount}/{group.avatarIds.length} 位成员，Meta-Agent 负责统筹。
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[rgba(var(--theme-color-rgb,59,130,246),0.12)] px-2 py-1.5 text-[11px] font-medium text-[rgb(var(--theme-color-fg-rgb,59,130,246))] transition hover:bg-[rgba(var(--theme-color-rgb,59,130,246),0.2)] disabled:opacity-40"
          onClick={() => {
            setDialogSearch("");
            setErrorText("");
            setAddOpen(true);
          }}
        >
          <Plus className="h-3 w-3" strokeWidth={2} aria-hidden />
          添加
        </button>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-faint">执行状态</div>
        <CrewWorkstationWall
          slots={slots}
          avatarById={avatarById}
          metaLeaderLabel={metaLeaderLabel}
          onAppendDirective={onAppendDirective}
          onSwitchModel={onSwitchModel}
          onInterrupt={onInterrupt}
        />
      </div>

      <div className="rounded-xl border border-border bg-surface-card px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium text-text-primary">成员管理</div>
            <div className="mt-0.5 text-[10px] text-text-faint">移出成员不会删除数字专家。</div>
          </div>
          {saving ? <span className="text-[10px] text-text-faint">同步中…</span> : null}
        </div>
        <div className="space-y-1">
          {group.avatarIds.map((id) => {
            const avatar = avatarById.get(id);
            const label = avatar?.name || id.slice(0, 8);
            const slot = phaseById.get(id);
            const phase = slot?.phase ?? "idle";
            return (
              <div key={id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-surface-hover">
                <GroupMemberAvatar avatar={avatar} label={label} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-text-primary">{label}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-faint">
                    <span className={`h-1.5 w-1.5 rounded-full ${activityDotClass(phase)}`} aria-hidden />
                    <span>{STATUS_LABEL[phase]}</span>
                    {avatar?.role ? <span className="truncate">· {avatar.role}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving || group.avatarIds.length <= 1}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-text-faint transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={`移出成员 ${label}`}
                  title={`移出 ${label}`}
                  onClick={() => void handleRemoveMember(id)}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                  移出
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {errorText ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-rose-300" role="alert">
          {errorText}
        </p>
      ) : null}

      {addOpen ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeAddDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-member-add-title"
            className="flex max-h-[min(560px,calc(100vh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h3 id="group-member-add-title" className="text-sm font-semibold text-text-strong">添加成员</h3>
                <p className="mt-0.5 text-[11px] text-text-faint">直接点击某一行的「加入」，不需要勾选。</p>
              </div>
              <button
                type="button"
                className="agx-topbar-btn agx-topbar-btn--icon-only"
                aria-label="关闭添加成员"
                title="关闭"
                disabled={saving}
                onClick={closeAddDialog}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <label className="relative shrink-0 px-4 py-3">
              <Search className="pointer-events-none absolute left-7 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" strokeWidth={1.8} aria-hidden />
              <input
                type="search"
                autoFocus
                value={dialogSearch}
                onChange={(event) => setDialogSearch(event.target.value)}
                placeholder="搜索名称或职责"
                disabled={saving}
                className="w-full rounded-lg border border-border bg-surface-card py-2 pl-9 pr-3 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong disabled:opacity-60"
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {dialogCandidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-10 text-center text-xs leading-relaxed text-text-faint">
                  {dialogSearch.trim() ? "没有匹配的可加入成员" : "所有数字专家都已在群里"}
                </div>
              ) : (
                <div className="space-y-1">
                  {dialogCandidates.map((avatar) => (
                    <div key={avatar.id} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-surface-hover">
                      <GroupMemberAvatar avatar={avatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-text-primary">{avatar.name}</div>
                        <div className="mt-0.5 truncate text-[10px] text-text-faint">{avatar.role || "数字专家"}</div>
                      </div>
                      <button
                        type="button"
                        disabled={saving}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[rgba(var(--theme-color-rgb,59,130,246),0.12)] px-2 py-1.5 text-[11px] font-medium text-[rgb(var(--theme-color-fg-rgb,59,130,246))] transition hover:bg-[rgba(var(--theme-color-rgb,59,130,246),0.2)] disabled:opacity-40"
                        onClick={() => void handleAddMember(avatar.id)}
                      >
                        <Plus className="h-3 w-3" strokeWidth={2} aria-hidden />
                        加入
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
