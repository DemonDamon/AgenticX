import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CollabRoomConversation } from "../collab/CollabRoomConversation";
import { HoverTip } from "../ds/HoverTip";
import { useAppStore } from "../../store";
import { buildRoomTree, flattenRoomTree, type CollabTreeRoom } from "../../utils/collab-project-tree";
import type { RoomStreamStatus } from "../../utils/collab-room-view";
import { CreateSubRoomDialog } from "./CreateSubRoomDialog";
import { MergeBackDialog, type MergeMode, type MergeRoomRef } from "./MergeBackDialog";

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

type ProjectInfo = {
  id: string;
  name: string;
  main_room_id: string;
  owner_user_id: string;
};

type RoomInfo = CollabTreeRoom & {
  member_count: number;
  last_seq: number;
};

type MemberInfo = {
  id: string;
  member_type: string;
  member_id: string;
  display_name: string;
  room_role: string;
};

type DirectoryUser = {
  id: string;
  display_name: string;
  email: string;
  dept_name: string;
};

type SubDraft = {
  seedIds: string[];
  humans: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  selfUserId: string;
};

function asMember(raw: unknown): MemberInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    member_type: typeof item.member_type === "string" ? item.member_type : "human",
    member_id: typeof item.member_id === "string" ? item.member_id : "",
    display_name: typeof item.display_name === "string" ? item.display_name : "",
    room_role: typeof item.room_role === "string" ? item.room_role : "member",
  };
}

function peerLabel(title: string, selfName: string): string {
  const parts = title.split(" / ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return title;
  const other = parts.find((part) => part !== selfName);
  return other || title;
}

function statusView(status: RoomStreamStatus): { key: "connecting" | "live" | "reconnecting" | "unavailable"; dot: string } {
  switch (status) {
    case "connecting":
      return { key: "connecting", dot: "bg-text-faint" };
    case "live":
      return { key: "live", dot: "bg-emerald-500" };
    case "retrying":
      return { key: "reconnecting", dot: "bg-amber-400" };
    case "revoked":
    case "error":
      return { key: "unavailable", dot: "bg-rose-400" };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function roleCanInvite(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const { t } = useTranslation("projects");
  const openProject = useAppStore((s) => s.openProject);
  const openSettings = useAppStore((s) => s.openSettings);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [mainMembers, setMainMembers] = useState<MemberInfo[]>([]);
  const [viewerUserId, setViewerUserId] = useState("");
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(true);
  const [query, setQuery] = useState("");
  const [streamStatus, setStreamStatus] = useState<RoomStreamStatus>("connecting");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberPos, setMemberPos] = useState<{ top: number; left: number } | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [inviteError, setInviteError] = useState("");
  const [invitingId, setInvitingId] = useState("");
  const [subDialog, setSubDialog] = useState<SubDraft | null>(null);
  const [subError, setSubError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeInitial, setMergeInitial] = useState<MergeMode>("all");
  const [mergeError, setMergeError] = useState("");
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const memberButtonRef = useRef<HTMLButtonElement>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const load = useCallback(
    async (preferId?: string) => {
      const requested = projectId;
      try {
        const listed = await window.agenticxDesktop.collabProjectGet(projectId);
        if (projectIdRef.current !== requested) return;
        if (!listed.ok || !listed.data) {
          if (listed.error === "enterprise-login-required") {
            setLoggedIn(false);
            setError("");
            return;
          }
          setError(listed.error || t("loadFailed"));
          return;
        }
        setLoggedIn(true);
        setError("");
        setProject({
          id: listed.data.project.id,
          name: listed.data.project.name,
          main_room_id: listed.data.project.main_room_id,
          owner_user_id: listed.data.project.owner_user_id,
        });
        const nextRooms: RoomInfo[] = listed.data.rooms.map((room) => ({
          id: room.id,
          title: room.title,
          parent_room_id: room.parent_room_id,
          room_kind: room.room_kind,
          member_count: room.member_count,
          last_seq: room.last_seq,
        }));
        setRooms(nextRooms);
        const main = nextRooms.find((room) => room.room_kind === "main") ?? nextRooms[0];
        setSelectedRoomId((prev) => {
          if (preferId && nextRooms.some((room) => room.id === preferId)) return preferId;
          if (prev && nextRooms.some((room) => room.id === prev)) return prev;
          return main?.id ?? null;
        });
        if (main) {
          const detail = await window.agenticxDesktop.collabRoomGet(main.id);
          if (projectIdRef.current !== requested) return;
          if (detail.ok) {
            setMainMembers(
              (detail.data?.members ?? []).map(asMember).filter((item): item is MemberInfo => item != null),
            );
            setViewerUserId(typeof detail.data?.viewer_user_id === "string" ? detail.data.viewer_user_id : "");
          }
        }
      } catch (err) {
        if (projectIdRef.current !== requested) return;
        setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    },
    [projectId, t],
  );

  useEffect(() => {
    setProject(null);
    setRooms([]);
    setSelectedRoomId(null);
    setMainMembers([]);
    setViewerUserId("");
    setError("");
    setQuery("");
    setMembersOpen(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSubDialog(null);
    setMergeOpen(false);
    setNotice("");
  }, [selectedRoomId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const humans = mainMembers.filter((member) => member.member_type === "human");
  const selfMember = humans.find((member) => member.member_id === viewerUserId);
  const canInvite = selfMember ? roleCanInvite(selfMember.room_role) : false;
  const selfName = selfMember?.display_name ?? "";

  useEffect(() => {
    if (!membersOpen || !canInvite) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await window.agenticxDesktop.collabDirectorySearch(inviteQuery);
          if (!res.ok) {
            setInviteError(res.error || t("loadFailed"));
            setDirectory([]);
            return;
          }
          setInviteError("");
          setDirectory(res.data?.users ?? []);
        } catch (err) {
          setInviteError(err instanceof Error ? err.message : t("loadFailed"));
          setDirectory([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [canInvite, inviteQuery, membersOpen, t]);

  useEffect(() => {
    if (!membersOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-project-members]")) return;
      setMembersOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMembersOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [membersOpen]);

  const tree = useMemo(() => buildRoomTree(rooms), [rooms]);
  const trunkRows = useMemo(() => flattenRoomTree(tree.trunk), [tree.trunk]);
  const selected = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const canMerge = selected?.room_kind === "sub" || selected?.room_kind === "direct";
  const mergeRooms: MergeRoomRef[] = rooms.map((room) => ({
    id: room.id,
    title: room.title,
    room_kind: room.room_kind,
    parent_room_id: room.parent_room_id ?? null,
  }));
  const status = statusView(streamStatus);
  const knownIds = useMemo(() => new Set(humans.map((member) => member.member_id)), [humans]);
  const suggestions = directory.filter((user) => user.id !== viewerUserId && !knownIds.has(user.id));

  const onStreamStatus = useCallback((next: RoomStreamStatus) => {
    setStreamStatus((prev) => (prev === next ? prev : next));
  }, []);

  const toggleSelect = (messageId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const openMembers = () => {
    const rect = memberButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 320;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setMemberPos({ top: rect.bottom + 6, left });
    }
    setInviteQuery("");
    setInviteError("");
    setMembersOpen((open) => !open);
  };

  const invite = async (user: DirectoryUser) => {
    if (invitingId) return;
    setInvitingId(user.id);
    setInviteError("");
    try {
      const res = await window.agenticxDesktop.collabProjectAddMember(projectId, {
        user_id: user.id,
        display_name: user.display_name,
      });
      if (!res.ok) {
        setInviteError(res.error || t("members.addFailed"));
        return;
      }
      setDirectory((list) => list.filter((item) => item.id !== user.id));
      await load(selectedRoomId ?? undefined);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : t("members.addFailed"));
    } finally {
      setInvitingId("");
    }
  };

  const openDirect = async (member: MemberInfo) => {
    try {
      const res = await window.agenticxDesktop.collabProjectOpenDirect(projectId, {
        peer_user_id: member.member_id,
        peer_display_name: member.display_name,
      });
      if (!res.ok || !res.data?.room.id) {
        setInviteError(res.error || t("loadFailed"));
        return;
      }
      setMembersOpen(false);
      await load(res.data.room.id);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : t("loadFailed"));
    }
  };

  const openSub = async (seedIds: string[]) => {
    if (!selectedRoomId) return;
    const seeds = seedIds.filter((id) => ULID_RE.test(id));
    let nextHumans: { id: string; name: string }[] = [];
    let nextAgents: { id: string; name: string }[] = [];
    let selfId = viewerUserId;
    try {
      const detail = await window.agenticxDesktop.collabRoomGet(selectedRoomId);
      if (detail.ok) {
        const parsed = (detail.data?.members ?? []).map(asMember).filter((item): item is MemberInfo => item != null);
        if (typeof detail.data?.viewer_user_id === "string" && detail.data.viewer_user_id) {
          selfId = detail.data.viewer_user_id;
        }
        nextHumans = parsed
          .filter((member) => member.member_type === "human")
          .map((member) => ({ id: member.member_id, name: member.display_name }));
        nextAgents = parsed
          .filter((member) => member.member_type === "agent")
          .map((member) => ({ id: member.member_id, name: member.display_name }));
      }
    } catch {
      /* still offer a room with the current user */
    }
    if (selfId && !nextHumans.some((person) => person.id === selfId)) {
      nextHumans.unshift({ id: selfId, name: selfName || t("collab.me", { ns: "workspace" }) });
    }
    setSubError("");
    setSubmitting(false);
    setSubDialog({ seedIds: seeds, humans: nextHumans, agents: nextAgents, selfUserId: selfId });
  };

  const createSub = async (input: {
    title: string;
    memberUserIds: { user_id: string; display_name: string }[];
    agentIds: string[];
  }) => {
    if (!selectedRoomId || !subDialog) return;
    setSubmitting(true);
    setSubError("");
    try {
      const res = await window.agenticxDesktop.collabRoomCreateSub(selectedRoomId, {
        title: input.title,
        member_user_ids: input.memberUserIds,
        agent_ids: input.agentIds,
        seed_message_ids: subDialog.seedIds,
      });
      if (!res.ok || !res.data?.room.id) {
        setSubError(res.error || t("sub.failed"));
        setSubmitting(false);
        return;
      }
      const createdId = res.data.room.id;
      setSubDialog(null);
      setSubmitting(false);
      setSelectedIds(new Set());
      await load(createdId);
    } catch (err) {
      setSubError(err instanceof Error ? err.message : t("sub.failed"));
      setSubmitting(false);
    }
  };

  const openMerge = (mode: MergeMode) => {
    setMergeInitial(mode);
    setMergeError("");
    setMergeSubmitting(false);
    setMergeOpen(true);
  };

  const confirmMerge = async (input: { targetRoomId: string; mode: MergeMode; summaryText: string }) => {
    if (!selectedRoomId) return;
    const messageIds = [...selectedIds].filter((id) => ULID_RE.test(id));
    if (input.mode === "selected" && messageIds.length === 0) {
      setMergeError(t("merge.failed"));
      return;
    }
    setMergeSubmitting(true);
    setMergeError("");
    try {
      const res = await window.agenticxDesktop.collabRoomMerge(selectedRoomId, {
        target_room_id: input.targetRoomId,
        mode: input.mode,
        ...(input.mode === "selected" ? { message_ids: messageIds } : {}),
        ...(input.mode === "summary" ? { summary_text: input.summaryText } : {}),
      });
      if (!res.ok) {
        setMergeError(res.error || t("merge.failed"));
        setMergeSubmitting(false);
        return;
      }
      const target = rooms.find((room) => room.id === input.targetRoomId);
      setMergeOpen(false);
      setMergeSubmitting(false);
      setSelectedIds(new Set());
      setNotice(res.data?.pending ? t("merge.pending") : t("merge.done", { name: target?.title ?? "" }));
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : t("merge.failed"));
      setMergeSubmitting(false);
    }
  };

  const summarize = async () => {
    if (!selectedRoomId) throw new Error(t("loadFailed"));
    const res = await window.agenticxDesktop.collabRoomSummarize(selectedRoomId, {});
    if (!res.ok || typeof res.data?.summary !== "string") {
      throw new Error(res.error || t("loadFailed"));
    }
    return res.data.summary;
  };

  const selectRoom = (roomId: string) => {
    setQuery("");
    setSelectedRoomId(roomId);
  };

  const roomButton = (room: CollabTreeRoom, depth: number) => {
    const active = room.id === selectedRoomId;
    const label = room.room_kind === "direct" ? peerLabel(room.title, selfName) : room.title;
    return (
      <button
        key={room.id}
        type="button"
        className={`mb-1 w-full rounded-md py-2 pr-2.5 text-left text-sm ${
          active ? "bg-surface-card-strong text-text-strong" : "text-text-primary hover:bg-surface-card"
        }`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => selectRoom(room.id)}
      >
        <span className="block truncate font-medium">{label}</span>
      </button>
    );
  };

  if (!loggedIn) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-surface-base p-6">
        <div className="max-w-md rounded-xl border border-border bg-surface-card p-4">
          <p className="text-[13px] text-text-primary">{t("needLogin")}</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            onClick={() => openSettings("account")}
          >
            {t("signIn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface-base">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <nav className="flex min-w-0 items-center gap-1 text-[13px] text-text-muted">
          <button type="button" className="shrink-0 hover:text-text-strong" onClick={() => openProject(null)}>
            {t("title")}
          </button>
          <span>/</span>
          <span className="truncate text-text-strong">{project?.name ?? ""}</span>
          <span>/</span>
          <span className="truncate">
            {selected ? (selected.room_kind === "direct" ? peerLabel(selected.title, selfName) : selected.title) : ""}
          </span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchMessages")}
            aria-label={t("searchMessages")}
            className="w-[180px] max-w-full rounded-md border border-border bg-surface-card px-2 py-1 text-[12px] text-text-primary outline-none placeholder:text-text-faint"
          />
          <span className="inline-flex items-center gap-1 text-[12px] text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {t(`status.${status.key}`)}
          </span>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-[12px] text-text-muted hover:bg-surface-hover"
            onClick={() => {
              setReloadToken((token) => token + 1);
              void load(selectedRoomId ?? undefined);
            }}
          >
            {t("refresh")}
          </button>
          <button
            ref={memberButtonRef}
            type="button"
            data-project-members
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-text-primary hover:bg-surface-hover"
            onClick={openMembers}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-card text-[10px] text-text-strong">
              {(selfName || project?.name || "?").slice(0, 1)}
            </span>
            <span>· {humans.length}</span>
          </button>
        </div>
      </header>
      {error ? <p className="px-4 py-2 text-[12px] text-rose-400">{error}</p> : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface-base">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="px-2 py-1 text-[11px] text-text-faint">{t("rooms.main")}</div>
            {trunkRows.map((row) => roomButton(row.room, row.depth))}
            <div className="mt-2 px-2 py-1 text-[11px] text-text-faint">{t("rooms.direct")}</div>
            {tree.directs.map((node) => roomButton(node.room, 0))}
          </div>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
          {selectedRoomId ? (
            <CollabRoomConversation
              roomId={selectedRoomId}
              selectable
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              textQuery={query}
              reloadToken={reloadToken}
              showStatus={false}
              onStreamStatus={onStreamStatus}
              onViewSource={(roomId) => selectRoom(roomId)}
              onBack={() => {
                const main = rooms.find((room) => room.room_kind === "main");
                if (main && main.id !== selectedRoomId) selectRoom(main.id);
              }}
              headerTrailing={
                <div className="relative flex items-center gap-1">
                  {notice ? (
                    <div className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-border bg-surface-base px-2 py-1 text-[12px] text-text-primary shadow-lg">
                      {notice}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-text-muted hover:bg-surface-hover"
                    onClick={() => void openSub([])}
                  >
                    {t("sub.create")}
                  </button>
                  {canMerge ? (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-[12px] text-text-muted hover:bg-surface-hover"
                      onClick={() => openMerge("all")}
                    >
                      {t("merge.action")}
                    </button>
                  ) : null}
                </div>
              }
              selectionBar={
                selectedIds.size > 0 ? (
                  <>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-[12px] text-text-primary hover:bg-surface-hover"
                      onClick={() => void openSub([...selectedIds])}
                    >
                      {t("sub.withSelected")}
                    </button>
                    {canMerge ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[12px] text-text-primary hover:bg-surface-hover"
                        onClick={() => openMerge("selected")}
                      >
                        {t("merge.selected")}
                      </button>
                    ) : null}
                  </>
                ) : null
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-text-faint">{t("loadFailed")}</div>
          )}
        </section>
      </div>
      {membersOpen && memberPos
        ? createPortal(
            <div
              data-project-members
              className="fixed z-[260] flex max-h-[480px] w-[320px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
              style={{ top: memberPos.top, left: memberPos.left }}
            >
              <div className="border-b border-border px-3 py-2 text-[13px] font-semibold text-text-strong">
                {t("members.title")} · {humans.length}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {humans.map((member) => {
                  const mine = member.member_id === viewerUserId;
                  const roleLabel = member.room_role === "owner" ? t("members.owner") : t("members.collaborator");
                  return (
                    <li
                      key={member.id}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
                    >
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-card text-[11px] text-text-strong">
                        {(member.display_name || "?").slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text-primary">{member.display_name}</span>
                        <span className="block text-[11px] text-text-faint">{roleLabel}</span>
                      </span>
                      {mine ? null : (
                        <HoverTip label={t("members.direct")}>
                          <button
                            type="button"
                            className="rounded-md px-2 py-0.5 text-[12px] text-text-muted opacity-0 hover:bg-surface-card hover:text-text-strong group-hover:opacity-100 group-focus-within:opacity-100"
                            onClick={() => void openDirect(member)}
                          >
                            {t("members.direct")}
                          </button>
                        </HoverTip>
                      )}
                    </li>
                  );
                })}
              </ul>
              {canInvite ? (
                <div className="border-t border-border px-3 py-2">
                  <div className="text-[12px] text-text-strong">{t("members.invite")}</div>
                  <input
                    value={inviteQuery}
                    onChange={(event) => setInviteQuery(event.target.value)}
                    placeholder={t("members.search")}
                    aria-label={t("members.search")}
                    className="mt-1 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary outline-none"
                  />
                  {inviteError ? <p className="mt-1 text-[12px] text-rose-400">{inviteError}</p> : null}
                  <div className="mt-1 max-h-40 overflow-y-auto">
                    {suggestions.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        disabled={invitingId === user.id}
                        className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-surface-hover disabled:opacity-50"
                        onClick={() => void invite(user)}
                      >
                        <span className="truncate text-[13px] text-text-primary">{user.display_name}</span>
                        <span className="truncate text-[11px] text-text-faint">
                          {user.email}
                          {user.dept_name ? ` · ${user.dept_name}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="border-t border-border px-3 py-2 text-[11px] text-text-faint">{t("members.recordedNotice")}</p>
            </div>,
            document.body,
          )
        : null}
      <CreateSubRoomDialog
        open={subDialog != null}
        humans={subDialog?.humans ?? []}
        agents={subDialog?.agents ?? []}
        selfUserId={subDialog?.selfUserId ?? ""}
        seedCount={subDialog?.seedIds.length ?? 0}
        submitting={submitting}
        error={subError}
        onClose={() => setSubDialog(null)}
        onSubmit={(input) => void createSub(input)}
      />
      {selected ? (
        <MergeBackDialog
          open={mergeOpen}
          source={{
            id: selected.id,
            title: selected.title,
            room_kind: selected.room_kind,
            parent_room_id: selected.parent_room_id ?? null,
          }}
          rooms={mergeRooms}
          selectedCount={[...selectedIds].filter((id) => ULID_RE.test(id)).length}
          initialMode={mergeInitial}
          submitting={mergeSubmitting}
          error={mergeError}
          onClose={() => setMergeOpen(false)}
          onGenerate={summarize}
          onConfirm={(input) => void confirmMerge(input)}
        />
      ) : null}
    </div>
  );
}
