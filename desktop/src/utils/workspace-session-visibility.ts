import { isPaneAwaitingFreshSession } from "./pane-fresh-session";

export function shouldKeepWorkspaceVisibleWhenSessionMissing(
  sessionId: string,
  awaitingFreshSession: boolean
): boolean {
  return sessionId.trim().length === 0 && awaitingFreshSession;
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
