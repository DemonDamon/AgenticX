import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Loader2, X } from "lucide-react";

export type QrConnectModalProps = {
  open: boolean;
  gatewayBaseUrl: string;
  deviceId: string;
  token: string;
  onClose: () => void;
  onBound?: () => void;
};

type SessionStatus = "pending" | "scanned" | "bound" | "expired" | string;

type ConnectSessionResponse = {
  session_id: string;
  binding_code: string;
  qr_url: string;
  status: SessionStatus;
  expires_at: number;
  platform?: string;
  sender_name?: string;
};

export function QrConnectModal({
  open,
  gatewayBaseUrl,
  deviceId,
  token,
  onClose,
  onBound,
}: QrConnectModalProps) {
  const [phase, setPhase] = useState<"idle" | "creating" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState<SessionStatus>("pending");
  const [bindingCode, setBindingCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const boundNotified = useRef(false);

  const base = gatewayBaseUrl.trim().replace(/\/+$/, "");

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    setPhase("creating");
    setError("");
    setQrDataUrl("");
    setSessionId("");
    boundNotified.current = false;
    try {
      const r = await fetch(`${base}/api/connect/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId.trim(), token: token.trim() }),
      });
      const text = await r.text();
      let data: ConnectSessionResponse;
      try {
        data = JSON.parse(text) as ConnectSessionResponse;
      } catch {
        throw new Error(text.slice(0, 200) || `HTTP ${r.status}`);
      }
      if (!r.ok) {
        throw new Error((data as unknown as { detail?: string }).detail || text.slice(0, 200) || `HTTP ${r.status}`);
      }
      setSessionId(data.session_id);
      setBindingCode(data.binding_code);
      setStatus(data.status);
      setExpiresAt(typeof data.expires_at === "number" ? data.expires_at : 0);
      const url = data.qr_url || `${base}/connect/${data.session_id}`;
      const png = await QRCode.toDataURL(url, { width: 220, margin: 2, errorCorrectionLevel: "M" });
      setQrDataUrl(png);
      setPhase("ready");
    } catch (e) {
      setPhase("error");
      setError(String(e));
    }
  }, [base, deviceId, token]);

  useEffect(() => {
    if (!open) {
      clearTimers();
      setPhase("idle");
      setError("");
      setQrDataUrl("");
      setSessionId("");
      boundNotified.current = false;
      return;
    }
    void startSession();
    return () => clearTimers();
  }, [open, startSession, clearTimers]);

  useEffect(() => {
    if (!open || phase !== "ready" || !sessionId) return;

    const poll = async () => {
      try {
        const r = await fetch(`${base}/api/connect/session/${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        const j = (await r.json()) as ConnectSessionResponse;
        setStatus(j.status);
        if (j.status === "bound" && !boundNotified.current) {
          boundNotified.current = true;
          onBound?.();
          setTimeout(() => onClose(), 1500);
        }
      } catch {
        /* ignore transient errors */
      }
    };

    pollRef.current = setInterval(() => void poll(), 2000);
    void poll();

    clockRef.current = setInterval(() => setNowMs(Date.now()), 1000);

    return () => clearTimers();
  }, [open, phase, sessionId, base, onBound, onClose, clearTimers]);

  const leftSec =
    expiresAt > 0 ? Math.max(0, Math.floor(expiresAt - nowMs / 1000)) : 0;

  const statusLabel =
    status === "bound"
      ? "已连接"
      : status === "expired"
        ? "已过期"
        : status === "scanned"
          ? "已扫码，请在 IM 中发送绑定指令"
          : "请使用微信或系统相机扫码";

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-connect-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative max-w-sm rounded-xl border border-border bg-surface-panel p-5 shadow-xl">
        <button
          type="button"
          className="absolute right-3 top-3 rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-subtle"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 id="qr-connect-title" className="pr-8 text-[16px] font-medium text-text-strong">
          扫码连接 IM
        </h2>
        <p className="mt-2 text-xs text-text-faint">
          扫码后在手机页复制「绑定」整句，到飞书/企微机器人会话中发送。网关须在公网可访问。
        </p>

        {phase === "creating" && (
          <div className="mt-8 flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-text-faint" />
            <span className="text-sm text-text-subtle">正在生成二维码…</span>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error || "创建会话失败"}
          </div>
        )}

        {phase === "ready" && qrDataUrl && (
          <div className="mt-4 flex flex-col items-center">
            <img src={qrDataUrl} alt="连接二维码" className="rounded-lg border border-border bg-white p-2" />
            <p className="mt-3 text-center text-sm text-text-subtle">{statusLabel}</p>
            {bindingCode && (
              <p className="mt-1 text-center text-xs text-text-faint">
                绑定码：<span className="font-mono text-text-muted">{bindingCode}</span>
              </p>
            )}
            <p className="mt-2 text-center text-xs text-amber-500/90">
              {leftSec > 0
                ? `剩余 ${leftSec} 秒`
                : status !== "bound"
                  ? "可能已过期，可关闭后重试"
                  : ""}
            </p>
            {status === "bound" && (
              <p className="mt-2 text-center text-sm text-green-500">绑定成功，窗口将自动关闭</p>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {phase === "error" && (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-hover"
              onClick={() => void startSession()}
            >
              重试
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-hover"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
