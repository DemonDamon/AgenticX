import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import QRCode from "qrcode";
import { Modal } from "../../ds/Modal";
import { Toast } from "../../ds/Toast";
import { SettingsSwitch } from "../SettingsSwitch";
import { nativeConnectorAvailability } from "../../../../electron/native-connectors-core";
import { CONNECTORS, type ConnectorDefinition, type ConnectorId } from "./connector-catalog";
import { MarketIcon } from "../../marketplace/MarketIcon";
import type { ConnectorHealth } from "./connector-health";
import { MyConnectionsPanel } from "./MyConnectionsPanel";
import {
  configuredMcpEntriesFromDocument,
  configuredMcpEntriesFromStatus,
  mergeConfiguredMcpEntries,
  type ConfiguredMcpEntry,
} from "./my-connections-model";
import { CONNECTOR_SUPPLY } from "./connector-supply";
import { GATEWAY_DEFAULT_SERVER_NAME, isGatewayInstalled } from "../../marketplace/gateway-model";
import { parseMcpJsonDocument } from "../../../utils/mcp-remote-config";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type Props = {
  sessionId: string;
  tapdConnected: boolean;
  onRefreshMcp: (sessionId?: string) => Promise<void>;
  /**
   * 市场「连接」深链：打开后直接进入该连接器的握手弹层（与设置页点 + 同一入口）。
   * 配合 presentation="handshake-only" 可跳过设置墙网格。
   */
  autoOpenId?: ConnectorId | null;
  /** 每次递增以在同一 id 上重复触发打开。 */
  autoOpenSeq?: number;
  /** page=设置墙；handshake-only=仅渲染握手 Modal（市场宿主）。 */
  presentation?: "page" | "handshake-only";
  /** handshake-only 下弹层关闭/完成后回调（宿主卸载）。 */
  onHandshakeDismiss?: () => void;
  /** 连接状态变化后通知宿主刷新 SSOT（市场卡片已连接态）。 */
  onConnectionChange?: () => void;
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
  health?: ConnectorHealth;
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
  health,
}: {
  available: boolean;
  connected: boolean;
  busy?: boolean;
  health?: ConnectorHealth;
}) {
  if (busy) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {st("connectors.connecting")}
      </span>
    );
  }
  if (health === "degraded") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        {st("connectors.needsReauth")}
      </span>
    );
  }
  const active = available || connected;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${active ? "text-emerald-400" : "text-rose-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-rose-400"}`} />
      {connected ? st("connectors.connected") : available ? st("connectors.available") : st("connectors.unavailable")}
    </span>
  );
}

function ConnectorIcon({ item, large = false }: { item: ConnectorDefinition; large?: boolean }) {
  return (
    <MarketIcon
      name={item.name}
      iconSrc={item.iconSrc}
      className={large ? "h-14 w-14" : "h-9 w-9"}
    />
  );
}

export function ConnectorsTab({
  sessionId,
  tapdConnected,
  onRefreshMcp,
  autoOpenId = null,
  autoOpenSeq = 0,
  presentation = "page",
  onHandshakeDismiss,
  onConnectionChange,
}: Props) {
  const { t } = useTranslation("settings");
  const [selectedId, setSelectedId] = useState<ConnectorId | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  /** WorkBuddy marketplace: hide not-yet-integrated connectors unless toggled on. */
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [tmeetStatus, setTmeetStatus] = useState<TmeetStatus>({
    available: true,
    connected: false,
    label: st("connectors.available"),
  });
  const [tmeetBusy, setTmeetBusy] = useState(false);
  const [tmeetPhase, setTmeetPhase] = useState("");
  const [githubStatus, setGithubStatus] = useState<GithubStatus>({
    available: true,
    connected: false,
    label: st("connectors.available"),
  });
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubPhase, setGithubPhase] = useState("");
  const [githubDeviceCode, setGithubDeviceCode] = useState("");
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus>({
    available: true,
    connected: false,
    label: st("connectors.available"),
  });
  const [feishuBusy, setFeishuBusy] = useState(false);
  const [feishuPhase, setFeishuPhase] = useState("");
  const [feishuVerifyUrl, setFeishuVerifyUrl] = useState("");
  const [wecomStatus, setWecomStatus] = useState<WecomStatus>({
    available: true,
    connected: false,
    label: st("connectors.available"),
  });
  const [wecomBusy, setWecomBusy] = useState(false);
  const [wecomPhase, setWecomPhase] = useState("");
  const [wecomMode, setWecomMode] = useState<"qrcode" | "manual">("qrcode");
  const [wecomLoginUrl, setWecomLoginUrl] = useState("");
  const [wecomQrDataUrl, setWecomQrDataUrl] = useState("");
  const [botIdInput, setBotIdInput] = useState("");
  const [botSecretInput, setBotSecretInput] = useState("");
  const [showBotSecret, setShowBotSecret] = useState(false);
  const [qqmailStatus, setQqmailStatus] = useState<QqmailStatus>({
    available: true,
    connected: false,
    label: st("connectors.available"),
  });
  const [qqmailBusy, setQqmailBusy] = useState(false);
  const [qqmailPhase, setQqmailPhase] = useState("");
  const [qqmailAuthUrl, setQqmailAuthUrl] = useState("");
  const [tapdToken, setTapdToken] = useState("");
  const [tapdBusy, setTapdBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [configuredMcpNames, setConfiguredMcpNames] = useState<string[]>([]);
  const [configuredMcpEntries, setConfiguredMcpEntries] = useState<ConfiguredMcpEntry[]>([]);

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


  const reloadConfiguredMcpNames = useCallback(async () => {
    let statusEntries: ConfiguredMcpEntry[] = [];
    let statusNames: string[] = [];
    try {
      const res = await window.agenticxDesktop.loadMcpStatus(sessionId || "").catch(() => null);
      if (res?.ok && Array.isArray(res.servers)) {
        statusNames = res.servers.map((s) => s.name).filter(Boolean);
        statusEntries = configuredMcpEntriesFromStatus(res.servers);
      }
    } catch {
      /* fall through */
    }
    let docEntries: ConfiguredMcpEntry[] = [];
    try {
      const raw = await window.agenticxDesktop.mcpGetRaw({}).catch(() => null);
      if (raw?.ok && raw.text) {
        try {
          const doc = parseMcpJsonDocument(raw.text);
          docEntries = configuredMcpEntriesFromDocument(doc);
        } catch {
          /* ignore parse */
        }
      }
    } catch {
      /* ignore */
    }
    const merged = mergeConfiguredMcpEntries(statusEntries, docEntries);
    const names =
      statusNames.length > 0
        ? statusNames
        : merged.map((e) => e.name);
    setConfiguredMcpNames(names);
    setConfiguredMcpEntries(merged.length > 0 ? merged : statusEntries);
  }, [sessionId]);

  useEffect(() => {
    void reloadConfiguredMcpNames();
  }, [reloadConfiguredMcpNames]);

  const myConnectionsHealth = useMemo(() => {
    const health: Record<string, ConnectorHealth | undefined> = {
      "tencent-meeting": tmeetStatus.connected ? "connected" : "disconnected",
      tapd: tapdConnected ? "connected" : "disconnected",
      github:
        githubStatus.health === "degraded" || githubStatus.health === "connected"
          ? githubStatus.health
          : githubStatus.connected
            ? "connected"
            : "disconnected",
      feishu: feishuStatus.connected ? "connected" : "disconnected",
      wecom: wecomStatus.connected ? "connected" : "disconnected",
      qqmail: qqmailStatus.connected ? "connected" : "disconnected",
    };
    return health;
  }, [
    tmeetStatus.connected,
    tapdConnected,
    githubStatus.health,
    githubStatus.connected,
    feishuStatus.connected,
    wecomStatus.connected,
    qqmailStatus.connected,
  ]);

  const myConnectionsAccounts = useMemo(
    () => ({
      github: githubStatus.account,
      feishu: feishuStatus.account,
      qqmail: qqmailStatus.account,
    }),
    [githubStatus.account, feishuStatus.account, qqmailStatus.account],
  );

  const myConnectionsDisplayNames = useMemo(() => {
    const display: Record<string, string> = {};
    for (const e of CONNECTOR_SUPPLY) {
      if (e.kind === "gateway") {
        display[e.id] = st("connectors.myConnections.gatewayName");
        continue;
      }
      if (!e.connectorId) continue;
      display[e.id] = st(`connectors.catalog.${e.connectorId}.name`);
    }
    return display;
  }, []);


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
      health: result.health,
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
        installing: st("connectors.phaseTmeetInstall"),
        opening_browser: st("connectors.phaseOpeningTmeet"),
        waiting: st("connectors.phaseWaitScan"),
        success: st("connectors.phaseSuccess"),
        disconnected: st("connectors.phaseDisconnected"),
        error: st("connectors.phaseError"),
      };
      setTmeetPhase(labels[phase]);
    });
  }, [refreshTmeetStatus]);

  useEffect(() => {
    void refreshGithubStatus();
    return window.agenticxDesktop.onNativeConnectorGithubProgress(({ phase, oneTimeCode }) => {
      const labels: Record<string, string> = {
        installing: st("connectors.phaseGithubInstall"),
        code_ready: st("connectors.phaseCodeReady"),
        opening_browser: st("connectors.phaseOpeningGithub"),
        waiting: st("connectors.phaseWaitAuth"),
        success: st("connectors.phaseSuccess"),
        disconnected: st("connectors.phaseDisconnected"),
        error: st("connectors.phaseError"),
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
        installing: st("connectors.phaseFeishuInstall"),
        config_setup: st("connectors.phaseFeishuConfig"),
        config_done: st("connectors.phaseFeishuConfigDone"),
        auth_setup: st("connectors.phaseFeishuAuth"),
        waiting: st("connectors.phaseWaitAuth"),
        success: st("connectors.phaseSuccess"),
        disconnected: st("connectors.phaseDisconnected"),
        error: st("connectors.phaseConnError"),
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
    return window.agenticxDesktop.onNativeConnectorWecomProgress(({ phase, loginUrl }) => {
      const labels: Record<string, string> = {
        installing: st("connectors.phaseWecomInstall"),
        initializing: st("connectors.phaseWecomInit"),
        waiting_scan: st("connectors.phaseWecomScan"),
        probing: st("connectors.phaseWecomProbe"),
        success: st("connectors.phaseConnOk"),
        disconnected: st("connectors.phaseDisconnected"),
        error: st("connectors.phaseConnError"),
      };
      if (loginUrl) setWecomLoginUrl(loginUrl);
      if (phase === "success" || phase === "disconnected") {
        setWecomLoginUrl("");
        setWecomQrDataUrl("");
      }
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
        installing: st("connectors.phaseQqmailInstall"),
        opening_browser: st("connectors.phaseQqmailOpen"),
        waiting: st("connectors.phaseQqmailWait"),
        success: st("connectors.phaseSuccess"),
        disconnected: st("connectors.phaseDisconnected"),
        error: st("connectors.phaseError"),
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
    setWecomMode("qrcode");
    setWecomLoginUrl("");
    setWecomQrDataUrl("");
    setBotIdInput("");
    setBotSecretInput("");
    setShowBotSecret(false);
    setQqmailPhase("");
    setQqmailAuthUrl("");
    setSelectedId(item.id);
  };

  const handshakeOpenedRef = useRef(false);

  // 市场/设置深链：与点卡片 + 同一 openConnector 入口。
  useEffect(() => {
    if (!autoOpenId) return;
    const item = CONNECTORS.find((c) => c.id === autoOpenId);
    if (!item) return;
    handshakeOpenedRef.current = false;
    openConnector(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-open on id/seq
  }, [autoOpenId, autoOpenSeq]);

  // handshake-only：弹层关闭后通知宿主（成功连接也会 setSelectedId(null)）。
  useEffect(() => {
    if (presentation !== "handshake-only") return;
    if (!autoOpenId) return;
    if (selectedId === autoOpenId) {
      handshakeOpenedRef.current = true;
      return;
    }
    if (selectedId === null && handshakeOpenedRef.current) {
      handshakeOpenedRef.current = false;
      onConnectionChange?.();
      onHandshakeDismiss?.();
    }
  }, [presentation, autoOpenId, selectedId, onHandshakeDismiss, onConnectionChange]);

  const handleTmeetConnect = async () => {
    setTmeetBusy(true);
    setDialogError("");
    setTmeetPhase(st("connectors.prepareTmeet"));
    try {
      const result = await window.agenticxDesktop.nativeConnectorTmeetLogin();
      setTmeetStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
      });
      if (!result.ok || !result.connected) {
        setDialogError(result.error || st("connectors.tmeetIncomplete"));
        return;
      }
      showToast(st("connectors.tmeetConnected"));
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
        setDialogError(result.error || st("connectors.tmeetDisconnectFail"));
        return;
      }
      showToast(st("connectors.tmeetDisconnected"));
      setSelectedId(null);
    } finally {
      setTmeetBusy(false);
    }
  };

  const handleGithubConnect = async () => {
    setGithubBusy(true);
    setDialogError("");
    setGithubDeviceCode("");
    setGithubPhase(st("connectors.prepareGithub"));
    try {
      const result = await window.agenticxDesktop.nativeConnectorGithubLogin();
      setGithubStatus({
        available: result.available,
        connected: result.connected,
        label: result.label,
        error: result.error,
        account: result.account,
        health: result.health,
      });
      onConnectionChange?.();
      if (result.error === "已取消") {
        setGithubPhase("");
        setGithubDeviceCode("");
        return;
      }
      // Native session OK but MCP still degraded: stop spinner, keep modal with clear next step.
      if (result.health === "degraded") {
        setGithubPhase("");
        setGithubDeviceCode("");
        setDialogError(result.error || st("connectors.needsReauthHint"));
        showToast(st("connectors.githubNativeOkMcpDegraded"));
        return;
      }
      if (!result.ok || !result.connected) {
        setDialogError(result.error || st("connectors.githubIncomplete"));
        setGithubPhase("");
        return;
      }
      showToast(st("connectors.githubConnected"));
      setGithubPhase("");
      setGithubDeviceCode("");
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
        health: result.health,
      });
      onConnectionChange?.();
      if (!result.ok) {
        setDialogError(result.error || st("connectors.githubDisconnectFail"));
        return;
      }
      showToast(st("connectors.githubDisconnected"));
      setSelectedId(null);
    } finally {
      setGithubBusy(false);
    }
  };

  const handleFeishuConnect = async () => {
    setFeishuBusy(true);
    setDialogError("");
    setFeishuVerifyUrl("");
    setFeishuPhase(st("connectors.prepareFeishu"));
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
        setDialogError(result.error || st("connectors.feishuIncomplete"));
        return;
      }
      showToast(st("connectors.feishuConnected"));
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
        setDialogError(result.error || st("connectors.feishuDisconnectFail"));
        return;
      }
      showToast(st("connectors.feishuDisconnected"));
      setSelectedId(null);
    } finally {
      setFeishuBusy(false);
    }
  };

  useEffect(() => {
    if (!wecomLoginUrl) {
      setWecomQrDataUrl("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(wecomLoginUrl, { width: 220, margin: 2, errorCorrectionLevel: "M" }).then(
      (png) => {
        if (!cancelled) setWecomQrDataUrl(png);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wecomLoginUrl]);

  const handleWecomConnect = async () => {
    if (wecomMode === "manual" && (!botIdInput.trim() || !botSecretInput.trim())) {
      setDialogError(st("connectors.needBotCreds"));
      return;
    }
    setWecomBusy(true);
    setDialogError("");
    setWecomPhase(st("connectors.prepareWecom"));
    try {
      const result = await window.agenticxDesktop.nativeConnectorWecomLogin(
        wecomMode === "manual"
          ? { mode: "manual", botId: botIdInput.trim(), botSecret: botSecretInput.trim() }
          : { mode: "qrcode" },
      );
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
        setDialogError(result.error || st("connectors.wecomIncomplete"));
        return;
      }
      setBotIdInput("");
      setBotSecretInput("");
      showToast(st("connectors.wecomConnected"));
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
    setWecomLoginUrl("");
    setWecomQrDataUrl("");
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
        setDialogError(result.error || st("connectors.wecomDisconnectFail"));
        return;
      }
      showToast(st("connectors.wecomDisconnected"));
      setSelectedId(null);
    } finally {
      setWecomBusy(false);
    }
  };

  const handleQqmailConnect = async () => {
    setQqmailBusy(true);
    setDialogError("");
    setQqmailAuthUrl("");
    setQqmailPhase(st("connectors.prepareQqmail"));
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
        setDialogError(result.error || st("connectors.qqmailIncomplete"));
        return;
      }
      showToast(st("connectors.qqmailConnected"));
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
        setDialogError(result.error || st("connectors.qqmailDisconnectFail"));
        return;
      }
      showToast(st("connectors.qqmailDisconnected"));
      setSelectedId(null);
    } finally {
      setQqmailBusy(false);
    }
  };

  const handleTapdConnect = async () => {
    if (!tapdToken.trim()) {
      setDialogError(st("connectors.needTapdToken"));
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
        setDialogError(result.error || st("connectors.tapdFail"));
        return;
      }
      setTapdToken("");
      try {
        await onRefreshMcp(sessionId);
      } catch {
        setDialogError(st("connectors.tapdRefreshFail"));
        return;
      }
      showToast(st("connectors.tapdSaved"));
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
        setDialogError(result.error || st("connectors.tapdDisconnectFail"));
        return;
      }
      try {
        await onRefreshMcp(sessionId);
      } catch {
        setDialogError(st("connectors.tapdDisconnectedStale"));
        return;
      }
      showToast(st("connectors.tapdDisconnected"));
      setSelectedId(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setTapdBusy(false);
    }
  };

  return (
    <>
      {presentation === "page" ? (
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-xs text-text-muted">
            {st("connectors.intro")}
          </p>
          {unavailableCount > 0 ? (
            <label className="flex shrink-0 items-center gap-2 text-[12px] text-text-muted">
              <span>{st("connectors.showUnavailable")}</span>
              <SettingsSwitch
                checked={showUnavailable}
                size="sm"
                aria-label={st("connectors.showUnavailableAria")}
                onChange={setShowUnavailable}
              />
            </label>
          ) : null}
        </div>

        <section className="space-y-2" aria-label={st("connectors.myConnections.title")}>
          <div>
            <h3 className="text-sm font-semibold text-text-strong">{st("connectors.myConnections.title")}</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">{st("connectors.myConnections.subtitle")}</p>
          </div>
          <MyConnectionsPanel
            sessionId={sessionId}
            healthByConnectorId={myConnectionsHealth}
            accountsByConnectorId={myConnectionsAccounts}
            configuredMcpNames={configuredMcpNames}
            configuredMcpEntries={configuredMcpEntries}
            gatewayInstalled={isGatewayInstalled(new Set(configuredMcpNames), GATEWAY_DEFAULT_SERVER_NAME)}
            displayNames={myConnectionsDisplayNames}
            onChanged={() => {
              void refreshTmeetStatus();
              void refreshGithubStatus();
              void refreshFeishuStatus();
              void refreshWecomStatus();
              void refreshQqmailStatus();
              void reloadConfiguredMcpNames();
              void onRefreshMcp(sessionId);
              onConnectionChange?.();
            }}
            onOpenHandshake={(id) => {
              const item = CONNECTORS.find((c) => c.id === id);
              if (item) openConnector(item);
            }}
          />
        </section>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleConnectors.map((item) => {
            const { available, connected, busy } = connectorState(item);
            return (
              <div
                key={item.id}
                className={`agx-market-card flex min-h-[96px] items-start gap-3 rounded-xl border border-border bg-surface-card px-3 py-3 ${
                  available ? "" : "opacity-70 pointer-events-none"
                }`}
              >
                <ConnectorIcon item={item} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-text-strong">{st(`connectors.catalog.${item.id}.name`)}</span>
                    {/* WorkBuddy: green = connected; grey = available but not connected */}
                    {item.id === "github" && githubStatus.health === "degraded" ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label={st("connectors.needsReauthAria")} />
                    ) : connected ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-label={st("connectors.connectedAria")} />
                    ) : available ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint/50" aria-label={st("connectors.disconnectedAria")} />
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[13px] leading-[1.45] text-text-muted">{st(`connectors.catalog.${item.id}.description`)}</p>
                  {item.id === "github" && githubStatus.health === "degraded" ? (
                    <p className="mt-1 text-[11px] text-amber-400/90">{st("connectors.needsReauthHint")}</p>
                  ) : !available && !connected ? (
                    <p className="mt-1 text-[11px] text-text-faint">{st("connectors.notYet")}</p>
                  ) : null}
                </div>
                {available ? (
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    aria-label={
                      item.id === "github" && githubStatus.health === "degraded"
                        ? st("connectors.reauthAria", { name: st(`connectors.catalog.${item.id}.name`) })
                        : connected
                          ? st("connectors.manageAria", { name: st(`connectors.catalog.${item.id}.name`) })
                          : st("connectors.connectAria", { name: st(`connectors.catalog.${item.id}.name`) })
                    }
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
      ) : null}

      <Modal
        open={selected?.id === "tencent-meeting"}
        title={st("connectors.tmeetTitle")}
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
              {st("connectors.cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={tmeetBusy}
              onClick={() => void (tmeetStatus.connected ? handleTmeetLogout() : handleTmeetConnect())}
            >
              {tmeetBusy ? st("connectors.processing") : tmeetStatus.connected ? st("connectors.disconnect") : st("connectors.tmeetScan")}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">{st("connectors.tmeetName")}</div>
                <StatusLabel
                  available={tmeetStatus.available}
                  connected={tmeetStatus.connected}
                  busy={tmeetBusy}
                />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              {st("connectors.tmeetHint")}
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
        title={st("connectors.githubTitle")}
        onClose={() => void handleGithubCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleGithubCancel()}
            >
              {st("connectors.cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={githubBusy}
              onClick={() =>
                void (
                  githubStatus.health === "degraded" || !githubStatus.connected
                    ? handleGithubConnect()
                    : handleGithubLogout()
                )
              }
            >
              {githubBusy
                ? st("connectors.processing")
                : githubStatus.health === "degraded"
                  ? st("connectors.githubReauth")
                  : githubStatus.connected
                    ? st("connectors.disconnect")
                    : st("connectors.githubConnect")}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">{st("connectors.catalog.github.name")}</div>
                <StatusLabel
                  available={githubStatus.available}
                  connected={githubStatus.connected}
                  busy={githubBusy}
                  health={githubStatus.health}
                />
                {githubStatus.connected && githubStatus.account ? (
                  <div className="mt-1 text-xs text-text-muted">{st("connectors.account", { account: githubStatus.account })}</div>
                ) : null}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              {st("connectors.githubHint")}
            </p>
            {githubDeviceCode ? (
              <div className="rounded-lg border border-border bg-surface-card px-4 py-3">
                <div className="text-[11px] text-text-muted">{st("connectors.deviceCode")}</div>
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
                    {st("connectors.copy")}
                  </button>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  {st("connectors.githubPaste")}
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
            {dialogError || (!githubBusy && githubStatus.error) ? (
              <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {dialogError || githubStatus.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={selected?.id === "feishu"}
        title={st("connectors.feishuTitle")}
        onClose={() => void handleFeishuCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleFeishuCancel()}
            >
              {st("connectors.cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={feishuBusy}
              onClick={() => void (feishuStatus.connected ? handleFeishuLogout() : handleFeishuConnect())}
            >
              {feishuBusy ? st("connectors.processing") : feishuStatus.connected ? st("connectors.disconnect") : st("connectors.feishuConnect")}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">{st("connectors.feishuName")}</div>
                <StatusLabel
                  available={feishuStatus.available}
                  connected={feishuStatus.connected}
                  busy={feishuBusy}
                />
                {feishuStatus.connected && feishuStatus.account ? (
                  <div className="mt-1 text-xs text-text-muted">{st("connectors.account", { account: feishuStatus.account })}</div>
                ) : null}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              {st("connectors.feishuHint")}
            </p>
            {feishuVerifyUrl ? (
              <div className="rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
                <div className="text-[11px] text-text-muted">{st("connectors.authPage")}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void window.agenticxDesktop.openExternal(feishuVerifyUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {st("connectors.openAuth")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void navigator.clipboard.writeText(feishuVerifyUrl)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    {st("connectors.copyLink")}
                  </button>
                </div>
                <p className="text-xs text-text-muted">
                  {st("connectors.feishuOpenHint")}
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
        title={st("connectors.wecomTitle")}
        onClose={() => void handleWecomCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleWecomCancel()}
            >
              {st("connectors.cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={wecomBusy}
              onClick={() => void (wecomStatus.connected ? handleWecomLogout() : handleWecomConnect())}
            >
              {wecomBusy ? st("connectors.processing") : wecomStatus.connected ? st("connectors.disconnect") : st("connectors.wecomConnect")}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">{st("connectors.wecomName")}</div>
                <StatusLabel
                  available={wecomStatus.available}
                  connected={wecomStatus.connected}
                  busy={wecomBusy}
                />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              {st("connectors.wecomHint")}
            </p>
            {!wecomStatus.connected ? (
              <div className="space-y-3">
                <div className="flex gap-1 rounded-lg border border-border bg-surface-card p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs ${
                      wecomMode === "qrcode"
                        ? "bg-surface-card-strong font-medium text-text-strong"
                        : "text-text-muted hover:text-text-strong"
                    }`}
                    disabled={wecomBusy}
                    onClick={() => setWecomMode("qrcode")}
                  >
                    {st("connectors.wecomModeQr")}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs ${
                      wecomMode === "manual"
                        ? "bg-surface-card-strong font-medium text-text-strong"
                        : "text-text-muted hover:text-text-strong"
                    }`}
                    disabled={wecomBusy}
                    onClick={() => setWecomMode("manual")}
                  >
                    {st("connectors.wecomModeManual")}
                  </button>
                </div>
                {wecomMode === "qrcode" ? (
                  <div className="space-y-2">
                    <p className="text-[11px] leading-relaxed text-text-faint">
                      {st("connectors.wecomQrHint")}
                    </p>
                    {wecomQrDataUrl ? (
                      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-3">
                        <img src={wecomQrDataUrl} alt="" width={220} height={220} />
                        <button
                          type="button"
                          className="text-[11px] text-text-muted hover:text-text-strong"
                          onClick={() => void window.agenticxDesktop.openExternal(wecomLoginUrl)}
                        >
                          {st("connectors.wecomOpenLogin")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                <div>
                  <label className="mb-1 block text-[11px] text-text-muted">Bot ID</label>
                  <input
                    type="text"
                    value={botIdInput}
                    onChange={(event) => setBotIdInput(event.target.value)}
                    disabled={wecomBusy}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={st("connectors.botIdPh")}
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
                      placeholder={st("connectors.botSecretPh")}
                      className="w-full rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-text-strong outline-none focus:border-border-strong"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
                      onClick={() => setShowBotSecret((prev) => !prev)}
                    >
                      {showBotSecret ? st("connectors.hide") : st("connectors.show")}
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
                  {st("connectors.howBotCreds")}
                </a>
                  </>
                )}
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
        title={st("connectors.qqmailTitle")}
        onClose={() => void handleQqmailCancel()}
        panelClassName="w-[min(560px,94vw)] bg-surface-panel"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              onClick={() => void handleQqmailCancel()}
            >
              {st("connectors.cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={qqmailBusy}
              onClick={() => void (qqmailStatus.connected ? handleQqmailLogout() : handleQqmailConnect())}
            >
              {qqmailBusy ? st("connectors.processing") : qqmailStatus.connected ? st("connectors.disconnect") : st("connectors.qqmailConnect")}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">{st("connectors.catalog.qqmail.name")}</div>
                <StatusLabel
                  available={qqmailStatus.available}
                  connected={qqmailStatus.connected}
                  busy={qqmailBusy}
                />
                {qqmailStatus.connected && qqmailStatus.account ? (
                  <div className="mt-1 text-xs text-text-muted">{st("connectors.email", { account: qqmailStatus.account })}</div>
                ) : null}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              {st("connectors.qqmailHint")} agent.qq.com.
            </p>
            {qqmailAuthUrl ? (
              <div className="rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
                <div className="text-[11px] text-text-muted">
                  {st("connectors.openOrCopy")}
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
                    {st("connectors.openAuth")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => void navigator.clipboard.writeText(qqmailAuthUrl)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    {st("connectors.copyLink")}
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
        title={st("connectors.tapdTitle")}
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
                {st("connectors.disconnect")}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover"
              disabled={tapdBusy}
              onClick={() => setSelectedId(null)}
            >
              {st("connectors.cancel")}
            </button>
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-4 py-2 text-xs font-medium text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={tapdBusy || !tapdToken.trim()}
              onClick={() => void handleTapdConnect()}
            >
              {tapdBusy ? st("connectors.connectingShort") : st("connectors.saveAndConnect")}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ConnectorIcon item={selected} large />
              <div>
                <div className="text-base font-semibold text-text-strong">{st("connectors.catalog.tapd.name")}</div>
                <StatusLabel available connected={tapdConnected} busy={tapdBusy} />
              </div>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              {st("connectors.tapdHint")}
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => void window.agenticxDesktop.openExternal("https://open.tapd.cn/")}
            >
              {st("connectors.howTapd")}
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
                {st("connectors.tapdTokenHint")}
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
