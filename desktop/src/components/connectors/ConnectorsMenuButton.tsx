import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Link2, Loader2, SquareArrowOutUpRight } from "lucide-react";

import { nativeConnectorAvailability, resolveConnectedConnectorIds } from "../../../electron/native-connectors-core";
import { CONNECTORS, type ConnectorId } from "../settings/connectors/connector-catalog";
import { SettingsSwitch } from "../settings/SettingsSwitch";
import { Modal } from "../ds/Modal";
import { Toast } from "../ds/Toast";
import { HoverTip } from "../ds/HoverTip";
import { useAppStore } from "../../store";

const DROPDOWN_WIDTH = 260;

type Props = {
  /** Falls back to the global session id when the pane has not bound one yet. */
  sessionId?: string;
};

type NativeId = "tencent-meeting" | "tapd" | "github";

/**
 * Persistent「连接器」entry in the composer toolbar (replaces the previous
 * decorative「更多」button). Matches WorkBuddy:
 * - Popup list only shows truly connected connectors (with disconnect toggle).
 * - 「选择更多连接器」jumps to Settings → 连接器 marketplace (same as「管理」).
 */
export function ConnectorsMenuButton({ sessionId }: Props) {
  const mcpServers = useAppStore((state) => state.mcpServers);
  const setMcpServers = useAppStore((state) => state.setMcpServers);
  const globalSessionId = useAppStore((state) => state.sessionId);
  const openSettings = useAppStore((state) => state.openSettings);
  const effectiveSessionId = (sessionId || globalSessionId || "").trim();
  const [tmeetConnected, setTmeetConnected] = useState(false);
  const [githubConnected, setGithubConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ bottom: number; left: number } | null>(null);
  const [pendingId, setPendingId] = useState<NativeId | null>(null);
  const [tmeetPhase, setTmeetPhase] = useState("");
  const [tapdModalOpen, setTapdModalOpen] = useState(false);
  const [tapdToken, setTapdToken] = useState("");
  const [tapdError, setTapdError] = useState("");
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastOpen(true);
  }, []);

  const refreshTmeet = useCallback(async () => {
    try {
      const result = await window.agenticxDesktop.nativeConnectorStatus("tencent-meeting");
      setTmeetConnected(result.connected);
    } catch {
      setTmeetConnected(false);
    }
  }, []);

  const refreshGithub = useCallback(async () => {
    try {
      const result = await window.agenticxDesktop.nativeConnectorStatus("github");
      setGithubConnected(result.connected);
    } catch {
      setGithubConnected(false);
    }
  }, []);

  const refreshMcp = useCallback(async () => {
    try {
      const status = await window.agenticxDesktop.loadMcpStatus(effectiveSessionId);
      if (status.ok && Array.isArray(status.servers)) {
        setMcpServers(
          status.servers.map((item) => ({
            name: item.name,
            connected: Boolean(item.connected),
            command: item.command,
            url: typeof item.url === "string" ? item.url : undefined,
            transport: typeof item.transport === "string" ? item.transport : undefined,
            connection_state: item.connection_state,
            tool_count: typeof item.tool_count === "number" ? item.tool_count : undefined,
            tool_names: Array.isArray(item.tool_names) ? (item.tool_names as string[]) : undefined,
            error_detail: item.error_detail,
            op_phase: typeof item.op_phase === "string" ? item.op_phase : undefined,
            op_message: typeof item.op_message === "string" ? item.op_message : undefined,
            op_updated_at: typeof item.op_updated_at === "number" ? item.op_updated_at : undefined,
          })),
        );
      }
    } catch {
      // best-effort refresh; keep prior list on failure
    }
  }, [effectiveSessionId, setMcpServers]);

  useEffect(() => {
    void refreshTmeet();
    return window.agenticxDesktop.onNativeConnectorTmeetProgress(({ phase }) => {
      const labels: Record<string, string> = {
        installing: "首次使用，正在下载腾讯会议 CLI…",
        opening_browser: "正在打开授权页面…",
        waiting: "等待扫码授权…",
        success: "授权成功",
        disconnected: "已断开",
        error: "授权未完成",
      };
      if (labels[phase]) setTmeetPhase(labels[phase]);
      if (phase === "success" || phase === "disconnected" || phase === "error") {
        void refreshTmeet();
      }
    });
  }, [refreshTmeet]);

  useEffect(() => {
    void refreshGithub();
    return window.agenticxDesktop.onNativeConnectorGithubProgress(({ phase }) => {
      if (phase === "success" || phase === "disconnected" || phase === "error") {
        void refreshGithub();
      }
    });
  }, [refreshGithub]);

  const tapdConnected = useMemo(
    () => mcpServers.some((server) => server.name === "tapd" && server.connected),
    [mcpServers],
  );

  const connectedIds = useMemo(
    () => resolveConnectedConnectorIds(tmeetConnected, mcpServers, githubConnected),
    [githubConnected, mcpServers, tmeetConnected],
  );

  const connectedLabel = useMemo(
    () =>
      connectedIds
        .map((id) => CONNECTORS.find((item) => item.id === id)?.name ?? id)
        .join("、"),
    [connectedIds],
  );

  const isConnectorConnected = useCallback(
    (id: ConnectorId) => {
      if (id === "tencent-meeting") return tmeetConnected;
      if (id === "tapd") return tapdConnected;
      if (id === "github") return githubConnected;
      return false;
    },
    [githubConnected, tapdConnected, tmeetConnected],
  );

  /** WorkBuddy popup: only truly connected connectors. */
  const visibleConnectors = useMemo(
    () => CONNECTORS.filter((item) => isConnectorConnected(item.id)),
    [isConnectorConnected],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const btn = btnRef.current;
      const dropdown = document.getElementById("agx-connectors-menu-dropdown");
      if (btn && btn.contains(target)) return;
      if (dropdown && dropdown.contains(target)) return;
      // Keep menu open while TAPD modal is up so state stays coherent.
      if (tapdModalOpen) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, tapdModalOpen]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const left = Math.min(rect.left, window.innerWidth - DROPDOWN_WIDTH - 8);
      setDropdownPos({ bottom: window.innerHeight - rect.top + 6, left: Math.max(8, left) });
    }
    setOpen((prev) => !prev);
  };

  const goToSettings = () => {
    setOpen(false);
    openSettings("connectors");
  };

  const connectTencentMeeting = async () => {
    if (pendingId) return;
    setPendingId("tencent-meeting");
    setTmeetPhase("准备扫码授权…");
    try {
      const result = await window.agenticxDesktop.nativeConnectorTmeetLogin();
      await refreshTmeet();
      if (!result.ok || !result.connected) {
        showToast(result.error || "腾讯会议授权未完成");
        return;
      }
      showToast("腾讯会议已连接");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
      setTmeetPhase("");
    }
  };

  const disconnectTencentMeeting = async () => {
    setPendingId("tencent-meeting");
    try {
      await window.agenticxDesktop.nativeConnectorTmeetLogout();
      await refreshTmeet();
    } finally {
      setPendingId(null);
    }
  };

  const disconnectTapd = async () => {
    if (!effectiveSessionId) return;
    setPendingId("tapd");
    try {
      await window.agenticxDesktop.disconnectMcp({ sessionId: effectiveSessionId, name: "tapd" });
      await refreshMcp();
    } finally {
      setPendingId(null);
    }
  };

  const disconnectGithub = async () => {
    setPendingId("github");
    try {
      await window.agenticxDesktop.nativeConnectorGithubLogout();
      await refreshGithub();
    } finally {
      setPendingId(null);
    }
  };

  const handleTapdConnect = async () => {
    if (!tapdToken.trim()) {
      setTapdError("请填写 TAPD Personal Access Token");
      return;
    }
    if (!effectiveSessionId) {
      setTapdError("当前会话尚未就绪，请稍后重试");
      return;
    }
    setPendingId("tapd");
    setTapdError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorTapdConfigure({
        sessionId: effectiveSessionId,
        accessToken: tapdToken,
      });
      if (!result.ok) {
        setTapdError(result.error || "TAPD 连接失败");
        return;
      }
      setTapdToken("");
      setTapdModalOpen(false);
      await refreshMcp();
      showToast("TAPD 已连接");
    } catch (error) {
      setTapdError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingId(null);
    }
  };

  const handleConnectClick = (id: ConnectorId) => {
    if (pendingId) return;
    if (nativeConnectorAvailability(id) !== "available") {
      showToast("该连接器暂未开放");
      return;
    }
    if (id === "tencent-meeting") {
      void connectTencentMeeting();
      return;
    }
    if (id === "tapd") {
      setTapdError("");
      setTapdToken("");
      setTapdModalOpen(true);
      return;
    }
    if (id === "github") {
      // Device Flow needs a one-time code UI — open Settings connectors page.
      goToSettings();
      return;
    }
    showToast("该连接器暂未开放");
  };

  const handleToggle = (id: NativeId, next: boolean) => {
    if (pendingId) return;
    if (!next) {
      if (id === "tencent-meeting") {
        void disconnectTencentMeeting();
        return;
      }
      if (id === "tapd") {
        void disconnectTapd();
        return;
      }
      if (id === "github") {
        void disconnectGithub();
        return;
      }
      return;
    }
    // Toggle ON while disconnected — start connect flow (WorkBuddy-style).
    handleConnectClick(id);
  };

  const dropdown =
    open && dropdownPos
      ? createPortal(
          <div
            id="agx-connectors-menu-dropdown"
            style={{ bottom: dropdownPos.bottom, left: dropdownPos.left, width: DROPDOWN_WIDTH }}
            className="fixed z-[9999] rounded-xl border border-border bg-surface-panel shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[12px] font-semibold text-text-strong">连接器</span>
              <button
                type="button"
                className="text-[11px] text-text-faint transition hover:text-text-strong"
                onClick={goToSettings}
              >
                管理
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-1.5">
              {visibleConnectors.length === 0 ? (
                <div className="px-2 py-4 text-center text-[12px] text-text-faint">
                  暂无已连接的连接器
                </div>
              ) : (
                visibleConnectors.map((item) => {
                  const isImplemented = nativeConnectorAvailability(item.id) === "available";
                  const connected = isConnectorConnected(item.id);
                  const busy = pendingId === item.id;
                  // WorkBuddy: connected → toggle; not connected →「连接」inline action.
                  const showToggle = isImplemented && connected;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-hover"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                        <img src={item.iconSrc} alt="" className="h-4 w-4 object-contain" draggable={false} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-strong">
                        {item.name}
                      </span>
                      {busy ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-faint" aria-hidden />
                      ) : showToggle ? (
                        <SettingsSwitch
                          checked
                          size="sm"
                          aria-label={`断开 ${item.name}`}
                          onChange={(next) => handleToggle(item.id as NativeId, next)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-emerald-400 transition hover:text-emerald-300"
                          onClick={() => handleConnectClick(item.id)}
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          连接
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-border p-1.5">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface-card px-2 py-2 text-[12px] font-medium text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                onClick={goToSettings}
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                选择更多连接器
              </button>
            </div>
            {pendingId === "tencent-meeting" && tmeetPhase ? (
              <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted" role="status">
                {tmeetPhase}
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  const toolbarButton = (
    <button
      ref={btnRef}
      type="button"
      className={`relative flex h-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong ${
        connectedIds.length > 0 ? "min-w-[2rem] px-1" : "w-7"
      }`}
      title={connectedIds.length > 0 ? `已连接：${connectedLabel}` : "连接器"}
      aria-label={connectedIds.length > 0 ? `已连接的连接器：${connectedLabel}` : "连接器"}
      aria-expanded={open}
      onClick={handleOpen}
    >
      {connectedIds.length > 0 ? (
        <span className="flex items-center">
          {connectedIds.map((id, index) => {
            const item = CONNECTORS.find((connector) => connector.id === id);
            if (!item) return null;
            return (
              <span
                key={id}
                className={`flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-surface-card bg-white shadow-sm ${
                  index > 0 ? "-ml-1.5" : ""
                }`}
              >
                <img src={item.iconSrc} alt="" className="h-3.5 w-3.5 object-contain" draggable={false} />
              </span>
            );
          })}
        </span>
      ) : (
        <Link2 className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );

  return (
    <>
      {connectedIds.length > 0 ? (
        <HoverTip label={`已连接：${connectedLabel}`}>{toolbarButton}</HoverTip>
      ) : (
        toolbarButton
      )}
      {dropdown}

      <Modal
        open={tapdModalOpen}
        title="连接 TAPD"
        onClose={pendingId === "tapd" ? undefined : () => setTapdModalOpen(false)}
        panelClassName="w-[min(480px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              disabled={pendingId === "tapd"}
              onClick={() => setTapdModalOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={pendingId === "tapd" || !tapdToken.trim()}
              onClick={() => void handleTapdConnect()}
            >
              {pendingId === "tapd" ? "连接中…" : "保存并连接"}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-muted">输入 TAPD Personal Access Token 以连接需求与缺陷管理。</p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-strong"
            onClick={() => void window.agenticxDesktop.openExternal("https://open.tapd.cn/")}
          >
            如何获取 Token？
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-strong">
              Personal Access Token <span className="text-rose-400">*</span>
            </span>
            <input
              type="password"
              autoComplete="off"
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-card px-3 py-2.5 text-sm text-text-strong outline-none focus:border-text-faint"
              value={tapdToken}
              disabled={pendingId === "tapd"}
              onChange={(event) => setTapdToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleTapdConnect();
              }}
            />
          </label>
          {tapdError ? (
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {tapdError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Toast open={toastOpen} message={toastMessage} onClose={() => setToastOpen(false)} />
    </>
  );
}
