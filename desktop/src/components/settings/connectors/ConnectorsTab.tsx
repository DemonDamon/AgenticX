import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { Modal } from "../../ds/Modal";
import { Toast } from "../../ds/Toast";
import { nativeConnectorAvailability } from "../../../../electron/native-connectors-core";
import { CONNECTORS, type ConnectorDefinition, type ConnectorId } from "./connector-catalog";

type Props = {
  sessionId: string;
  tapdConnected: boolean;
  onRefreshMcp: (sessionId?: string) => Promise<void>;
};

type TmeetStatus = {
  available: boolean;
  connected: boolean;
  label: string;
  error?: string;
};

function StatusLabel({
  available,
  connected,
  busy = false,
}: {
  available: boolean;
  connected: boolean;
  busy?: boolean;
}) {
  if (busy) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        连接中
      </span>
    );
  }
  const active = available || connected;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${active ? "text-emerald-400" : "text-rose-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-rose-400"}`} />
      {connected ? "已连接" : available ? "可用" : "暂不可用"}
    </span>
  );
}

function ConnectorIcon({ item, large = false }: { item: ConnectorDefinition; large?: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-white ${large ? "h-14 w-14" : "h-9 w-9"}`}
      aria-hidden
    >
      <img
        src={item.iconSrc}
        alt=""
        className={large ? "h-9 w-9 object-contain" : "h-[22px] w-[22px] object-contain"}
        draggable={false}
      />
    </div>
  );
}

export function ConnectorsTab({ sessionId, tapdConnected, onRefreshMcp }: Props) {
  const [selectedId, setSelectedId] = useState<ConnectorId | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [tmeetStatus, setTmeetStatus] = useState<TmeetStatus>({
    available: true,
    connected: false,
    label: "可用",
  });
  const [tmeetBusy, setTmeetBusy] = useState(false);
  const [tmeetPhase, setTmeetPhase] = useState("");
  const [tapdToken, setTapdToken] = useState("");
  const [tapdBusy, setTapdBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const selected = useMemo(
    () => CONNECTORS.find((item) => item.id === selectedId) ?? null,
    [selectedId],
  );

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastOpen(true);
  }, []);

  const refreshTmeetStatus = useCallback(async () => {
    const result = await window.agenticxDesktop.nativeConnectorStatus("tencent-meeting");
    setTmeetStatus({
      available: result.available,
      connected: result.connected,
      label: result.label,
      error: result.error,
    });
  }, []);

  useEffect(() => {
    void refreshTmeetStatus();
    return window.agenticxDesktop.onNativeConnectorTmeetProgress(({ phase }) => {
      const labels = {
        installing: "首次使用，正在安全下载腾讯会议官方 CLI…",
        opening_browser: "正在打开腾讯会议授权页面…",
        waiting: "等待你在浏览器中扫码并授权…",
        success: "授权成功",
        disconnected: "已断开连接",
        error: "授权未完成",
      };
      setTmeetPhase(labels[phase]);
    });
  }, [refreshTmeetStatus]);

  const openConnector = (item: ConnectorDefinition) => {
    if (nativeConnectorAvailability(item.id) !== "available") return;
    setDialogError("");
    setTmeetPhase("");
    setSelectedId(item.id);
  };

  const handleTmeetConnect = async () => {
    setTmeetBusy(true);
    setDialogError("");
    setTmeetPhase("准备腾讯会议扫码授权…");
    try {
      const result = await window.agenticxDesktop.nativeConnectorTmeetLogin();
      setTmeetStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
      });
      if (!result.ok || !result.connected) {
        setDialogError(result.error || "腾讯会议授权未完成");
        return;
      }
      showToast("腾讯会议已连接");
      setSelectedId(null);
    } finally {
      setTmeetBusy(false);
    }
  };

  const handleTmeetLogout = async () => {
    setTmeetBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorTmeetLogout();
      setTmeetStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
      });
      if (!result.ok) {
        setDialogError(result.error || "腾讯会议断开失败");
        return;
      }
      showToast("已断开腾讯会议");
      setSelectedId(null);
    } finally {
      setTmeetBusy(false);
    }
  };

  const handleTapdConnect = async () => {
    if (!tapdToken.trim()) {
      setDialogError("请填写 TAPD Personal Access Token");
      return;
    }
    setTapdBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorTapdConfigure({
        sessionId,
        accessToken: tapdToken,
      });
      if (!result.ok) {
        setDialogError(result.error || "TAPD 连接失败");
        return;
      }
      setTapdToken("");
      try {
        await onRefreshMcp(sessionId);
      } catch {
        setDialogError("TAPD 已连接，但状态刷新失败；请关闭设置后重新打开");
        return;
      }
      showToast("TAPD 已保存并连接");
      setSelectedId(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setTapdBusy(false);
    }
  };

  const handleTapdDisconnect = async () => {
    setTapdBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.disconnectMcp({ sessionId, name: "tapd" });
      if (!result.ok) {
        setDialogError(result.error || "TAPD 断开失败");
        return;
      }
      try {
        await onRefreshMcp(sessionId);
      } catch {
        setDialogError("TAPD 已断开，但状态刷新失败；请关闭设置后重新打开");
        return;
      }
      showToast("已断开 TAPD");
      setSelectedId(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setTapdBusy(false);
    }
  };

  return (
    <>
      <div className="space-y-4 p-4">
        <p className="text-xs text-text-muted">
          连接常用账号与服务，让 Near 在获得授权后调用对应能力。
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-text-muted">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          <span>首批已开放腾讯会议和 TAPD；红色标记的连接器尚未接入。</span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {CONNECTORS.map((item) => {
            const connected =
              item.id === "tencent-meeting"
                ? tmeetStatus.connected
                : item.id === "tapd"
                  ? tapdConnected
                  : false;
            const available =
              item.id === "tencent-meeting"
                ? tmeetStatus.available
                : nativeConnectorAvailability(item.id) === "available";
            const busy =
              item.id === "tencent-meeting"
                ? tmeetBusy
                : item.id === "tapd"
                  ? tapdBusy
                  : false;
            return (
              <div
                key={item.id}
                className={`flex min-h-[92px] items-center gap-3 rounded-xl border border-border bg-surface-card px-3 py-3 transition ${available ? "hover:bg-surface-hover" : "opacity-80"}`}
              >
                <ConnectorIcon item={item} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text-strong">{item.name}</div>
                  <div className="truncate text-xs text-text-muted">{item.description}</div>
                  <div className="mt-1.5">
                    <StatusLabel available={available} connected={connected} busy={busy} />
                  </div>
                </div>
                {available ? (
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    aria-label={connected ? `管理 ${item.name}` : `连接 ${item.name}`}
                    disabled={busy}
                    onClick={() => openConnector(item)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        open={selected?.id === "tencent-meeting"}
        title="腾讯会议连接器"
        onClose={tmeetBusy ? undefined : () => setSelectedId(null)}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              disabled={tmeetBusy}
              onClick={() => setSelectedId(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={tmeetBusy}
              onClick={() => void (tmeetStatus.connected ? handleTmeetLogout() : handleTmeetConnect())}
            >
              {tmeetBusy ? "处理中…" : tmeetStatus.connected ? "断开连接" : "扫码连接"}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">腾讯会议</div>
                <StatusLabel
                  available={tmeetStatus.available}
                  connected={tmeetStatus.connected}
                  busy={tmeetBusy}
                />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              使用腾讯会议官方 CLI 的设备码授权。点击连接后将在系统浏览器打开官方扫码页，凭证由 CLI
              在本机加密保存，Near 不会读取或保存你的腾讯会议密码。
            </p>
            {tmeetPhase ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted" role="status">
                {tmeetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {tmeetPhase}
              </div>
            ) : null}
            {dialogError || tmeetStatus.error ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError || tmeetStatus.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={selected?.id === "tapd"}
        title="TAPD MCP 授权配置"
        onClose={tapdBusy ? undefined : () => setSelectedId(null)}
        panelClassName="w-[min(620px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            {tapdConnected ? (
              <button
                type="button"
                className="mr-auto rounded-md border border-rose-500/40 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10"
                disabled={tapdBusy}
                onClick={() => void handleTapdDisconnect()}
              >
                断开连接
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              disabled={tapdBusy}
              onClick={() => setSelectedId(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={tapdBusy || !tapdToken.trim()}
              onClick={() => void handleTapdConnect()}
            >
              {tapdBusy ? "连接中…" : "保存并连接"}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">TAPD</div>
                <StatusLabel available connected={tapdConnected} busy={tapdBusy} />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              输入 TAPD Personal Access Token，用于管理需求、缺陷、任务、迭代和工作流。
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => void window.agenticxDesktop.openExternal("https://open.tapd.cn/")}
            >
              如何获取 TAPD Token？
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </button>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-strong">
                Personal Access Token <span className="text-rose-400">*</span>
              </span>
              <input
                type="password"
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-surface-card px-3 py-2.5 text-sm text-text-strong outline-none focus:border-text-faint"
                value={tapdToken}
                disabled={tapdBusy}
                onChange={(event) => setTapdToken(event.target.value)}
              />
              <span className="text-[11px] text-text-faint">
                在 TAPD「个人设置 → 个人访问令牌」创建。Token 不会写入聊天记录。
              </span>
            </label>
            {dialogError ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Toast open={toastOpen} message={toastMessage} onClose={() => setToastOpen(false)} />
    </>
  );
}
