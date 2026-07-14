import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import { Modal } from "../../ds/Modal";
import { Toast } from "../../ds/Toast";
import { SettingsSwitch } from "../SettingsSwitch";
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

type GithubStatus = {
  available: boolean;
  connected: boolean;
  label: string;
  error?: string;
  account?: string;
};

type FeishuStatus = {
  available: boolean;
  connected: boolean;
  label: string;
  error?: string;
  account?: string;
};

type WecomStatus = {
  available: boolean;
  connected: boolean;
  label: string;
  error?: string;
};

type QqmailStatus = {
  available: boolean;
  connected: boolean;
  label: string;
  error?: string;
  account?: string;
};

/** Compact status used inside connect/manage dialogs (not the marketplace card). */
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
  /** WorkBuddy marketplace: hide not-yet-integrated connectors unless toggled on. */
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [tmeetStatus, setTmeetStatus] = useState<TmeetStatus>({
    available: true,
    connected: false,
    label: "可用",
  });
  const [tmeetBusy, setTmeetBusy] = useState(false);
  const [tmeetPhase, setTmeetPhase] = useState("");
  const [githubStatus, setGithubStatus] = useState<GithubStatus>({
    available: true,
    connected: false,
    label: "可用",
  });
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubPhase, setGithubPhase] = useState("");
  const [githubDeviceCode, setGithubDeviceCode] = useState("");
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus>({
    available: true,
    connected: false,
    label: "可用",
  });
  const [feishuBusy, setFeishuBusy] = useState(false);
  const [feishuPhase, setFeishuPhase] = useState("");
  const [feishuVerifyUrl, setFeishuVerifyUrl] = useState("");
  const [wecomStatus, setWecomStatus] = useState<WecomStatus>({
    available: true,
    connected: false,
    label: "可用",
  });
  const [wecomBusy, setWecomBusy] = useState(false);
  const [wecomPhase, setWecomPhase] = useState("");
  const [botIdInput, setBotIdInput] = useState("");
  const [botSecretInput, setBotSecretInput] = useState("");
  const [showBotSecret, setShowBotSecret] = useState(false);
  const [qqmailStatus, setQqmailStatus] = useState<QqmailStatus>({
    available: true,
    connected: false,
    label: "可用",
  });
  const [qqmailBusy, setQqmailBusy] = useState(false);
  const [qqmailPhase, setQqmailPhase] = useState("");
  const [qqmailAuthUrl, setQqmailAuthUrl] = useState("");
  const [tapdToken, setTapdToken] = useState("");
  const [tapdBusy, setTapdBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const selected = useMemo(
    () => CONNECTORS.find((item) => item.id === selectedId) ?? null,
    [selectedId],
  );

  const connectorState = useCallback(
    (item: ConnectorDefinition) => {
      const connected =
        item.id === "tencent-meeting"
          ? tmeetStatus.connected
          : item.id === "tapd"
            ? tapdConnected
            : item.id === "github"
              ? githubStatus.connected
              : item.id === "feishu"
                ? feishuStatus.connected
                : item.id === "wecom"
                  ? wecomStatus.connected
                  : item.id === "qqmail"
                    ? qqmailStatus.connected
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
            : item.id === "github"
              ? githubBusy
              : item.id === "feishu"
                ? feishuBusy
                : item.id === "wecom"
                  ? wecomBusy
                  : item.id === "qqmail"
                    ? qqmailBusy
                    : false;
      return { available, connected, busy };
    },
    [
      feishuBusy,
      feishuStatus.connected,
      githubBusy,
      githubStatus.connected,
      qqmailBusy,
      qqmailStatus.connected,
      tapdBusy,
      tapdConnected,
      tmeetBusy,
      tmeetStatus.available,
      tmeetStatus.connected,
      wecomBusy,
      wecomStatus.connected,
    ],
  );

  const visibleConnectors = useMemo(
    () =>
      CONNECTORS.filter((item) => {
        if (showUnavailable) return true;
        const { available, connected } = connectorState(item);
        return available || connected;
      }),
    [connectorState, showUnavailable],
  );

  const unavailableCount = useMemo(
    () => CONNECTORS.filter((item) => !connectorState(item).available && !connectorState(item).connected).length,
    [connectorState],
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

  const refreshGithubStatus = useCallback(async () => {
    const result = await window.agenticxDesktop.nativeConnectorStatus("github");
    setGithubStatus({
      available: result.available,
      connected: result.connected,
      label: result.label,
      error: result.error,
      account: result.account,
    });
  }, []);

  const refreshFeishuStatus = useCallback(async () => {
    const result = await window.agenticxDesktop.nativeConnectorStatus("feishu");
    setFeishuStatus({
      available: result.available,
      connected: result.connected,
      label: result.label,
      error: result.error,
      account: result.account,
    });
  }, []);

  const refreshWecomStatus = useCallback(async () => {
    const result = await window.agenticxDesktop.nativeConnectorStatus("wecom");
    setWecomStatus({
      available: result.available,
      connected: result.connected,
      label: result.label,
      error: result.error,
    });
  }, []);

  const refreshQqmailStatus = useCallback(async () => {
    const result = await window.agenticxDesktop.nativeConnectorStatus("qqmail");
    setQqmailStatus({
      available: result.available,
      connected: result.connected,
      label: result.label,
      error: result.error,
      account: result.account,
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

  useEffect(() => {
    void refreshGithubStatus();
    return window.agenticxDesktop.onNativeConnectorGithubProgress(({ phase, oneTimeCode }) => {
      const labels: Record<string, string> = {
        installing: "首次使用，正在下载 GitHub CLI…",
        code_ready: "已生成一次性授权码，请在浏览器中粘贴",
        opening_browser: "正在打开 GitHub 授权页面…",
        waiting: "等待你在浏览器中完成授权…",
        success: "授权成功",
        disconnected: "已断开连接",
        error: "授权未完成",
      };
      if (oneTimeCode) setGithubDeviceCode(oneTimeCode);
      if (labels[phase]) setGithubPhase(labels[phase]);
      if (phase === "success" || phase === "disconnected" || phase === "error") {
        void refreshGithubStatus();
      }
    });
  }, [refreshGithubStatus]);

  useEffect(() => {
    void refreshFeishuStatus();
    return window.agenticxDesktop.onNativeConnectorFeishuProgress(({ phase, verificationUrl }) => {
      const labels: Record<string, string> = {
        installing: "首次使用，正在下载飞书 CLI…",
        config_setup: "正在浏览器创建飞书应用，请在打开的页面完成…",
        config_done: "应用已就绪，正在发起用户授权…",
        auth_setup: "已打开授权页面，请在浏览器中确认授权…",
        waiting: "等待你在浏览器中完成授权…",
        success: "授权成功",
        disconnected: "已断开连接",
        error: "连接未完成",
      };
      if (verificationUrl) setFeishuVerifyUrl(verificationUrl);
      if (labels[phase]) setFeishuPhase(labels[phase]);
      if (phase === "success" || phase === "disconnected" || phase === "error") {
        void refreshFeishuStatus();
      }
    });
  }, [refreshFeishuStatus]);

  useEffect(() => {
    void refreshWecomStatus();
    return window.agenticxDesktop.onNativeConnectorWecomProgress(({ phase }) => {
      const labels: Record<string, string> = {
        installing: "首次使用，正在下载企业微信 CLI…",
        initializing: "正在配置机器人凭据…",
        probing: "正在校验凭据…",
        success: "连接成功",
        disconnected: "已断开连接",
        error: "连接未完成",
      };
      if (labels[phase]) setWecomPhase(labels[phase]);
      if (phase === "success" || phase === "disconnected" || phase === "error") {
        void refreshWecomStatus();
      }
    });
  }, [refreshWecomStatus]);

  useEffect(() => {
    void refreshQqmailStatus();
    return window.agenticxDesktop.onNativeConnectorQqmailProgress(({ phase, authUrl }) => {
      const labels: Record<string, string> = {
        installing: "首次使用，正在下载 Agent Mail CLI…",
        opening_browser: "请在浏览器中完成微信授权…",
        waiting: "等待授权完成…",
        success: "授权成功",
        disconnected: "已断开连接",
        error: "授权未完成",
      };
      if (authUrl) setQqmailAuthUrl(authUrl);
      if (labels[phase]) setQqmailPhase(labels[phase]);
      if (phase === "success" || phase === "disconnected" || phase === "error") {
        void refreshQqmailStatus();
      }
    });
  }, [refreshQqmailStatus]);

  const openConnector = (item: ConnectorDefinition) => {
    if (nativeConnectorAvailability(item.id) !== "available") return;
    setDialogError("");
    setTmeetPhase("");
    setGithubPhase("");
    setGithubDeviceCode("");
    setFeishuPhase("");
    setFeishuVerifyUrl("");
    setWecomPhase("");
    setBotIdInput("");
    setBotSecretInput("");
    setShowBotSecret(false);
    setQqmailPhase("");
    setQqmailAuthUrl("");
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

  const handleGithubConnect = async () => {
    setGithubBusy(true);
    setDialogError("");
    setGithubDeviceCode("");
    setGithubPhase("准备 GitHub 浏览器授权…");
    try {
      const result = await window.agenticxDesktop.nativeConnectorGithubLogin();
      setGithubStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
      });
      if (result.error === "已取消") {
        setGithubPhase("");
        setGithubDeviceCode("");
        return;
      }
      if (!result.ok || !result.connected) {
        setDialogError(result.error || "GitHub 授权未完成");
        return;
      }
      showToast("GitHub 已连接");
      setSelectedId(null);
    } finally {
      setGithubBusy(false);
    }
  };

  const handleGithubCancel = async () => {
    if (githubBusy) {
      try {
        await window.agenticxDesktop.nativeConnectorGithubCancel();
      } catch {
        // best-effort cancel
      }
    }
    setGithubBusy(false);
    setGithubPhase("");
    setGithubDeviceCode("");
    setDialogError("");
    setSelectedId(null);
  };

  const handleGithubLogout = async () => {
    setGithubBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorGithubLogout();
      setGithubStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
      });
      if (!result.ok) {
        setDialogError(result.error || "GitHub 断开失败");
        return;
      }
      showToast("已断开 GitHub");
      setSelectedId(null);
    } finally {
      setGithubBusy(false);
    }
  };

  const handleFeishuConnect = async () => {
    setFeishuBusy(true);
    setDialogError("");
    setFeishuVerifyUrl("");
    setFeishuPhase("准备飞书浏览器授权…");
    try {
      const result = await window.agenticxDesktop.nativeConnectorFeishuLogin();
      setFeishuStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
      });
      if (result.error === "已取消") {
        setFeishuPhase("");
        setFeishuVerifyUrl("");
        return;
      }
      if (!result.ok || !result.connected) {
        setDialogError(result.error || "飞书授权未完成");
        return;
      }
      showToast("飞书已连接");
      setSelectedId(null);
    } finally {
      setFeishuBusy(false);
    }
  };

  const handleFeishuCancel = async () => {
    if (feishuBusy) {
      try {
        await window.agenticxDesktop.nativeConnectorFeishuCancel();
      } catch {
        // best-effort cancel
      }
    }
    setFeishuBusy(false);
    setFeishuPhase("");
    setFeishuVerifyUrl("");
    setDialogError("");
    setSelectedId(null);
  };

  const handleFeishuLogout = async () => {
    setFeishuBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorFeishuLogout();
      setFeishuStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
      });
      if (!result.ok) {
        setDialogError(result.error || "飞书断开失败");
        return;
      }
      showToast("已断开飞书");
      setSelectedId(null);
    } finally {
      setFeishuBusy(false);
    }
  };

  const handleWecomConnect = async () => {
    if (!botIdInput.trim() || !botSecretInput.trim()) {
      setDialogError("请填写 Bot ID 与 Secret");
      return;
    }
    setWecomBusy(true);
    setDialogError("");
    setWecomPhase("准备配置企业微信凭据…");
    try {
      const result = await window.agenticxDesktop.nativeConnectorWecomLogin({
        botId: botIdInput.trim(),
        botSecret: botSecretInput.trim(),
      });
      setWecomStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
      });
      if (result.error === "已取消") {
        setWecomPhase("");
        return;
      }
      if (!result.ok || !result.connected) {
        setDialogError(result.error || "企业微信连接未完成");
        return;
      }
      setBotIdInput("");
      setBotSecretInput("");
      showToast("企业微信已连接");
      setSelectedId(null);
    } finally {
      setWecomBusy(false);
    }
  };

  const handleWecomCancel = async () => {
    if (wecomBusy) {
      try {
        await window.agenticxDesktop.nativeConnectorWecomCancel();
      } catch {
        // best-effort cancel
      }
    }
    setWecomBusy(false);
    setWecomPhase("");
    setDialogError("");
    setSelectedId(null);
  };

  const handleWecomLogout = async () => {
    setWecomBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorWecomLogout();
      setWecomStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
      });
      if (!result.ok) {
        setDialogError(result.error || "企业微信断开失败");
        return;
      }
      showToast("已断开企业微信");
      setSelectedId(null);
    } finally {
      setWecomBusy(false);
    }
  };

  const handleQqmailConnect = async () => {
    setQqmailBusy(true);
    setDialogError("");
    setQqmailAuthUrl("");
    setQqmailPhase("准备 Agent Mail 浏览器授权…");
    try {
      const result = await window.agenticxDesktop.nativeConnectorQqmailLogin();
      setQqmailStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
      });
      if (result.error === "已取消") {
        setQqmailPhase("");
        setQqmailAuthUrl("");
        return;
      }
      if (!result.ok || !result.connected) {
        setDialogError(result.error || "Agent Mail 授权未完成");
        return;
      }
      showToast("Agent Mail 已连接");
      setSelectedId(null);
    } finally {
      setQqmailBusy(false);
    }
  };

  const handleQqmailCancel = async () => {
    if (qqmailBusy) {
      try {
        await window.agenticxDesktop.nativeConnectorQqmailCancel();
      } catch {
        // best-effort cancel
      }
    }
    setQqmailBusy(false);
    setQqmailPhase("");
    setQqmailAuthUrl("");
    setDialogError("");
    setSelectedId(null);
  };

  const handleQqmailLogout = async () => {
    setQqmailBusy(true);
    setDialogError("");
    try {
      const result = await window.agenticxDesktop.nativeConnectorQqmailLogout();
      setQqmailStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
      });
      if (!result.ok) {
        setDialogError(result.error || "Agent Mail 断开失败");
        return;
      }
      showToast("已断开 Agent Mail");
      setSelectedId(null);
    } finally {
      setQqmailBusy(false);
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-xs text-text-muted">
            连接常用账号与服务，让 Near 在获得授权后调用对应能力。
          </p>
          {unavailableCount > 0 ? (
            <label className="flex shrink-0 items-center gap-2 text-[12px] text-text-muted">
              <span>显示尚未接入</span>
              <SettingsSwitch
                checked={showUnavailable}
                size="sm"
                aria-label="显示尚未接入的连接器"
                onChange={setShowUnavailable}
              />
            </label>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleConnectors.map((item) => {
            const { available, connected, busy } = connectorState(item);
            return (
              <div
                key={item.id}
                className={`flex min-h-[88px] items-start gap-3 rounded-xl border border-border bg-surface-card px-3 py-3 transition ${
                  available ? "hover:bg-surface-hover" : "opacity-70"
                }`}
              >
                <ConnectorIcon item={item} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-text-strong">{item.name}</span>
                    {/* WorkBuddy: green = connected; grey = available but not connected */}
                    {connected ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-label="已连接" />
                    ) : available ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint/50" aria-label="未连接" />
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{item.description}</p>
                  {!available && !connected ? (
                    <p className="mt-1 text-[11px] text-text-faint">尚未接入</p>
                  ) : null}
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
                    ) : connected ? (
                      <ChevronRight className="h-4 w-4" aria-hidden />
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
        open={selected?.id === "github"}
        title="GitHub 连接器"
        onClose={() => void handleGithubCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleGithubCancel()}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={githubBusy}
              onClick={() => void (githubStatus.connected ? handleGithubLogout() : handleGithubConnect())}
            >
              {githubBusy ? "处理中…" : githubStatus.connected ? "断开连接" : "连接 GitHub"}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">GitHub</div>
                <StatusLabel
                  available={githubStatus.available}
                  connected={githubStatus.connected}
                  busy={githubBusy}
                />
                {githubStatus.connected && githubStatus.account ? (
                  <div className="mt-1 text-xs text-text-muted">账号：{githubStatus.account}</div>
                ) : null}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              使用 GitHub 官方 CLI（gh）完成浏览器 Device Flow 授权。连接后 Near
              会写入托管技能，Agent 可通过 gh 查询与管理仓库、Issue 与 Pull Request。凭证由 gh
              在本机保存，Near 不会读取你的 GitHub 密码。
            </p>
            {githubDeviceCode ? (
              <div className="rounded-lg border border-border bg-surface-card px-4 py-3">
                <div className="text-[11px] text-text-muted">一次性授权码</div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-2xl font-semibold tracking-widest text-text-strong">
                    {githubDeviceCode}
                  </code>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void navigator.clipboard.writeText(githubDeviceCode)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    复制
                  </button>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  浏览器已打开 github.com/login/device，请粘贴此码并授权。
                </p>
              </div>
            ) : null}
            {githubPhase ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted"
                role="status"
              >
                {githubBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {githubPhase}
              </div>
            ) : null}
            {dialogError || githubStatus.error ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError || githubStatus.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={selected?.id === "feishu"}
        title="飞书连接器"
        onClose={() => void handleFeishuCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleFeishuCancel()}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={feishuBusy}
              onClick={() => void (feishuStatus.connected ? handleFeishuLogout() : handleFeishuConnect())}
            >
              {feishuBusy ? "处理中…" : feishuStatus.connected ? "断开连接" : "连接飞书"}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">飞书</div>
                <StatusLabel
                  available={feishuStatus.available}
                  connected={feishuStatus.connected}
                  busy={feishuBusy}
                />
                {feishuStatus.connected && feishuStatus.account ? (
                  <div className="mt-1 text-xs text-text-muted">账号：{feishuStatus.account}</div>
                ) : null}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              使用飞书官方 CLI（lark-cli）完成两段式授权：首次需在浏览器创建飞书应用（一次性），随后完成用户授权。连接后
              Near 会写入托管技能，Agent 可通过 lark-cli
              操作消息、文档、多维表格、日历与任务。凭证由 CLI 在本机保存。
            </p>
            {feishuVerifyUrl ? (
              <div className="rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
                <div className="text-[11px] text-text-muted">授权页面</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void window.agenticxDesktop.openExternal(feishuVerifyUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    打开授权页
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void navigator.clipboard.writeText(feishuVerifyUrl)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    复制链接
                  </button>
                </div>
                <p className="text-xs text-text-muted">
                  若浏览器未自动打开，请点击上方按钮继续完成授权。
                </p>
              </div>
            ) : null}
            {feishuPhase ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted"
                role="status"
              >
                {feishuBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {feishuPhase}
              </div>
            ) : null}
            {dialogError || feishuStatus.error ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError || feishuStatus.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={selected?.id === "wecom"}
        title="企业微信连接器"
        onClose={() => void handleWecomCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleWecomCancel()}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={wecomBusy}
              onClick={() => void (wecomStatus.connected ? handleWecomLogout() : handleWecomConnect())}
            >
              {wecomBusy ? "处理中…" : wecomStatus.connected ? "断开连接" : "连接"}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">企业微信</div>
                <StatusLabel
                  available={wecomStatus.available}
                  connected={wecomStatus.connected}
                  busy={wecomBusy}
                />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              使用企业微信官方 CLI（wecom-cli）。请先在企业微信管理后台创建 API
              模式智能机器人，复制 Bot ID 与 Secret 填入下方。连接后 Near 会写入托管技能，Agent
              可通过 wecom-cli 操作消息、文档、智能表格、通讯录、待办与会议。凭证由 CLI
              加密保存在本机。
            </p>
            {!wecomStatus.connected ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] text-text-muted">Bot ID</label>
                  <input
                    type="text"
                    value={botIdInput}
                    onChange={(event) => setBotIdInput(event.target.value)}
                    disabled={wecomBusy}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="请输入企业微信机器人 Bot ID"
                    className="w-full rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-strong outline-none focus:border-border-strong"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-text-muted">Bot Secret</label>
                  <div className="flex gap-2">
                    <input
                      type={showBotSecret ? "text" : "password"}
                      value={botSecretInput}
                      onChange={(event) => setBotSecretInput(event.target.value)}
                      disabled={wecomBusy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="请输入企业微信机器人 Secret"
                      className="w-full rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-strong outline-none focus:border-border-strong"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
                      onClick={() => setShowBotSecret((prev) => !prev)}
                    >
                      {showBotSecret ? "隐藏" : "显示"}
                    </button>
                  </div>
                </div>
                <a
                  href="https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21677"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text-strong"
                  onClick={(event) => {
                    event.preventDefault();
                    void window.agenticxDesktop.openExternal(
                      "https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21677",
                    );
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  如何获取 Bot ID / Secret
                </a>
              </div>
            ) : null}
            {wecomPhase ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted"
                role="status"
              >
                {wecomBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {wecomPhase}
              </div>
            ) : null}
            {dialogError || wecomStatus.error ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError || wecomStatus.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={selected?.id === "qqmail"}
        title="Agent Mail 连接器"
        onClose={() => void handleQqmailCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleQqmailCancel()}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={qqmailBusy}
              onClick={() => void (qqmailStatus.connected ? handleQqmailLogout() : handleQqmailConnect())}
            >
              {qqmailBusy ? "处理中…" : qqmailStatus.connected ? "断开连接" : "连接 Agent Mail"}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">Agent Mail</div>
                <StatusLabel
                  available={qqmailStatus.available}
                  connected={qqmailStatus.connected}
                  busy={qqmailBusy}
                />
                {qqmailStatus.connected && qqmailStatus.account ? (
                  <div className="mt-1 text-xs text-text-muted">邮箱：{qqmailStatus.account}</div>
                ) : null}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              Agently Mail 是 QQ 邮箱团队为 Agent 打造的专属邮箱（与个人 QQ
              邮箱隔离）。通过官方 CLI（agently-cli）微信扫码授权后，Near
              会写入托管技能，Agent 可收发、搜索、回复与转发邮件。管理端：
              agent.qq.com。
            </p>
            {qqmailAuthUrl ? (
              <div className="rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
                <div className="text-[11px] text-text-muted">
                  请点击或复制以下链接在浏览器中完成授权：
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface-panel px-2 py-1.5 text-[11px] text-text-strong">
                  {qqmailAuthUrl}
                </pre>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void window.agenticxDesktop.openExternal(qqmailAuthUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    打开授权页
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void navigator.clipboard.writeText(qqmailAuthUrl)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    复制链接
                  </button>
                </div>
              </div>
            ) : null}
            {qqmailPhase ? (
              <div
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted"
                role="status"
              >
                {qqmailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {qqmailPhase}
              </div>
            ) : null}
            {dialogError || qqmailStatus.error ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError || qqmailStatus.error}
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
