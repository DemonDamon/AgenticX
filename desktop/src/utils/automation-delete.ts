/**
 * 删除定时任务：先确认，再可选删除 ~/.agenticx/crontask/<taskId> 目录。
 */

import { useAppStore } from "../store";

export type DeleteAutomationTaskResult = {
  ok: boolean;
  /** 用户在第一步点了取消 */
  cancelled?: boolean;
  error?: string;
};

export async function deleteAutomationTaskWithConfirm(
  taskId: string,
): Promise<DeleteAutomationTaskResult> {
  const id = String(taskId ?? "").trim();
  if (!id) return { ok: false, error: "taskId 无效" };

  if (!window.confirm("确定删除该定时任务？此操作不可恢复。")) {
    return { ok: false, cancelled: true };
  }

  let removeCrontaskDir = false;
  const desktop = window.agenticxDesktop;
  if (desktop.automationCrontaskDirInfo) {
    try {
      const info = await desktop.automationCrontaskDirInfo(id);
      if (info?.ok && info.exists) {
        removeCrontaskDir = window.confirm(
          `是否同时删除该任务在 crontask 目录下的本地文件？\n${info.path}\n此操作不可恢复。`,
        );
      }
    } catch {
      /* 忽略探测失败，仅删任务记录 */
    }
  }

  const payload = removeCrontaskDir ? { taskId: id, removeCrontaskDir: true } : id;
  const result = await desktop.deleteAutomationTask(payload);
  const ok = Boolean(result?.ok);
  if (ok) {
    useAppStore.getState().removePanesForAutomationTaskId(id);
  }
  return { ok, error: result?.error != null ? String(result.error) : undefined };
}
