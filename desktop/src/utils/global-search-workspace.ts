import { useAppStore } from "../store";
import { isPaneAwaitingFreshSession } from "./pane-fresh-session";
import { formatTaskspaceAddError } from "./taskspace-errors";

export type GlobalSearchWorkspaceResult = { ok: boolean; error?: string };

/** Add a folder to the active pane's workspace (same guards as WorkspacePanel.addTaskspace). */
export async function addFolderToActiveWorkspace(folderPath: string): Promise<GlobalSearchWorkspaceResult> {
  const trimmed = folderPath.trim();
  if (!trimmed) return { ok: false, error: "路径无效" };

  const store = useAppStore.getState();
  const pane = store.panes.find((p) => p.id === store.activePaneId);
  if (!pane) return { ok: false, error: "无激活窗格" };

  const paneAvatarId = pane.avatarId ?? "";
  const paneAvatarName = pane.avatarName ?? "";
  let effectiveSessionId = (pane.sessionId || "").trim();

  if (!effectiveSessionId) {
    const isGroupOrAutomationPane =
      !!paneAvatarId && (paneAvatarId.startsWith("group:") || paneAvatarId.startsWith("automation:"));
    if (isGroupOrAutomationPane) {
      return { ok: false, error: "会话正在初始化，请稍候再试" };
    }
    if (isPaneAwaitingFreshSession(pane.id)) {
      return { ok: false, error: "请先发送一条消息，再添加工作区目录" };
    }
    try {
      const createPayload: { avatar_id?: string; name?: string } = {};
      if (paneAvatarId) createPayload.avatar_id = paneAvatarId;
      if (paneAvatarName) createPayload.name = paneAvatarName;
      const created = await window.agenticxDesktop.createSession(createPayload);
      if (!created.ok || !created.session_id) {
        return { ok: false, error: created.error ?? "创建会话失败，无法添加工作区" };
      }
      effectiveSessionId = created.session_id;
      store.setPaneSessionId(pane.id, effectiveSessionId);
    } catch (err) {
      return { ok: false, error: `创建会话失败：${String(err)}` };
    }
  }

  const label = trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
  const result = await window.agenticxDesktop.addTaskspace({
    sessionId: effectiveSessionId,
    path: trimmed,
    label,
  });
  if (!result.ok) {
    return { ok: false, error: formatTaskspaceAddError(result.error) };
  }
  window.dispatchEvent(new CustomEvent("near:global-search:workspace-added", { detail: { paneId: pane.id } }));
  return { ok: true };
}
