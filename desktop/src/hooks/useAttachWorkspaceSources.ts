import { useCallback, useEffect, useState } from "react";
import type { TaskspaceMountMode } from "../store";
import { useAppStore } from "../store";
import { isPaneAwaitingFreshSession } from "../utils/pane-fresh-session";

export type AttachWorkspaceSourcesOptions = {
  paneId: string;
  sessionId: string;
  paneAvatarId: string | null;
  paneAvatarName: string;
  onEnsureSessionForWorkspace?: () => Promise<string | null>;
  onError: (message: string) => void;
  onAttached?: (sessionId: string, sources: string[]) => Promise<void> | void;
};

export function useAttachWorkspaceSources({
  paneId,
  sessionId,
  paneAvatarId,
  paneAvatarName,
  onEnsureSessionForWorkspace,
  onError,
  onAttached,
}: AttachWorkspaceSourcesOptions) {
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const [pendingMountSources, setPendingMountSources] = useState<string[] | null>(null);
  const [pendingMountMode, setPendingMountMode] = useState<TaskspaceMountMode>("reference");
  const [adding, setAdding] = useState(false);
  const [hostPlatform, setHostPlatform] = useState<string | null>(null);

  useEffect(() => {
    void window.agenticxDesktop
      .platform()
      .then((p) => setHostPlatform(p))
      .catch(() => setHostPlatform(null));
  }, []);

  const linkSourcesIntoDefault = useCallback(
    async (sources: string[], mode: TaskspaceMountMode = "link"): Promise<boolean> => {
      const cleaned = sources.map((s) => String(s || "").trim()).filter(Boolean);
      if (cleaned.length === 0) return false;
      setAdding(true);
      let effectiveSessionId = sessionId;
      if (!effectiveSessionId) {
        const isGroupOrAutomationPane =
          !!paneAvatarId && (paneAvatarId.startsWith("group:") || paneAvatarId.startsWith("automation:"));
        if (isGroupOrAutomationPane) {
          setAdding(false);
          onError("会话正在初始化，请稍候再试");
          return false;
        }
        if (isPaneAwaitingFreshSession(paneId)) {
          if (typeof onEnsureSessionForWorkspace === "function") {
            try {
              const ensured = await onEnsureSessionForWorkspace();
              if (!ensured) {
                setAdding(false);
                onError("创建会话失败，无法添加工作区");
                return false;
              }
              effectiveSessionId = ensured;
            } catch (err) {
              setAdding(false);
              onError(`创建会话失败：${String(err)}`);
              return false;
            }
          } else {
            setAdding(false);
            onError("请先发送一条消息，再添加工作区目录");
            return false;
          }
        } else {
          try {
            const createPayload: { avatar_id?: string; name?: string } = {};
            if (paneAvatarId) createPayload.avatar_id = paneAvatarId;
            if (paneAvatarName) createPayload.name = paneAvatarName;
            const created = await window.agenticxDesktop.createSession(createPayload);
            if (!created.ok || !created.session_id) {
              setAdding(false);
              onError(created.error ?? "创建会话失败，无法添加工作区");
              return false;
            }
            effectiveSessionId = created.session_id;
            setPaneSessionId(paneId, effectiveSessionId);
          } catch (err) {
            setAdding(false);
            onError(`创建会话失败：${String(err)}`);
            return false;
          }
        }
      }
      const linker = window.agenticxDesktop.linkIntoSessionWorkspace;
      if (typeof linker !== "function") {
        setAdding(false);
        onError("当前客户端不支持添加到工作区，请完全重启桌面端后重试。");
        return false;
      }
      const result = await linker({
        sessionId: effectiveSessionId,
        sources: cleaned,
        mode,
        explicit: true,
      });
      setAdding(false);
      const failed = Array.isArray(result.failed) ? result.failed : [];
      const linked = Number(result.linked || 0);
      if (!result.ok || linked === 0 || failed.length > 0) {
        const firstFail = failed[0] || cleaned[0] || "";
        const winHint =
          hostPlatform === "win32" && mode === "link"
            ? "创建直连需要开启 Windows 开发者模式或以管理员身份运行。"
            : "";
        onError(
          result.error ||
            (failed.length > 0
              ? `添加失败 ${failed.length} 项：${firstFail}${winHint ? `。${winHint}` : ""}`
              : `添加到工作区失败${winHint ? `：${winHint}` : ""}`),
        );
        return false;
      }
      onError("");
      setPendingMountSources(null);
      await onAttached?.(effectiveSessionId, cleaned);
      return true;
    },
    [
      hostPlatform,
      onAttached,
      onEnsureSessionForWorkspace,
      onError,
      paneAvatarId,
      paneAvatarName,
      paneId,
      sessionId,
      setPaneSessionId,
    ],
  );

  const confirmMountModeAndAttach = useCallback(async (): Promise<boolean> => {
    if (!pendingMountSources?.length) return false;
    if (pendingMountMode === "link") {
      const desktop = window.agenticxDesktop;
      const sourcePreview = pendingMountSources[0] || "";
      const confirmResult =
        typeof desktop.confirmDialog === "function"
          ? await desktop.confirmDialog({
              title: "确认直连原目录",
              message: "agent 的改动会直接写入所选路径。",
              detail: sourcePreview
                ? `目标：${sourcePreview}\n此操作不可自动撤销。`
                : "此操作不可自动撤销。",
              confirmText: "确认直连",
              cancelText: "取消",
              destructive: true,
            })
          : { ok: true, confirmed: false };
      if (!confirmResult.confirmed) return false;
    }
    return linkSourcesIntoDefault(pendingMountSources, pendingMountMode);
  }, [linkSourcesIntoDefault, pendingMountMode, pendingMountSources]);

  return {
    pendingMountSources,
    setPendingMountSources,
    pendingMountMode,
    setPendingMountMode,
    adding,
    confirmMountModeAndAttach,
    linkSourcesIntoDefault,
  };
}
