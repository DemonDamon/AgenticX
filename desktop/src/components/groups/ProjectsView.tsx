import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  Bug,
  ClipboardList,
  FileSearch,
  FolderKanban,
  LineChart,
  Newspaper,
  PackageCheck,
  Pencil,
  Plus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { MainViewShell } from "../ds/MainViewShell";
import { Toast } from "../ds/Toast";
import { useAppStore, type Avatar, type GroupChat } from "../../store";
import { groupColorByIndex } from "../../utils/avatar-color";
import { mapAvatarsFromApi, mapGroupsFromApi } from "../../utils/splash-preload-core";
import { GROUP_TEMPLATES, type GroupTemplate } from "./group-templates";
import { nextAvailableTemplateGroupName, type GroupTemplateCreationResult } from "./group-template-creation";
import { GroupTemplateCreateDialog } from "./GroupTemplateCreateDialog";
import { GroupEditorInline } from "./GroupEditorInline";
import { GroupIdentityIcon, GroupMemberAvatar } from "./GroupMemberAvatar";
import { META_AGENT_DISPLAY_NAME } from "../../constants/branding";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  LineChart,
  FileSearch,
  Newspaper,
  BookOpen,
  PackageCheck,
  Bug,
  Boxes,
};

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; group: GroupChat }
  | null;

/** Project cards: hover / focus borders follow --theme-color-rgb. */
const PROJECT_CARD_BASE =
  "rounded-xl border bg-surface-card transition-all outline-none hover:bg-surface-card-strong";
const PROJECT_CARD_IDLE =
  "border-border hover:border-[rgba(var(--theme-color-rgb,59,130,246),0.35)] focus-visible:border-[rgba(var(--theme-color-rgb,59,130,246),0.5)] focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,59,130,246),0.22)]";
const PROJECT_CARD_SELECTED =
  "border-[rgba(var(--theme-color-rgb,59,130,246),0.5)] bg-surface-card-strong ring-1 ring-[rgba(var(--theme-color-rgb,59,130,246),0.22)]";

function GroupMemberStack({ group, avatars }: { group: GroupChat; avatars: Avatar[] }) {
  const members = group.avatarIds.map((id) => avatars.find((avatar) => avatar.id === id));
  const visibleMembers = members.slice(0, 4);
  const remaining = Math.max(0, members.length - visibleMembers.length);

  return (
    <div className="flex shrink-0 items-center" aria-label={`${group.avatarIds.length} 位群成员`}>
      {visibleMembers.map((avatar, index) => (
        <div key={avatar?.id ?? group.avatarIds[index]} className={index === 0 ? "" : "-ml-2"}>
          <GroupMemberAvatar
            avatar={avatar}
            label={avatar?.name ?? group.avatarIds[index]}
            identity={group.avatarIds[index]}
            size="sm"
            className="ring-2 ring-surface-card"
          />
        </div>
      ))}
      {remaining > 0 ? (
        <span className="-ml-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-panel text-[10px] font-medium text-text-subtle ring-2 ring-surface-card">
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}

export function ProjectsView() {
  const groups = useAppStore((s) => s.groups);
  const avatars = useAppStore((s) => s.avatars);
  const setAvatars = useAppStore((s) => s.setAvatars);
  const setGroups = useAppStore((s) => s.setGroups);
  const panes = useAppStore((s) => s.panes);
  const addPane = useAppStore((s) => s.addPane);
  const removePane = useAppStore((s) => s.removePane);

  const { openGroupPane } = usePaneNavigation();

  const [editorState, setEditorState] = useState<EditorState>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<GroupTemplate | null>(null);
  const [notice, setNotice] = useState("");

  const refreshAvatars = async () => {
    try {
      const result = await window.agenticxDesktop.listAvatars();
      if (result.ok && Array.isArray(result.avatars)) {
        const next = mapAvatarsFromApi(result.avatars);
        setAvatars(next);
        return next;
      }
    } catch {
      /* App-level refresh remains the fallback for transient backend errors. */
    }
    return [];
  };

  const refreshGroups = async () => {
    try {
      const result = await window.agenticxDesktop.listGroups();
      if (result.ok && Array.isArray(result.groups)) {
        const next = mapGroupsFromApi(result.groups);
        setGroups(next);
        return next;
      }
    } catch {
      /* App.tsx fallback covers cold-start; ignore transient errors here. */
    }
    return [];
  };

  const handleGroupDelete = async (group: GroupChat): Promise<boolean | undefined> => {
    const api = window.agenticxDesktop;
    if (typeof api.confirmDialog !== "function") {
      setNotice("当前环境不支持删除确认，请重启 Desktop 后重试。");
      return false;
    }
    const confirmResult = await api.confirmDialog({
      title: "确认删除群聊",
      message: `确定删除群聊「${group.name}」吗？`,
      detail: "删除后群聊配置不可恢复，已有对话记录不会被自动改写。",
      confirmText: "删除群聊",
      cancelText: "取消",
      destructive: true,
    });
    if (!confirmResult.confirmed) return undefined;

    const groupPaneId = `group:${group.id}`;
    const groupPanes = panes.filter((item) => item.avatarId === groupPaneId);
    const nonGroupPanes = panes.filter((item) => item.avatarId !== groupPaneId);
    try {
      const result = await api.deleteGroup(group.id);
      if (!result.ok) throw new Error(result.error || "删除群聊失败");
      if (nonGroupPanes.length === 0 && groupPanes.length > 0) {
        addPane(null, META_AGENT_DISPLAY_NAME, "");
      }
      groupPanes.forEach((item) => removePane(item.id));
      setGroups(groups.filter((g) => g.id !== group.id));
      await refreshGroups();
      setNotice(`已删除群聊「${group.name}」。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除群聊失败，请稍后重试。");
      return false;
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const tpl = GROUP_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setEditorState(null);
    setSelectedTemplate(tpl);
  };

  const handleTemplateCreated = async (result: GroupTemplateCreationResult) => {
    const optimisticAvatars = mapAvatarsFromApi(result.avatars);
    if (optimisticAvatars.length > 0) {
      const createdIds = new Set(optimisticAvatars.map((avatar) => avatar.id));
      const currentAvatars = useAppStore.getState().avatars;
      setAvatars([
        ...currentAvatars.filter((avatar) => !createdIds.has(avatar.id)),
        ...optimisticAvatars,
      ]);
    }
    const responseGroup = result.group ? mapGroupsFromApi([result.group])[0] : undefined;
    if (responseGroup) {
      const currentGroups = useAppStore.getState().groups;
      setGroups([
        ...currentGroups.filter((group) => group.id !== responseGroup.id),
        responseGroup,
      ]);
    }
    const [, refreshedGroups] = await Promise.all([refreshAvatars(), refreshGroups()]);
    const createdGroup = responseGroup ?? refreshedGroups.find(
      (group) => group.name === result.groupName
        && result.avatarIds.every((avatarId) => group.avatarIds.includes(avatarId)),
    );
    if (createdGroup) openGroupPane(createdGroup);
  };

  return (
    <MainViewShell>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-text-strong">项目群聊</h2>
            <span className="rounded-full bg-surface-card px-2 py-0.5 text-[11px] tabular-nums text-text-subtle">
              {groups.length} 个团队
            </span>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-muted">
            用一个群聊承载完整工作流，成员按职责协作，Meta-Agent 负责统筹与兜底。
          </p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--ui-btn-primary-bg)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)]"
          onClick={() => {
            setSelectedTemplate(null);
            setEditorState({ mode: "create" });
          }}
        >
          <Plus className="h-4 w-4" />
          新建群聊
        </button>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-strong">我的群聊</h3>
            <p className="mt-0.5 text-xs text-text-faint">打开一个团队继续对话，或进入设置调整成员。</p>
          </div>
          {groups.length > 0 ? (
            <span className="text-xs text-text-faint">点击卡片打开对话</span>
          ) : null}
        </div>
        {groups.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-card/35 px-4 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-card text-text-faint">
              <UsersRound className="h-5 w-5" strokeWidth={1.7} aria-hidden />
            </div>
            <p className="mt-3 text-sm font-medium text-text-muted">还没有项目群聊</p>
            <p className="mt-1 text-xs text-text-faint">从右上角新建，或从下方工作流模板开始。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group, groupIndex) => {
              const hasPane = panes.some((p) => p.avatarId === `group:${group.id}`);
              const { iconBg } = groupColorByIndex(groupIndex);
              const isGroupSelected =
                editorState?.mode === "edit" && editorState.group.id === group.id;
              return (
                <article
                  key={group.id}
                  className={`group relative flex min-h-[156px] flex-col overflow-hidden ${PROJECT_CARD_BASE} ${isGroupSelected ? PROJECT_CARD_SELECTED : PROJECT_CARD_IDLE}`}
                >
                  <button
                    type="button"
                    className="flex min-h-0 flex-1 flex-col p-4 text-left"
                    onClick={() => openGroupPane(group)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <GroupIdentityIcon identity={group.id} iconBg={iconBg} size="lg" />
                        {hasPane ? (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-card bg-emerald-500" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <div className="truncate text-[15px] font-semibold text-text-strong">
                            {group.name}
                          </div>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:opacity-100" strokeWidth={1.8} aria-hidden />
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          {group.avatarIds.length} 位成员 · 自动协作
                        </p>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                      <GroupMemberStack group={group} avatars={avatars} />
                      <span className="text-xs text-text-subtle">
                        {group.avatarIds.length > 0 ? `${group.avatarIds.length} 位成员` : "等待加入成员"}
                      </span>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5">
                    <span className="text-[11px] text-text-faint">
                      {hasPane ? "已打开对话" : "尚未开始对话"}
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => {
                        setSelectedTemplate(null);
                        setEditorState({ mode: "edit", group });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                      管理
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-text-subtle" />
          <div>
            <h3 className="text-sm font-semibold text-text-strong">工作流模板</h3>
            <p className="mt-0.5 text-xs text-text-faint">自动创建一组职责清晰的新成员。</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {GROUP_TEMPLATES.map((tpl) => {
            const Icon = ICON_MAP[tpl.icon] ?? FolderKanban;
            return (
              <button
                key={tpl.id}
                type="button"
                className={`flex items-start gap-3 px-4 py-3.5 text-left ${PROJECT_CARD_BASE} ${PROJECT_CARD_IDLE}`}
                onClick={() => handleTemplateSelect(tpl.id)}
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-panel">
                  <Icon className="h-[18px] w-[18px] text-text-subtle" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-strong">{tpl.name}</div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                    {tpl.description}
                  </p>
                  <div className="mt-1.5 text-[11px] text-text-faint">
                    自动创建 {tpl.members.length} 个专属分身
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {editorState && (
        <GroupEditorInline
          avatars={avatars}
          initialGroup={editorState.mode === "edit" ? editorState.group : undefined}
          onDelete={
            editorState.mode === "edit"
              ? async (groupId) => {
                  const group = groups.find((g) => g.id === groupId);
                  if (!group) return false;
                  const deleted = await handleGroupDelete(group);
                  if (deleted) setEditorState(null);
                  return deleted;
                }
              : undefined
          }
          onClose={() => setEditorState(null)}
          onSaved={() => {
            void refreshGroups();
            setNotice(editorState.mode === "create" ? "群聊已创建。" : "群聊设置已保存。");
            setEditorState(null);
          }}
        />
      )}

      {selectedTemplate ? (
        <GroupTemplateCreateDialog
          key={selectedTemplate.id}
          template={selectedTemplate}
          initialGroupName={nextAvailableTemplateGroupName(
            selectedTemplate.name,
            groups.map((group) => group.name),
          )}
          onClose={() => setSelectedTemplate(null)}
          onCreated={handleTemplateCreated}
        />
      ) : null}

      <Toast open={Boolean(notice)} message={notice} onClose={() => setNotice("")} />
    </MainViewShell>
  );
}
