import { isPaneAwaitingFreshSession } from "./pane-fresh-session";

export function shouldKeepWorkspaceVisibleWhenSessionMissing(
  sessionId: string,
  awaitingFreshSession: boolean
): boolean {
  return sessionId.trim().length === 0 && awaitingFreshSession;
}

/**
 * Workspace selection is a valid first action in a new topic. Materialize the
 * lazy session before attaching a directory instead of requiring a chat turn.
 */
export async function ensureWorkspaceSessionBeforeFirstMessage(
  sessionId: string,
  materializeSession: () => Promise<string | null>,
): Promise<string | null> {
  const existing = sessionId.trim();
  if (existing) return existing;
  const created = (await materializeSession())?.trim() ?? "";
  return created || null;
}

/** Keep the new-topic workspace control mounted while its first session loads. */
export function shouldKeepNewTopicWorkspaceControls(
  hasStartedChat: boolean,
  loadingMessages: boolean,
  workspaceLoading: boolean,
): boolean {
  return !hasStartedChat && (!loadingMessages || workspaceLoading);
}

export type NewTaskNavPane = {
  id: string;
  avatarId: string | null;
  sessionId?: string;
};

/** Sidebar「新建任务」选中：Meta 窗格、尚未 lazy-create 会话、用户还未发出首条 query。 */
export function isNewTaskNavActive(
  mainView: string,
  activePane: NewTaskNavPane | undefined
): boolean {
  if (mainView !== "chat") return false;
  if (!activePane || activePane.avatarId !== null) return false;
  const sessionId = String(activePane.sessionId ?? "").trim();
  if (sessionId.length > 0) return false;
  return isPaneAwaitingFreshSession(activePane.id);
}
