import type { ForwardConfirmPayload } from "../components/ForwardPicker";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { useAppStore } from "../store";

type ResolveDeps = {
  addPane: (avatarId: string | null, avatarName: string, sessionId?: string) => string;
  setActivePaneId: (paneId: string) => void;
  setActiveAvatarId: (avatarId: string | null) => void;
  setPaneSessionId: (paneId: string, sessionId: string) => void;
};

function paneAvatarIdForPayload(avatarId: string | null | undefined): string | null {
  if (avatarId == null || String(avatarId).trim() === "") return null;
  return String(avatarId).trim();
}

function activeAvatarIdForPane(avatarId: string | null): string | null {
  if (!avatarId) return null;
  if (avatarId.startsWith("group:")) return null;
  return avatarId;
}

function displayNameForAvatar(avatarId: string | null, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  if (!avatarId) return META_AGENT_DISPLAY_NAME;
  if (avatarId.startsWith("group:")) return `群聊 · ${avatarId.slice("group:".length)}`;
  return avatarId;
}

async function ensureSessionOnPane(
  paneId: string,
  create: () => Promise<{ ok: boolean; session_id?: string; error?: string }>,
  errorFallback: string,
  deps: ResolveDeps
): Promise<string> {
  const created = await create();
  if (!created.ok || !created.session_id) {
    throw new Error(created.error || errorFallback);
  }
  deps.setPaneSessionId(paneId, created.session_id);
  return created.session_id;
}

/**
 * Resolve a ForwardPicker confirm payload into an open pane + session.
 * Opens / creates panes when the target session is not already visible.
 */
export async function resolveForwardTarget(
  payload: ForwardConfirmPayload,
  deps: ResolveDeps
): Promise<{ paneId: string; sessionId: string }> {
  const state = useAppStore.getState();

  if (payload.type === "session") {
    const sid = payload.sessionId.trim();
    if (!sid) throw new Error("目标会话无效");
    const existingBySession = state.panes.find((item) => (item.sessionId || "").trim() === sid);
    if (existingBySession) {
      deps.setActivePaneId(existingBySession.id);
      deps.setActiveAvatarId(activeAvatarIdForPane(existingBySession.avatarId ?? null));
      return { paneId: existingBySession.id, sessionId: sid };
    }
    const avatarId = paneAvatarIdForPayload(payload.avatarId);
    const displayName = displayNameForAvatar(avatarId, payload.displayName);
    let pane = state.panes.find((item) => (item.avatarId ?? null) === avatarId);
    let paneId: string;
    if (!pane) {
      paneId = deps.addPane(avatarId, displayName, sid);
    } else {
      paneId = pane.id;
      deps.setPaneSessionId(paneId, sid);
    }
    deps.setActivePaneId(paneId);
    deps.setActiveAvatarId(activeAvatarIdForPane(avatarId));
    return { paneId, sessionId: sid };
  }

  if (payload.type === "meta") {
    let pane = state.panes.find((item) => item.avatarId === null);
    if (!pane) {
      const paneId = deps.addPane(null, META_AGENT_DISPLAY_NAME, "");
      deps.setActiveAvatarId(null);
      const sessionId = await ensureSessionOnPane(
        paneId,
        () => window.agenticxDesktop.createSession({}),
        "创建主智能体会话失败",
        deps
      );
      return { paneId, sessionId };
    }
    if (payload.forceNewSession) {
      const sessionId = await ensureSessionOnPane(
        pane.id,
        () => window.agenticxDesktop.createSession({}),
        "创建主智能体会话失败",
        deps
      );
      deps.setActivePaneId(pane.id);
      deps.setActiveAvatarId(null);
      return { paneId: pane.id, sessionId };
    }
    let sid = (pane.sessionId || "").trim();
    if (!sid) {
      sid = await ensureSessionOnPane(
        pane.id,
        () => window.agenticxDesktop.createSession({}),
        "创建主智能体会话失败",
        deps
      );
    }
    deps.setActivePaneId(pane.id);
    deps.setActiveAvatarId(null);
    return { paneId: pane.id, sessionId: sid };
  }

  if (payload.type === "avatar") {
    let pane = state.panes.find((item) => item.avatarId === payload.avatarId);
    if (!pane) {
      const paneId = deps.addPane(payload.avatarId, payload.displayName, "");
      deps.setActiveAvatarId(payload.avatarId);
      const sessionId = await ensureSessionOnPane(
        paneId,
        () => window.agenticxDesktop.createSession({ avatar_id: payload.avatarId }),
        "创建专家会话失败",
        deps
      );
      return { paneId, sessionId };
    }
    if (payload.forceNewSession) {
      const sessionId = await ensureSessionOnPane(
        pane.id,
        () => window.agenticxDesktop.createSession({ avatar_id: payload.avatarId }),
        "创建专家会话失败",
        deps
      );
      deps.setActivePaneId(pane.id);
      deps.setActiveAvatarId(payload.avatarId);
      return { paneId: pane.id, sessionId };
    }
    let sid = (pane.sessionId || "").trim();
    if (!sid) {
      sid = await ensureSessionOnPane(
        pane.id,
        () => window.agenticxDesktop.createSession({ avatar_id: payload.avatarId }),
        "创建专家会话失败",
        deps
      );
    }
    deps.setActivePaneId(pane.id);
    deps.setActiveAvatarId(payload.avatarId);
    return { paneId: pane.id, sessionId: sid };
  }

  const groupAvatarId = `group:${payload.groupId}`;
  let groupPane = state.panes.find((item) => item.avatarId === groupAvatarId);
  if (!groupPane) {
    const paneId = deps.addPane(groupAvatarId, `群聊 · ${payload.displayName}`, "");
    deps.setActiveAvatarId(null);
    const sessionId = await ensureSessionOnPane(
      paneId,
      () =>
        window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        }),
      "创建群聊会话失败",
      deps
    );
    return { paneId, sessionId };
  }
  if (payload.forceNewSession) {
    const sessionId = await ensureSessionOnPane(
      groupPane.id,
      () =>
        window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        }),
      "创建群聊会话失败",
      deps
    );
    deps.setActivePaneId(groupPane.id);
    deps.setActiveAvatarId(null);
    return { paneId: groupPane.id, sessionId };
  }
  let sid = (groupPane.sessionId || "").trim();
  if (!sid) {
    sid = await ensureSessionOnPane(
      groupPane.id,
      () =>
        window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: payload.displayName,
        }),
      "创建群聊会话失败",
      deps
    );
  }
  deps.setActivePaneId(groupPane.id);
  deps.setActiveAvatarId(null);
  return { paneId: groupPane.id, sessionId: sid };
}
