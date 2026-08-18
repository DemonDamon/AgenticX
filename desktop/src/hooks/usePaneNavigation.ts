import { useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";
import {
  existingGroupPaneNeedsBind,
  isSessionAvatarMatch,
  pickConfirmedGroupSessionId,
  pickMostRecentSessionId,
  pickOptimisticGroupSessionId,
  shouldCreateGroupSession,
  shouldSkipGroupSessionListOnOpen,
  type GroupOpenSessionRow,
} from "../utils/group-pane-open";
import { schedulePrefetchSessionTail } from "../utils/session-tail-cache";
import { markPaneAwaitingFreshSession } from "../utils/pane-fresh-session";

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

  /**
   * Open the meta-agent or an expert.
   *
   * The meta-agent keeps its resume-last-session behaviour. An expert entry is
   * deliberately a "start a conversation" action: every click opens a lazy
   * fresh topic in that expert's pane instead of silently restoring old chat.
   */
  const openMetaOrAvatarPane = useCallback(
    (avatarId: string | null, avatarName: string) => {
      setMainView("chat");
      const existing = panes.find((item) => item.avatarId === avatarId);

      if (avatarId !== null) {
        if (existing) {
          setActivePaneId(existing.id);
          setActiveAvatarId(avatarId);
          // Existing panes stay mounted even while hidden, so their targeted
          // listener can reset the conversation synchronously.
          window.dispatchEvent(
            new CustomEvent("agenticx:pane:new-topic", {
              detail: { paneId: existing.id },
            })
          );
          return;
        }

        if (openingRef.current) return;
        openingRef.current = true;
        try {
          const paneId = addPane(avatarId, avatarName, "");
          // A newly-created pane is already empty. Mark it directly instead of
          // racing a one-shot event against the first ChatPane mount.
          markPaneAwaitingFreshSession(paneId);
          setActivePaneId(paneId);
          setActiveAvatarId(avatarId);
        } finally {
          openingRef.current = false;
        }
        return;
      }

      if (existing) {
        setActivePaneId(existing.id);
        setActiveAvatarId(avatarId);
        void (async () => {
          const listed = await window.agenticxDesktop
            .listSessions(avatarId ?? undefined)
            .catch(() => ({ ok: false, sessions: [] as SessionListItem[] }));
          const currentSid = String(existing.sessionId ?? "").trim();
          if (currentSid && listed.ok && Array.isArray(listed.sessions)) {
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
                ? listed.sessions.find(
                    (item) => String(item.session_id ?? "").trim() === preferredSid
                  )
                : undefined;
            if (preferredSid) {
              const latestPane = useAppStore
                .getState()
                .panes.find((item) => item.id === existing.id);
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
              ? listed.sessions.find(
                  (item) => String(item.session_id ?? "").trim() === preferredSid
                )
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
    (group: { id: string; name: string }) => {
      setMainView("chat");
      const groupAvatarId = `group:${group.id}`;
      const existing = panes.find((item) => item.avatarId === groupAvatarId);

      const bindGroupPaneSession = async (paneId: string) => {
        const rememberedSid = getRememberedSessionForAvatar(groupAvatarId);
        const readCurrentSid = () =>
          String(
            useAppStore.getState().panes.find((item) => item.id === paneId)?.sessionId ?? ""
          ).trim();
        const optimisticSid = pickOptimisticGroupSessionId(rememberedSid);
        if (optimisticSid && !readCurrentSid()) {
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
        setActivePaneId(existing.id);
        setActiveAvatarId(null);
        if (!existingGroupPaneNeedsBind(existing.sessionId)) return;
        void bindGroupPaneSession(existing.id);
        return;
      }

      if (openingRef.current) return;
      openingRef.current = true;

      const rememberedSid = getRememberedSessionForAvatar(groupAvatarId);
      const optimisticSid = pickOptimisticGroupSessionId(rememberedSid) ?? "";
      const paneId = addPane(groupAvatarId, `群聊 · ${group.name}`, optimisticSid);
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
