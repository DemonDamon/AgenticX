/**
 * Closing the last chat pane cannot `removePane` (store keeps ≥1 pane).
 * Park-and-clear on a *group/automation* pane leaves `sessionId=""` while
 * keeping `group:` identity, which renders "正在初始化会话…" instead of the
 * Meta 「新建任务」 empty composer.
 */
export type LastPaneCloseAction = "remove" | "reset-meta-home";

export function lastPaneCloseAction(paneCount: number): LastPaneCloseAction {
  return paneCount <= 1 ? "reset-meta-home" : "remove";
}
