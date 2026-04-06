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

  const desktop = window.agenticxDesktop;
  const confirmPrimary = desktop.confirmDialog
    ? await desktop.confirmDialog({
        title: "删除定时任务",
        message: "确定删除该定时任务？",
        detail: "此操作不可恢复。",
        confirmText: "删除",
        cancelText: "取消",
        destructive: true,
      })
    : { ok: true, confirmed: window.confirm("确定删除该定时任务？此操作不可恢复。") };
  if (!confirmPrimary.confirmed) {
    return { ok: false, cancelled: true };
  }

  let removeCrontaskDir = false;
  if (desktop.automationCrontaskDirInfo) {
    try {
      const info = await desktop.automationCrontaskDirInfo(id);
      if (info?.ok && info.exists) {
        const confirmDir = desktop.confirmDialog
          ? await desktop.confirmDialog({
              title: "同时删除本地文件",
              message: "是否同时删除该任务在 crontask 目录下的本地文件？",
              detail: `${info.path}\n此操作不可恢复。`,
              confirmText: "删除文件",
              cancelText: "仅删任务",
              destructive: true,
            })
          : { ok: true, confirmed: window.confirm(
            `是否同时删除该任务在 crontask 目录下的本地文件？\n${info.path}\n此操作不可恢复。`,
          ) };
        removeCrontaskDir = Boolean(confirmDir.confirmed);
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
