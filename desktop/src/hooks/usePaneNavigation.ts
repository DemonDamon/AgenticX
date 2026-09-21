import { useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";
import {
  existingGroupPaneNeedsBind,
  pickConfirmedGroupSessionId,
  pickOptimisticGroupSessionId,
  pickPreferredSessionId,
  shouldCreateGroupSession,
  shouldSkipGroupSessionListOnOpen,
  type GroupOpenSessionRow,
} from "../utils/group-pane-open";
import { scratchHistoryBlocklist } from "../utils/scratch-chat";
import { schedulePrefetchSessionTail } from "../utils/session-tail-cache";
import { resolveGroupTitle } from "../utils/quick-compose";

/**
 * Shared pane-navigation logic used by the nav sidebar, the avatar gallery
 * and the projects view. Extracted verbatim from the former AvatarSidebar
 * helpers so session-restore behaviour stays identical.
 */

type SessionListItem = GroupOpenSessionRow & {
  session_id: string;
  avatar_id: string | null;
  updated_at: number;
  provider?: string;
  model?: string;
};

export function usePaneNavigation() {
  const panes = useAppStore((s) => s.panes);
  const addPane = useAppStore((s) => s.addPane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setMainView = useAppStore((s) => s.setMainView);
  const openingRef = useRef(false);

  /** Open or focus the meta-agent / a normal avatar pane, restoring the most-recent session. */
  const openMetaOrAvatarPane = useCallback(
    (avatarId: string | null, avatarName: string) => {
      setMainView("chat");
      const existing = panes.find((item) => item.avatarId === avatarId && !item.composePreview);
      if (existing) {
        setActivePaneId(existing.id);
        setActiveAvatarId(avatarId);
        void (async () => {
          const listed = await window.agenticxDesktop
            .listSessions(avatarId ?? undefined)
            .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
          const blocked = scratchHistoryBlocklist(
            useAppStore.getState().panes,
            useAppStore.getState().hiddenScratchSessionIds,
          );
          const currentSid = String(existing.sessionId ?? "").trim();
          if (currentSid && !blocked.has(currentSid) && listed.ok && Array.isArray(listed.sessions)) {
            const currentRow = listed.sessions.find(
              (item) => String(item.session_id ?? "").trim() === currentSid
            );
            if (currentRow) {
              setPaneSessionId(existing.id, currentSid, {
                provider: currentRow.provider,
                model: currentRow.model,
              });
              return;
            }
          }
          if (!currentSid || blocked.has(currentSid)) {
            const rows = listed.ok && Array.isArray(listed.sessions) ? listed.sessions : [];
            const preferredSid = pickPreferredSessionId({
              sessions: rows,
              avatarId,
              rememberedSid: getRememberedSessionForAvatar(avatarId),
              blockedIds: blocked,
            });
            const preferredRow = preferredSid
              ? rows.find((item) => String(item.session_id ?? "").trim() === preferredSid)
              : undefined;
            if (preferredSid) {
              const latestPane = useAppStore
                .getState()
                .panes.find((item) => item.id === existing.id);
              const latestSid = String(latestPane?.sessionId ?? "").trim();
              if (!latestSid || blocked.has(latestSid)) {
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
          const listed = await window.agenticxDesktop
            .listSessions(avatarId ?? undefined)
            .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
          const blocked = scratchHistoryBlocklist(
            useAppStore.getState().panes,
            useAppStore.getState().hiddenScratchSessionIds,
          );
          const rows = listed.ok && Array.isArray(listed.sessions) ? listed.sessions : [];
          const preferredSid = pickPreferredSessionId({
            sessions: rows,
            avatarId,
            rememberedSid: getRememberedSessionForAvatar(avatarId),
            blockedIds: blocked,
          });
          const preferredRow = preferredSid
            ? rows.find((item) => String(item.session_id ?? "").trim() === preferredSid)
            : undefined;
          if (preferredSid) {
            setPaneSessionId(paneId, preferredSid, {
              provider: preferredRow?.provider,
              model: preferredRow?.model,
            });
            return;
          }
          // Lazy session: first real send in ChatPane will createSession.
        } finally {
          openingRef.current = false;
        }
      })();
    },
    [panes, addPane, setActivePaneId, setActiveAvatarId, setPaneSessionId, setMainView]
  );

  /** Open or focus a group-chat pane. */
  const openGroupPane = useCallback(
    (group: { id: string; name: string; avatarIds?: string[] }) => {
      setMainView("chat");
      const groupAvatarId = `group:${group.id}`;
      const memberNames = (group.avatarIds ?? []).map(
        (id) => useAppStore.getState().avatars.find((item) => item.id === id)?.name ?? "",
      );
      const title = resolveGroupTitle(group.name, memberNames);
      const existing = panes.find((item) => item.avatarId === groupAvatarId && !item.composePreview);

      const bindGroupPaneSession = async (paneId: string) => {
        const rememberedSid = getRememberedSessionForAvatar(groupAvatarId);
        const readCurrentSid = () =>
          String(
            useAppStore.getState().panes.find((item) => item.id === paneId)?.sessionId ?? ""
          ).trim();
        const blocked = scratchHistoryBlocklist(
          useAppStore.getState().panes,
          useAppStore.getState().hiddenScratchSessionIds,
        );
        const optimisticSid = pickOptimisticGroupSessionId(rememberedSid);
        if (optimisticSid && !blocked.has(optimisticSid) && !readCurrentSid()) {
          setPaneSessionId(paneId, optimisticSid);
          schedulePrefetchSessionTail(optimisticSid);
        }
        if (
          shouldSkipGroupSessionListOnOpen({
            optimisticSid,
            currentSid: readCurrentSid(),
          })
        ) {
          return;
        }

        const listed = await window.agenticxDesktop
          .listSessions(groupAvatarId)
          .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
        const listedRows =
          listed.ok && Array.isArray(listed.sessions) ? listed.sessions : [];
        const confirmedSid = pickConfirmedGroupSessionId({
          rememberedSid,
          listed: listedRows,
          groupAvatarId,
          blockedIds: blocked,
        });
        if (confirmedSid) {
          if (readCurrentSid() !== confirmedSid) {
            setPaneSessionId(paneId, confirmedSid);
          }
          return;
        }
        if (!shouldCreateGroupSession({ confirmedSid, currentSid: readCurrentSid() })) {
          return;
        }
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: group.name,
        });
        if (created.ok && created.session_id) {
          setPaneSessionId(paneId, created.session_id);
        }
      };

      if (existing) {
        const nextTitle = `群聊 · ${title}`;
        if (existing.avatarName !== nextTitle) {
          useAppStore.setState((state) => ({
            panes: state.panes.map((pane) =>
              pane.id === existing.id ? { ...pane, avatarName: nextTitle } : pane,
            ),
          }));
        }
        setActivePaneId(existing.id);
        setActiveAvatarId(null);
        const existingSid = String(existing.sessionId ?? "").trim();
        const blockedExisting = scratchHistoryBlocklist(
          useAppStore.getState().panes,
          useAppStore.getState().hiddenScratchSessionIds,
        );
        if (!existingGroupPaneNeedsBind(existing.sessionId) && !blockedExisting.has(existingSid)) return;
        void bindGroupPaneSession(existing.id);
        return;
      }

      if (openingRef.current) return;
      openingRef.current = true;

      const rememberedSid = getRememberedSessionForAvatar(groupAvatarId);
      const blocked = scratchHistoryBlocklist(
        useAppStore.getState().panes,
        useAppStore.getState().hiddenScratchSessionIds,
      );
      const rawOptimistic = pickOptimisticGroupSessionId(rememberedSid) ?? "";
      const optimisticSid = rawOptimistic && !blocked.has(rawOptimistic) ? rawOptimistic : "";
      const paneId = addPane(groupAvatarId, `群聊 · ${title}`, optimisticSid);
      setActivePaneId(paneId);
      setActiveAvatarId(null);
      if (optimisticSid) {
        schedulePrefetchSessionTail(optimisticSid);
      }

      void bindGroupPaneSession(paneId).finally(() => {
        openingRef.current = false;
      });
    },
    [panes, addPane, setActivePaneId, setActiveAvatarId, setPaneSessionId, setMainView]
  );

  /**
   * "新建任务": focus the meta pane and start a brand-new conversation.
   * Optional `draftText` pre-fills the composer (editable, not auto-sent) —
   * used by the avatar gallery's "AI 创建" flow to hand off a template prompt.
   */
  const newMetaTask = useCallback((draftText?: string) => {
    setMainView("chat");
    const metaPane = panes.find((item) => item.avatarId === null);
    let paneId = metaPane?.id;
    if (metaPane) {
      setActivePaneId(metaPane.id);
    } else {
      paneId = addPane(null, META_AGENT_DISPLAY_NAME, "");
      setActivePaneId(paneId);
    }
    setActiveAvatarId(null);
    const targetPaneId = paneId;
    // Defer so the pane is mounted/focused before it handles the new-topic event.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("agenticx:pane:new-topic", { detail: { paneId: targetPaneId, draftText } })
      );
    }, 0);
  }, [panes, addPane, setActivePaneId, setActiveAvatarId, setMainView]);

  return { openMetaOrAvatarPane, openGroupPane, newMetaTask };
}
