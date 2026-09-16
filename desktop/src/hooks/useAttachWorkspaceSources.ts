import { useCallback, useEffect, useState } from "react";
import { i18n } from "../i18n/i18n";
import type { TaskspaceMountMode } from "../store";
import { useAppStore } from "../store";
import { isPaneAwaitingFreshSession } from "../utils/pane-fresh-session";

function ct(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "chat", ...(opts ?? {}) }));
}

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
          onError(ct("composer.sessionInitWait"));
          return false;
        }
        if (isPaneAwaitingFreshSession(paneId)) {
          if (typeof onEnsureSessionForWorkspace === "function") {
            try {
              const ensured = await onEnsureSessionForWorkspace();
              if (!ensured) {
                setAdding(false);
                onError(ct("composer.createSessionFailed"));
                return false;
              }
              effectiveSessionId = ensured;
            } catch (err) {
              setAdding(false);
              onError(ct("composer.createSessionFailedWithError", { error: String(err) }));
              return false;
            }
          } else {
            setAdding(false);
            onError(ct("composer.sendFirstThenAdd"));
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
              onError(created.error ?? ct("composer.createSessionFailed"));
              return false;
            }
            effectiveSessionId = created.session_id;
            setPaneSessionId(paneId, effectiveSessionId);
          } catch (err) {
            setAdding(false);
            onError(ct("composer.createSessionFailedWithError", { error: String(err) }));
            return false;
          }
        }
      }
      const linker = window.agenticxDesktop.linkIntoSessionWorkspace;
      if (typeof linker !== "function") {
        setAdding(false);
        onError(ct("composer.clientNoLink"));
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
          hostPlatform === "win32" && mode === "link" ? ct("composer.winDevModeHint") : "";
        const fallback = winHint
          ? failed.length > 0
            ? ct("composer.addFailedCountHint", { count: failed.length, path: firstFail, hint: winHint })
            : ct("composer.addWorkspaceFailedHint", { hint: winHint })
          : failed.length > 0
            ? ct("composer.addFailedCount", { count: failed.length, path: firstFail })
            : ct("composer.addWorkspaceFailed");
        onError(result.error || fallback);
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
              title: ct("composer.directMountTitle"),
              message: ct("composer.directMountMessage"),
              detail: sourcePreview
                ? ct("composer.directMountDetail", { path: sourcePreview })
                : ct("composer.directMountDetailEmpty"),
              confirmText: ct("composer.directMountConfirm"),
              cancelText: ct("composer.cancel"),
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
