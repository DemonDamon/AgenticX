import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Ban, ChevronDown, ChevronRight, Clock3, Loader2 } from "lucide-react";
import { useAppStore, type Avatar, type GroupChat } from "../store";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";
import { avatarBgClass, avatarDotColor, groupColorByIndex } from "../utils/avatar-color";
import {
  extractUnknownAvatarIdFromError,
  getGroupSaveErrorMessage,
  sanitizeGroupAvatarIds,
} from "../utils/group-editor-utils";
import { AvatarCreateDialog } from "./AvatarCreateDialog";
import { AvatarSettingsPanel } from "./AvatarSettingsPanel";
import { TaskFormPanel } from "./automation/TaskFormPanel";
import type { AutomationTask } from "./automation/types";

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(id: string): string {
  return avatarBgClass(id);
}

type SessionListItem = {
  session_id: string;
  avatar_id: string | null;
  updated_at: number;
  created_at?: number;
  archived?: boolean;
  provider?: string;
  model?: string;
};

function isSessionAvatarMatch(item: SessionListItem, avatarId?: string | null): boolean {
  const targetAvatarId = (avatarId ?? "").trim();
  const itemAvatarId = String(item.avatar_id ?? "").trim();
  if (!targetAvatarId) return itemAvatarId.length === 0;
  return itemAvatarId === targetAvatarId;
}

function pickMostRecentSessionId(
  sessions: SessionListItem[],
  avatarId?: string | null
): string | undefined {
  const sorted = [...sessions]
    .filter((item) => {
      const sid = String(item.session_id ?? "").trim();
      if (!sid) return false;
      if (item.archived === true) return false;
      return isSessionAvatarMatch(item, avatarId);
    })
    .sort((a, b) => {
      const ua = Number.isFinite(a.updated_at) ? a.updated_at : 0;
      const ub = Number.isFinite(b.updated_at) ? b.updated_at : 0;
      if (ub !== ua) return ub - ua;
      const ca = Number.isFinite(a.created_at ?? NaN) ? (a.created_at as number) : 0;
      const cb = Number.isFinite(b.created_at ?? NaN) ? (b.created_at as number) : 0;
      return cb - ca;
    });
  const sid = sorted[0]?.session_id;
  return sid ? String(sid).trim() : undefined;
}

type ContextMenuState =
  | { x: number; y: number; target: "avatar"; avatarId: string }
  | { x: number; y: number; target: "machi" }
  | null;
type GroupContextMenuState = { x: number; y: number; groupId: string } | null;
type AutomationContextMenuState = { x: number; y: number; taskId: string } | null;

export function AvatarSidebar() {
  const avatars = useAppStore((s) => s.avatars);
  const activeAvatarId = useAppStore((s) => s.activeAvatarId);
  const setAvatars = useAppStore((s) => s.setAvatars);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const addPane = useAppStore((s) => s.addPane);
  const removePane = useAppStore((s) => s.removePane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const openSettings = useAppStore((s) => s.openSettings);
  const metaAvatarUrl = useAppStore((s) => s.metaAvatarUrl);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupEditTarget, setGroupEditTarget] = useState<GroupChat | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<GroupContextMenuState>(null);
  const [automationContextMenu, setAutomationContextMenu] = useState<AutomationContextMenuState>(null);
  const [automationFormInitial, setAutomationFormInitial] = useState<AutomationTask | null>(null);
  const [automationTasks, setAutomationTasks] = useState<AutomationTask[]>([]);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());
  const [avatarsCollapsed, setAvatarsCollapsed] = useState(false);
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [automationCollapsed, setAutomationCollapsed] = useState(false);
  // First-paint readiness for the avatars / groups lists. While these flags
  // are still false (typical during the studio cold-start window after a
  // restart), we render a loading hint instead of "暂无分身/群聊", which
  // would otherwise be misleading because we simply haven't fetched yet
  // (issue #11).
  const [avatarsLoaded, setAvatarsLoaded] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [avatarsHeight, setAvatarsHeight] = useState<number | null>(null);
  const [groupsHeight, setGroupsHeight] = useState<number | null>(null);
  const avatarsContainerRef = useRef<HTMLDivElement>(null);
  const groupsContainerRef = useRef<HTMLDivElement>(null);
  const [settingsPanel, setSettingsPanel] = useState<
    | { mode: "avatar"; avatarId: string }
    | { mode: "machi" }
    | null
  >(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const automationMenuRef = useRef<HTMLDivElement>(null);
  const openingRef = useRef(false);

  const refreshAvatars = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.agenticxDesktop.listAvatars();
      if (result.ok && Array.isArray(result.avatars)) {
        setAvatars(
          result.avatars.map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role ?? "",
            avatarUrl: a.avatar_url ?? "",
            pinned: Boolean(a.pinned),
            createdBy: a.created_by ?? "manual",
            systemPrompt: a.system_prompt ?? "",
            toolsEnabled: a.tools_enabled ?? {},
            skillsEnabled:
              a.skills_enabled && typeof a.skills_enabled === "object"
                ? { ...a.skills_enabled }
                : undefined,
            defaultProvider: a.default_provider ?? "",
            defaultModel: a.default_model ?? "",
          }))
        );
        setAvatarsLoaded(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error("[AvatarSidebar] refreshAvatars error:", err);
      return false;
    }
  }, [setAvatars]);

  const refreshGroups = useCallback(async (): Promise<boolean> => {
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
        setGroupsLoaded(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error("[AvatarSidebar] refreshGroups error:", err);
      return false;
    }
  }, [setGroups]);

  const refreshAutomationTasks = useCallback(async () => {
    const result = await window.agenticxDesktop.loadAutomationTasks().catch(() => ({
      ok: false,
      tasks: [] as AutomationTask[],
    }));
    if (!result?.ok || !Array.isArray(result.tasks)) return;
    setAutomationTasks(
      [...result.tasks].sort((a, b) => {
        const ta = Number(new Date(a.createdAt ?? 0).getTime()) || 0;
        const tb = Number(new Date(b.createdAt ?? 0).getTime()) || 0;
        return tb - ta;
      })
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The studio backend may still be cold-booting when the sidebar mounts.
    // The IPC handlers in main.ts now wait up to 30s for the studio to be
    // ready, but if that wait times out (or the user starts in a degraded
    // state) we still want the UI to recover automatically rather than sit
    // on the misleading "暂无分身/群聊" empty state. Retry with a small
    // backoff for up to ~1 minute (issue #11).
    const delays = [2000, 4000, 8000, 16000, 30000];
    const runWithRetries = async (
      label: "avatars" | "groups",
      fn: () => Promise<boolean>
    ) => {
      for (let i = 0; i <= delays.length; i++) {
        if (cancelled) return;
        const ok = await fn();
        if (ok || cancelled) return;
        const delay = delays[i] ?? delays[delays.length - 1];
        await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        console.warn(`[AvatarSidebar] ${label} refresh failed, retrying...`);
      }
    };
    void runWithRetries("avatars", refreshAvatars);
    void runWithRetries("groups", refreshGroups);
    void refreshAutomationTasks();
    return () => {
      cancelled = true;
    };
  }, [refreshAvatars, refreshGroups, refreshAutomationTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshAutomationTasks();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshAutomationTasks]);

  useEffect(() => {
    const off = window.agenticxDesktop.onAutomationTaskProgress((payload) => {
      const taskId = String(payload.taskId ?? "").trim();
      if (!taskId) return;
      setRunningTaskIds((prev) => {
        const next = new Set(prev);
        if (payload.phase === "queued" || payload.phase === "running") {
          next.add(taskId);
        } else {
          next.delete(taskId);
        }
        return next;
      });
      if (payload.phase === "success" || payload.phase === "error") {
        void refreshAutomationTasks();
      }
    });
    return () => off();
  }, [refreshAutomationTasks]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!groupContextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setGroupContextMenu(null);
      }
    };
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroupContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [groupContextMenu]);

  useEffect(() => {
    if (!automationContextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (automationMenuRef.current && !automationMenuRef.current.contains(e.target as Node)) {
        setAutomationContextMenu(null);
      }
    };
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAutomationContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [automationContextMenu]);

  const handleAutomationFormSave = useCallback(
    async (task: AutomationTask) => {
      const result = await window.agenticxDesktop.saveAutomationTask(task);
      if (result?.ok) {
        setAutomationFormInitial(null);
        void refreshAutomationTasks();
      }
      return {
        ok: Boolean(result?.ok),
        error: result?.error != null ? String(result.error) : undefined,
      };
    },
    [refreshAutomationTasks],
  );

  const handleCreate = async (data: {
    name: string;
    role: string;
    systemPrompt: string;
    toolsEnabled: Record<string, boolean>;
    skillsEnabled?: Record<string, boolean>;
    defaultProvider?: string;
    defaultModel?: string;
  }) => {
    const se = data.skillsEnabled;
    const falses =
      se && typeof se === "object"
        ? Object.fromEntries(Object.entries(se).filter(([, v]) => v === false))
        : {};
    const skillsPayload = Object.keys(falses).length > 0 ? falses : undefined;
    const dp = (data.defaultProvider || "").trim();
    const dm = (data.defaultModel || "").trim();
    await window.agenticxDesktop.createAvatar({
      name: data.name,
      role: data.role,
      system_prompt: data.systemPrompt,
      tools_enabled: data.toolsEnabled,
      ...(skillsPayload !== undefined ? { skills_enabled: skillsPayload } : {}),
      ...(dp ? { default_provider: dp } : {}),
      ...(dm ? { default_model: dm } : {}),
    });
    await refreshAvatars();
  };

  const openOrFocusPane = (avatarId: string | null, avatarName: string) => {
    const existing = panes.find((item) => item.avatarId === avatarId);
    if (existing) {
      setActivePaneId(existing.id);
      setActiveAvatarId(avatarId);
      void (async () => {
        const listed = await window.agenticxDesktop
          .listSessions(avatarId ?? undefined)
          .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
        const currentSid = String(existing.sessionId ?? "").trim();
        if (
          currentSid &&
          listed.ok &&
          Array.isArray(listed.sessions)
        ) {
          const currentRow = listed.sessions.find((item) => String(item.session_id ?? "").trim() === currentSid);
          if (currentRow) {
            setPaneSessionId(existing.id, currentSid, {
              provider: currentRow.provider,
              model: currentRow.model,
            });
            return;
          }
        }
        if (!currentSid) {
          const rememberedSid = getRememberedSessionForAvatar(avatarId);
          const rememberedValid =
            !!rememberedSid &&
            listed.ok &&
            Array.isArray(listed.sessions) &&
            listed.sessions.some(
              (item) =>
                String(item.session_id ?? "").trim() === rememberedSid &&
                isSessionAvatarMatch(item, avatarId)
            );
          const recentSid =
            listed.ok && Array.isArray(listed.sessions)
              ? pickMostRecentSessionId(listed.sessions, avatarId)
              : undefined;
          const preferredSid = rememberedValid ? rememberedSid ?? undefined : recentSid;
          const preferredRow =
            preferredSid && listed.ok && Array.isArray(listed.sessions)
              ? listed.sessions.find((item) => String(item.session_id ?? "").trim() === preferredSid)
              : undefined;
          if (preferredSid) {
            const latestPane = useAppStore.getState().panes.find((item) => item.id === existing.id);
            const latestSid = String(latestPane?.sessionId ?? "").trim();
            if (!latestSid) {
              setPaneSessionId(existing.id, preferredSid, {
                provider: preferredRow?.provider,
                model: preferredRow?.model,
              });
            }
          }
        }
      })();
      return;
    }

    if (openingRef.current) return;
    openingRef.current = true;

    const paneId = addPane(avatarId, avatarName, "");
    setActivePaneId(paneId);
    setActiveAvatarId(avatarId);

    void (async () => {
      try {
        // Re-open most recent session for this avatar first; create a new one only when none exists.
        const listed = await window.agenticxDesktop
          .listSessions(avatarId ?? undefined)
          .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
        const rememberedSid = getRememberedSessionForAvatar(avatarId);
        const rememberedValid =
          !!rememberedSid &&
          listed.ok &&
          Array.isArray(listed.sessions) &&
          listed.sessions.some(
            (item) =>
              String(item.session_id ?? "").trim() === rememberedSid &&
              isSessionAvatarMatch(item, avatarId)
          );
        const recentSid =
          listed.ok && Array.isArray(listed.sessions)
            ? pickMostRecentSessionId(listed.sessions, avatarId)
            : undefined;
        const preferredSid = rememberedValid ? rememberedSid ?? undefined : recentSid;
        const preferredRow =
          preferredSid && listed.ok && Array.isArray(listed.sessions)
            ? listed.sessions.find((item) => String(item.session_id ?? "").trim() === preferredSid)
            : undefined;
        if (preferredSid) {
          setPaneSessionId(paneId, preferredSid, {
            provider: preferredRow?.provider,
            model: preferredRow?.model,
          });
          return;
        }
        // Lazy session: first real send in ChatPane will createSession (align Machi meta pane).
      } finally {
        openingRef.current = false;
      }
    })();
  };

  const openOrFocusGroupPane = (group: { id: string; name: string }) => {
    const groupAvatarId = `group:${group.id}`;
    const existing = panes.find((item) => item.avatarId === groupAvatarId);
    if (existing) {
      setActivePaneId(existing.id);
      setActiveAvatarId(null);
      return;
    }

    if (openingRef.current) return;
    openingRef.current = true;

    const paneId = addPane(groupAvatarId, `群聊 · ${group.name}`, "");
    setActivePaneId(paneId);
    setActiveAvatarId(null);

    void (async () => {
      try {
        const listed = await window.agenticxDesktop
          .listSessions(groupAvatarId)
          .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
        const recentSid =
          listed.ok && Array.isArray(listed.sessions)
            ? pickMostRecentSessionId(listed.sessions, groupAvatarId)
            : undefined;
        if (recentSid) {
          setPaneSessionId(paneId, recentSid);
          return;
        }
        const created = await window.agenticxDesktop.createSession({ avatar_id: groupAvatarId, name: group.name });
        if (created.ok && created.session_id) {
          setPaneSessionId(paneId, created.session_id);
        }
      } finally {
        openingRef.current = false;
      }
    })();
  };

  const openOrFocusAutomationPane = (task: AutomationTask) => {
    const automationAvatarId = `automation:${task.id}`;
    const paneTitle = `定时 · ${task.name}`;
    const existing = panes.find((item) => item.avatarId === automationAvatarId);
    if (existing) {
      setActivePaneId(existing.id);
      setActiveAvatarId(null);
      return;
    }
    if (openingRef.current) return;
    openingRef.current = true;
    const paneId = addPane(automationAvatarId, paneTitle, "");
    setActivePaneId(paneId);
    setActiveAvatarId(null);

    void (async () => {
      try {
        let sid = String(task.sessionId ?? "").trim();
        if (sid) {
          const listedForAutomation = await window.agenticxDesktop
            .listSessions(automationAvatarId)
            .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
          const sessionsForTask =
            listedForAutomation.ok && Array.isArray(listedForAutomation.sessions)
              ? listedForAutomation.sessions
              : [];
          const sidBelongsToAutomation = sessionsForTask.some(
            (row) =>
              String(row.session_id ?? "").trim() === sid &&
              isSessionAvatarMatch(row, automationAvatarId)
          );
          if (sidBelongsToAutomation) {
            setPaneSessionId(paneId, sid);
            return;
          }
          const stripped: AutomationTask = { ...task };
          delete stripped.sessionId;
          const savedStrip = await window.agenticxDesktop.saveAutomationTask(stripped);
          if (savedStrip?.ok) {
            await refreshAutomationTasks();
          }
          sid = "";
        }
        const listed = await window.agenticxDesktop
          .listSessions(automationAvatarId)
          .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
        const recentSid =
          listed.ok && Array.isArray(listed.sessions)
            ? pickMostRecentSessionId(listed.sessions, automationAvatarId)
            : undefined;
        if (recentSid) {
          setPaneSessionId(paneId, recentSid);
          const updateTask: AutomationTask = {
            ...task,
            sessionId: recentSid,
          };
          const saved = await window.agenticxDesktop.saveAutomationTask(updateTask);
          if (!saved?.ok) {
            console.warn("[automation] failed to persist recovered sessionId", task.id, saved?.error);
          }
          await refreshAutomationTasks();
          return;
        }
        const created = await window.agenticxDesktop.createSession({
          avatar_id: automationAvatarId,
          name: task.name,
        });
        if (created.ok && created.session_id) {
          setPaneSessionId(paneId, created.session_id);
          const updateTask: AutomationTask = {
            ...task,
            sessionId: created.session_id,
          };
          const saved = await window.agenticxDesktop.saveAutomationTask(updateTask);
          if (!saved?.ok) {
            console.warn("[automation] failed to persist created sessionId", task.id, saved?.error);
          }
          await refreshAutomationTasks();
        }
      } finally {
        openingRef.current = false;
      }
    })();
  };

  const handleContextAction = async (action: string) => {
    if (!contextMenu) return;
    const avatarId = contextMenu.target === "avatar" ? contextMenu.avatarId : "";
    const target = contextMenu.target;
    setContextMenu(null);
    if (target === "avatar") {
      if (action === "pin") {
        const avatar = avatars.find((a) => a.id === avatarId);
        if (avatar) {
          await window.agenticxDesktop.updateAvatar({ id: avatarId, pinned: !avatar.pinned });
          await refreshAvatars();
        }
      } else if (action === "settings") {
        setSettingsPanel({ mode: "avatar", avatarId });
      } else if (action === "delete") {
        panes.filter((item) => item.avatarId === avatarId).forEach((item) => removePane(item.id));
        if (activeAvatarId === avatarId) setActiveAvatarId(null);
        setAvatars(avatars.filter((a) => a.id !== avatarId));
        void (async () => {
          await window.agenticxDesktop.deleteAvatar(avatarId);
          await refreshAvatars();
        })();
      }
      return;
    }

    if (target === "machi") {
      if (action === "settings") {
        setSettingsPanel({ mode: "machi" });
      }
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
      addPane(null, "Machi", "");
    }
    groupPanes.forEach((item) => removePane(item.id));
    setGroups(groups.filter((g) => g.id !== group.id));
    await window.agenticxDesktop.deleteGroup(group.id);
    await refreshGroups();
  };

  const handleGroupContextAction = async (action: "view") => {
    if (!groupContextMenu) return;
    const group = groups.find((item) => item.id === groupContextMenu.groupId);
    setGroupContextMenu(null);
    if (!group) return;
    if (action === "view") setGroupEditTarget(group);
  };

  const sortedAvatars = useMemo(() => {
    return [...avatars].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [avatars]);

  const startResizeAvatars = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // 避免分身增高时与「群聊+定时」两个 flex-1 子项均摊收缩：先固定群聊高度，仅由定时区让出空间
    if (!groupsCollapsed && groupsHeight == null) {
      const gh = groupsContainerRef.current?.getBoundingClientRect().height;
      if (gh && gh > 0) setGroupsHeight(gh);
    }
    const startY = event.clientY;
    const startHeight = avatarsContainerRef.current?.getBoundingClientRect().height || 100;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const next = Math.max(36, startHeight + delta);
      setAvatarsHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResizeGroups = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // 避免群聊增高时与分身区 flex-1 均摊收缩：先固定分身区高度，仅由定时区让出空间
    if (!avatarsCollapsed && avatarsHeight == null) {
      const ah = avatarsContainerRef.current?.getBoundingClientRect().height;
      if (ah && ah > 0) setAvatarsHeight(ah);
    }
    const startY = event.clientY;
    const startHeight = groupsContainerRef.current?.getBoundingClientRect().height || 100;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const next = Math.max(36, startHeight + delta);
      setGroupsHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-surface-sidebar">
        {/* macOS traffic-light safe zone */}
        <div className="drag-region h-[38px] shrink-0" />
        {/* Meta-Agent entry */}
        <button
          className={`mx-2 mb-1 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all ${
            activeAvatarId === null
              ? "bg-surface-card text-text-strong"
              : "text-text-muted hover:bg-surface-card hover:text-text-strong"
          }`}
          onClick={() => void openOrFocusPane(null, "Machi")}
          onContextMenu={(e) => {
            e.preventDefault();
            setGroupContextMenu(null);
            setAutomationContextMenu(null);
            setContextMenu({ x: e.clientX, y: e.clientY, target: "machi" });
          }}
        >
          <img
            src={metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL}
            alt="Machi"
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">Machi</div>
            <div className="truncate text-xs text-text-faint">全局调度</div>
          </div>
        </button>

        <div className="flex-1 flex flex-col py-1 min-h-0">
          {/* Avatar list */}
          <div
            ref={avatarsContainerRef}
            className={`flex flex-col ${avatarsCollapsed ? "shrink-0" : avatarsHeight ? "shrink-0" : "flex-1 min-h-0"}`}
            style={!avatarsCollapsed && avatarsHeight ? { height: avatarsHeight } : undefined}
          >
            <div className="flex shrink-0 items-center justify-between px-4 py-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-faint hover:text-text-subtle"
                onClick={() => setAvatarsCollapsed((v) => !v)}
              >
                {avatarsCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span>分身 ({avatarsLoaded ? avatars.length : "…"})</span>
              </button>
              <button
                className="rounded px-1.5 py-0.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => setCreateOpen(true)}
              >
                + 新建
              </button>
            </div>
            {!avatarsCollapsed && (
              <div className="flex-1 overflow-y-auto pb-1">
              {sortedAvatars.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-text-faint">
                  {avatarsLoaded ? (
                    "暂无分身，点击上方「新建」创建"
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      正在加载分身…
                    </span>
                  )}
                </div>
              )}
              {sortedAvatars.map((avatar) => {
                const isActive = activeAvatarId === avatar.id;
                const hasPane = panes.some((item) => item.avatarId === avatar.id);
                return (
                  <div key={avatar.id}>
                    <button
                      className={`mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all ${
                        isActive
                          ? "bg-surface-card text-text-strong"
                          : "text-text-muted hover:bg-surface-card hover:text-text-strong"
                      }`}
                      onClick={() => void openOrFocusPane(avatar.id, avatar.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setGroupContextMenu(null);
                        setAutomationContextMenu(null);
                        setContextMenu({ x: e.clientX, y: e.clientY, target: "avatar", avatarId: avatar.id });
                      }}
                    >
                      <div className="relative shrink-0">
                        {avatar.avatarUrl ? (
                          <img
                            src={avatar.avatarUrl}
                            alt={avatar.name}
                            className="h-8 w-8 rounded-[6px] object-cover"
                          />
                        ) : (
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-[6px] text-xs font-bold text-white ${avatarColor(avatar.id)}`}
                          >
                            {avatarInitials(avatar.name)}
                          </div>
                        )}
                        {hasPane && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-sidebar bg-emerald-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-[15px]">{avatar.name}</span>
                          {avatar.pinned && <span className="text-xs text-amber-400">*</span>}
                        </div>
                        {avatar.role && (
                          <div className="truncate text-xs text-text-faint">{avatar.role}</div>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })}
              </div>
            )}
          </div>

          {!avatarsCollapsed && !groupsCollapsed && (
            <div
              className="group relative min-h-[14px] shrink-0 cursor-row-resize touch-none"
              onMouseDown={startResizeAvatars}
              title="拖拽调整分身区域高度"
            >
              <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 transition bg-[var(--ui-accent-divider)]" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90 border-[var(--ui-accent-divider-hover)]" />
            </div>
          )}

          {/* Group chats */}
          <div
            ref={groupsContainerRef}
            className={`flex flex-col mt-2 ${groupsCollapsed ? "shrink-0" : groupsHeight ? "shrink-0" : "flex-1 min-h-0"}`}
            style={!groupsCollapsed && groupsHeight ? { height: groupsHeight } : undefined}
          >
            <div className="flex shrink-0 items-center justify-between px-4 py-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-faint hover:text-text-subtle"
                onClick={() => setGroupsCollapsed((v) => !v)}
              >
                {groupsCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span>群聊 ({groupsLoaded ? groups.length : "…"})</span>
              </button>
              <button
                className="rounded px-1.5 py-0.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => setGroupCreateOpen(true)}
              >
                + 新建
              </button>
            </div>
            {!groupsCollapsed && (
              <div className="flex-1 overflow-y-auto pb-1">
                {groups.map((group, groupIndex) => {
                  const groupAvatarId = `group:${group.id}`;
                  const hasPane = panes.some((item) => item.avatarId === groupAvatarId);
                  const isActive = panes.some(
                    (item) => item.avatarId === groupAvatarId && item.id === activePaneId
                  );
                  const { iconBg } = groupColorByIndex(groupIndex);
                  return (
                    <button
                      key={group.id}
                      className={`mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-all ${
                        isActive
                          ? "bg-surface-card text-text-strong"
                          : "text-text-muted hover:bg-surface-card hover:text-text-strong"
                      }`}
                      onClick={() => void openOrFocusGroupPane(group)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu(null);
                        setAutomationContextMenu(null);
                        setGroupContextMenu({ x: e.clientX, y: e.clientY, groupId: group.id });
                      }}
                    >
                      <div className="relative shrink-0">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[10px] font-bold text-white"
                          style={{ backgroundColor: iconBg }}
                        >
                          {group.name.slice(0, 1).toUpperCase()}
                        </div>
                        {hasPane && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-sidebar bg-emerald-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px]">{group.name}</div>
                        <div className="truncate text-xs text-text-faint">
                          {group.avatarIds.length} avatars ·{" "}
                          {group.avatarIds
                            .map((id) => avatars.find((a) => a.id === id)?.name || id.slice(0, 4))
                            .join(", ")}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {!groupsCollapsed && !automationCollapsed && (
            <div
              className="group relative min-h-[14px] shrink-0 cursor-row-resize touch-none"
              onMouseDown={startResizeGroups}
              title="拖拽调整群聊区域高度"
            >
              <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 transition bg-[var(--ui-accent-divider)]" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-panel opacity-60 transition group-hover:opacity-90 border-[var(--ui-accent-divider-hover)]" />
            </div>
          )}

          {/* Scheduled tasks */}
          <div className={`flex flex-col mt-2 pb-2 ${automationCollapsed ? "shrink-0" : "flex-1 min-h-0"}`}>
            <div className="flex shrink-0 items-center justify-between px-4 py-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-faint hover:text-text-subtle"
                onClick={() => setAutomationCollapsed((v) => !v)}
              >
                {automationCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span>定时 ({automationTasks.length})</span>
              </button>
              <button
                className="rounded px-1.5 py-0.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => openSettings()}
              >
                管理
              </button>
            </div>
            {!automationCollapsed && (
              <div className="flex-1 overflow-y-auto pb-1">
                {automationTasks.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-text-faint">
                    暂无定时任务，可在「设置 - 自动化」创建
                  </div>
                )}
                {automationTasks.map((task) => {
                  const automationAvatarId = `automation:${task.id}`;
                  const hasPane = panes.some((item) => item.avatarId === automationAvatarId);
                  const isActive = panes.some(
                    (item) => item.avatarId === automationAvatarId && item.id === activePaneId
                  );
                  const isRunning = runningTaskIds.has(task.id);
                  return (
                    <div
                      key={task.id}
                      className="mx-2 flex w-[calc(100%-16px)] items-center gap-0.5 rounded-[10px] px-0.5 py-0.5"
                    >
                      <button
                        type="button"
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-all ${
                          isActive
                            ? "bg-surface-card text-text-strong"
                            : "text-text-muted hover:bg-surface-card hover:text-text-strong"
                        }`}
                        onClick={() => void openOrFocusAutomationPane(task)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu(null);
                          setGroupContextMenu(null);
                          setAutomationContextMenu({ x: e.clientX, y: e.clientY, taskId: task.id });
                        }}
                      >
                        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-surface-card">
                          {isRunning ? (
                            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                          ) : (
                            <Clock3 className="h-4 w-4 text-text-muted" />
                          )}
                          {hasPane && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-sidebar bg-emerald-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px]">{task.name}</div>
                          <div className="truncate text-xs text-text-faint">
                            {isRunning ? "运行中..." : task.enabled ? "已启用" : "已暂停"}
                            {task.lastRunStatus === "error" ? " · 最近失败" : ""}
                          </div>
                        </div>
                      </button>
                      {isRunning ? (
                        <button
                          type="button"
                          title="终止本次执行"
                          className="shrink-0 rounded-md p-1.5 text-text-faint transition hover:bg-rose-500/15 hover:text-rose-400"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void window.agenticxDesktop.cancelAutomationTaskRun(task.id);
                          }}
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </aside>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] rounded-lg border border-border bg-surface-panel py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            ...(contextMenu.target === "avatar"
              ? [
                  {
                    id: "pin",
                    label: avatars.find((a) => a.id === contextMenu.avatarId)?.pinned
                      ? "取消置顶"
                      : "置顶",
                  },
                  { id: "settings", label: "设置" },
                  { id: "delete", label: "删除" },
                ]
              : [
                  { id: "settings", label: "设置" },
                ]),
          ].map((item) => (
            <button
              key={item.id}
              className={`w-full px-3 py-2 text-left text-[13px] transition ${
                item.id === "delete"
                  ? "text-rose-400 hover:bg-rose-500/10"
                  : "text-text-muted hover:bg-surface-hover"
              }`}
              onClick={() => void handleContextAction(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {groupContextMenu && (
        <div
          ref={groupMenuRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-surface-panel py-1 shadow-xl"
          style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
        >
          <button
            className="w-full px-3 py-2 text-left text-[13px] text-text-muted transition hover:bg-surface-hover"
            onClick={() => void handleGroupContextAction("view")}
          >
            查看群聊
          </button>
        </div>
      )}

      {automationContextMenu && (
        <div
          ref={automationMenuRef}
          className="fixed z-50 min-w-[120px] rounded-lg border border-border bg-surface-panel py-1 shadow-xl"
          style={{ left: automationContextMenu.x, top: automationContextMenu.y }}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-[13px] text-text-muted transition hover:bg-surface-hover"
            onClick={() => {
              const { taskId } = automationContextMenu;
              setAutomationContextMenu(null);
              const t = automationTasks.find((item) => item.id === taskId);
              if (t) setAutomationFormInitial({ ...t });
            }}
          >
            编辑
          </button>
        </div>
      )}

      {automationFormInitial && (
        <TaskFormPanel
          initial={automationFormInitial}
          onSave={handleAutomationFormSave}
          onCancel={() => setAutomationFormInitial(null)}
          onAfterDelete={async () => {
            setAutomationFormInitial(null);
            void refreshAutomationTasks();
          }}
        />
      )}

      <AvatarCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          void refreshAvatars();
        }}
        onCreate={handleCreate}
      />
      {settingsPanel && (
        <AvatarSettingsPanel
          {...(settingsPanel.mode === "avatar"
            ? {
                mode: "avatar" as const,
                avatar: avatars.find((a) => a.id === settingsPanel.avatarId)!,
              }
            : { mode: "machi" as const })}
          onClose={() => setSettingsPanel(null)}
          onSaved={() => void refreshAvatars()}
        />
      )}

      {groupCreateOpen && (
        <GroupEditorInline
          avatars={avatars}
          onClose={() => setGroupCreateOpen(false)}
          onSaved={() => {
            setGroupCreateOpen(false);
            void refreshGroups();
          }}
        />
      )}

      {groupEditTarget && (
        <GroupEditorInline
          avatars={avatars}
          initialGroup={groupEditTarget}
          onDelete={async (groupId) => {
            const group = groups.find((item) => item.id === groupId);
            if (!group) return;
            await handleGroupDelete(group);
            setGroupEditTarget(null);
          }}
          onClose={() => {
            setGroupEditTarget(null);
          }}
          onSaved={() => {
            void refreshGroups();
          }}
        />
      )}
    </>
  );
}

function GroupEditorInline({
  avatars,
  initialGroup,
  onDelete,
  onClose,
  onSaved,
}: {
  avatars: Avatar[];
  initialGroup?: GroupChat;
  onDelete?: (groupId: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialGroup?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialGroup?.avatarIds ?? []));
  const [loading, setLoading] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const validAvatarIds = useMemo(() => avatars.map((item) => String(item.id ?? "").trim()).filter(Boolean), [avatars]);

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
      setSaveNotice({
        type: "error",
        text: "分身列表尚未加载完成，请稍后再保存。",
      });
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
      setSaveNotice({
        type: "error",
        text: "请至少选择 1 个有效分身后再保存。",
      });
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
          setSaveNotice({
            type: "error",
            text: getGroupSaveErrorMessage(result.error),
          });
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
          setSaveNotice({
            type: "error",
            text: getGroupSaveErrorMessage(result.error),
          });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-80 max-w-[95vw] rounded-xl border border-border bg-surface-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-[15px] font-semibold text-white">{initialGroup ? "编辑群聊" : "新建群聊"}</h3>

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
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
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
