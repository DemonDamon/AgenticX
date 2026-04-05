/** 侧栏「定时」任务专属窗格 avatar_id 形如 automation:<taskId> */
export function isAutomationPaneAvatarId(avatarId: string | null | undefined): boolean {
  return typeof avatarId === "string" && avatarId.trim().startsWith("automation:");
}
