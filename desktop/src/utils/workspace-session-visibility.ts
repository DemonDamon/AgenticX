import { isPaneAwaitingFreshSession } from "./pane-fresh-session";
import { shouldClearMessagesOnSessionSwitch } from "./pane-session-switch";

export function shouldKeepWorkspaceVisibleWhenSessionMissing(
  sessionId: string,
  awaitingFreshSession: boolean
): boolean {
  return sessionId.trim().length === 0 && awaitingFreshSession;
}

/** 新建任务：工作区侧栏默认收起，不沿用上一会话的展开态。 */
export function workspacePanelOpenAfterNewTopic(): boolean {
  return false;
}

/** 切换到另一会话：工作区默认收起，不沿用上一会话的文件/终端展示。 */
export function workspacePanelOpenAfterSessionSwitch(): boolean {
  return false;
}

export function nextTaskspacePanelOpenOnSessionBind(args: {
  prevSessionId: string | null | undefined;
  nextSessionId: string | null | undefined;
  currentlyOpen: boolean;
}): boolean {
  if (shouldClearMessagesOnSessionSwitch(args.prevSessionId, args.nextSessionId)) {
    return workspacePanelOpenAfterSessionSwitch();
  }
  return args.currentlyOpen;
}

/**
 * A session created by this pane is authoritatively empty. Treat it as already
 * bootstrapped so the generic history loader does not flash its conversation
 * skeleton between the new-topic empty state and the workspace menu.
 */
export function bootstrapMarkerForSessionBinding(
  boundSessionId: string,
  freshlyCreatedSessionId: string,
): string {
  const bound = boundSessionId.trim();
  const fresh = freshlyCreatedSessionId.trim();
  return bound && bound === fresh ? bound : "";
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
