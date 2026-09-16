/**
 * 删除定时任务：先确认，再可选删除 ~/.agenticx/crontask/<taskId> 目录。
 */

import { i18n } from "../i18n/i18n";
import { useAppStore } from "../store";

function wt(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "workspace", ...(opts ?? {}) }));
}

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
  if (!id) return { ok: false, error: wt("automation.invalidTaskId") };

  const desktop = window.agenticxDesktop;
  const confirmPrimary = desktop.confirmDialog
    ? await desktop.confirmDialog({
        title: wt("automation.deleteConfirmTitle"),
        message: wt("automation.deleteConfirmMessage"),
        detail: wt("automation.deleteConfirmDetail"),
        confirmText: wt("automation.deleteConfirmOk"),
        cancelText: wt("automation.deleteConfirmCancel"),
        destructive: true,
      })
    : { ok: true, confirmed: window.confirm(wt("automation.deleteConfirmLegacy")) };
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
              title: wt("automation.deleteFilesTitle"),
              message: wt("automation.deleteFilesMessage"),
              detail: wt("automation.deleteFilesDetail", { path: info.path }),
              confirmText: wt("automation.deleteFilesOk"),
              cancelText: wt("automation.deleteFilesCancel"),
              destructive: true,
            })
          : { ok: true, confirmed: window.confirm(
            wt("automation.deleteFilesLegacy", { path: info.path }),
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
