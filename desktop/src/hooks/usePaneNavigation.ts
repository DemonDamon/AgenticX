import { useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { getRememberedSessionForAvatar } from "../utils/avatar-last-session";

/**
 * Shared pane-navigation logic used by the nav sidebar, the avatar gallery
 * and the projects view. Extracted verbatim from the former AvatarSidebar
 * helpers so session-restore behaviour stays identical.
 */

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
      const existing = panes.find((item) => item.avatarId === avatarId);
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
          const created = await window.agenticxDesktop.createSession({
            avatar_id: groupAvatarId,
            name: group.name,
          });
          if (created.ok && created.session_id) {
            setPaneSessionId(paneId, created.session_id);
          }
        } finally {
          openingRef.current = false;
        }
      })();
    },
    [panes, addPane, setActivePaneId, setActiveAvatarId, setPaneSessionId, setMainView]
  );

  /** "新建任务": focus the meta pane and start a brand-new conversation. */
  const newMetaTask = useCallback(() => {
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
        new CustomEvent("agenticx:pane:new-topic", { detail: { paneId: targetPaneId } })
      );
    }, 0);
  }, [panes, addPane, setActivePaneId, setActiveAvatarId, setMainView]);

  return { openMetaOrAvatarPane, openGroupPane, newMetaTask };
}
