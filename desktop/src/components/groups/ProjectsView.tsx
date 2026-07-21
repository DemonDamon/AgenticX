import { useState } from "react";
import {
  BookOpen,
  Boxes,
  Bug,
  ClipboardList,
  FolderKanban,
  LineChart,
  MoreHorizontal,
  PackageCheck,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { MainViewShell } from "../ds/MainViewShell";
import { useAppStore, type GroupChat } from "../../store";
import { groupColorByIndex } from "../../utils/avatar-color";
import { GROUP_TEMPLATES, matchTemplateAvatarIds } from "./group-templates";
import { GroupEditorInline } from "./GroupEditorInline";
import { META_AGENT_DISPLAY_NAME } from "../../constants/branding";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  LineChart,
  BookOpen,
  PackageCheck,
  Bug,
  Boxes,
};

type EditorState =
  | { mode: "create"; name?: string; avatarIds?: string[] }
  | { mode: "edit"; group: GroupChat }
  | null;

/** Project cards: hover / focus borders follow --theme-color-rgb. */
const PROJECT_CARD_BASE =
  "rounded-xl border bg-surface-card transition-all outline-none hover:bg-surface-card-strong";
const PROJECT_CARD_IDLE =
  "border-border hover:border-[rgba(var(--theme-color-rgb,59,130,246),0.35)] focus-visible:border-[rgba(var(--theme-color-rgb,59,130,246),0.5)] focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb,59,130,246),0.22)]";
const PROJECT_CARD_SELECTED =
  "border-[rgba(var(--theme-color-rgb,59,130,246),0.5)] bg-surface-card-strong ring-1 ring-[rgba(var(--theme-color-rgb,59,130,246),0.22)]";

export function ProjectsView() {
  const groups = useAppStore((s) => s.groups);
  const avatars = useAppStore((s) => s.avatars);
  const setGroups = useAppStore((s) => s.setGroups);
  const panes = useAppStore((s) => s.panes);
  const addPane = useAppStore((s) => s.addPane);
  const removePane = useAppStore((s) => s.removePane);

  const { openGroupPane } = usePaneNavigation();

  const [editorState, setEditorState] = useState<EditorState>(null);

  const refreshGroups = async () => {
    try {
      const result = await window.agenticxDesktop.listGroups();
      if (result.ok && Array.isArray(result.groups)) {
        setGroups(
          result.groups.map((g) => ({
            id: g.id,
            name: g.name,
            avatarIds: g.avatar_ids ?? [],
            routing: g.routing ?? "intelligent",
          }))
        );
      }
    } catch {
      /* App.tsx fallback covers cold-start; ignore transient errors here. */
    }
  };

  const handleGroupDelete = async (group: GroupChat) => {
    const api = window.agenticxDesktop;
    const confirmResult =
      typeof api.confirmDialog === "function"
        ? await api.confirmDialog({
            title: "确认删除群聊",
            message: `确定删除群聊「${group.name}」吗？`,
            detail: "此操作不可恢复。",
            confirmText: "删除",
            cancelText: "取消",
            destructive: true,
          })
        : { ok: true, confirmed: window.confirm(`确定删除群聊「${group.name}」吗？此操作不可恢复。`) };
    if (!confirmResult.confirmed) return;
    const groupPaneId = `group:${group.id}`;
    const groupPanes = panes.filter((item) => item.avatarId === groupPaneId);
    const nonGroupPanes = panes.filter((item) => item.avatarId !== groupPaneId);
    if (nonGroupPanes.length === 0 && groupPanes.length > 0) {
      addPane(null, META_AGENT_DISPLAY_NAME, "");
    }
    groupPanes.forEach((item) => removePane(item.id));
    setGroups(groups.filter((g) => g.id !== group.id));
    await api.deleteGroup(group.id);
    await refreshGroups();
  };

  const handleTemplateSelect = (templateId: string) => {
    const tpl = GROUP_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const avatarIds = matchTemplateAvatarIds(tpl.memberRoleHints, avatars);
    setEditorState({ mode: "create", name: tpl.name, avatarIds });
  };

  return (
    <MainViewShell>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-strong">项目群聊</h2>
          <p className="mt-1 text-sm text-text-muted">
            把多个数字分身编成一个团队，协同完成复杂任务。
          </p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-btnPrimary px-3 py-2 text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
          onClick={() => setEditorState({ mode: "create" })}
        >
          <Plus className="h-4 w-4" />
          新建群聊
        </button>
      </div>

      {/* My groups */}
      <section className="mb-8">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-subtle">
          我的群聊
        </div>
        {groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-muted">
            还没有项目群聊，从下方模板或点「新建群聊」开始组建团队。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group, groupIndex) => {
              const hasPane = panes.some((p) => p.avatarId === `group:${group.id}`);
              const { iconBg } = groupColorByIndex(groupIndex);
              const isGroupSelected =
                editorState?.mode === "edit" && editorState.group.id === group.id;
              const memberNames = group.avatarIds
                .map((id) => avatars.find((a) => a.id === id)?.name || id.slice(0, 4))
                .join("、");
              return (
                <div
                  key={group.id}
                  role="button"
                  tabIndex={0}
                  className={`group relative flex cursor-pointer flex-col p-4 ${PROJECT_CARD_BASE} ${isGroupSelected ? PROJECT_CARD_SELECTED : PROJECT_CARD_IDLE}`}
                  onClick={() => openGroupPane(group)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openGroupPane(group);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                        style={{ backgroundColor: iconBg }}
                      >
                        {group.name.slice(0, 1).toUpperCase()}
                      </div>
                      {hasPane && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-card bg-emerald-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-text-strong">
                        {group.name}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                        {group.avatarIds.length} 个成员 · {memberNames}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
                      aria-label="编辑群聊"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditorState({ mode: "edit", group });
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Templates */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-subtle">
          <FolderKanban className="h-3.5 w-3.5" />
          从模板组建团队
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
          initialName={editorState.mode === "create" ? editorState.name : undefined}
          initialAvatarIds={editorState.mode === "create" ? editorState.avatarIds : undefined}
          onDelete={
            editorState.mode === "edit"
              ? async (groupId) => {
                  const group = groups.find((g) => g.id === groupId);
                  if (group) await handleGroupDelete(group);
                  setEditorState(null);
                }
              : undefined
          }
          onClose={() => setEditorState(null)}
          onSaved={() => {
            void refreshGroups();
            if (editorState.mode === "create") setEditorState(null);
          }}
        />
      )}
    </MainViewShell>
  );
}
