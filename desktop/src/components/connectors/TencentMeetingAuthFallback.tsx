import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import QRCode from "qrcode";

type Props = {
  authorizationUrl: string;
  browserOpenFailed?: boolean;
};

export function TencentMeetingAuthFallback({
  authorizationUrl,
  browserOpenFailed = false,
}: Props) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl("");
    setQrError("");
    setActionMessage("");
    setActionError("");

    void QRCode.toDataURL(authorizationUrl, {
      width: 208,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrError("二维码生成失败，请复制授权链接后在其他浏览器打开。");
      });

    return () => {
      cancelled = true;
    };
  }, [authorizationUrl]);

  const reopenAuthorizationPage = async () => {
    setActionMessage("");
    setActionError("");
    try {
      const result = await window.agenticxDesktop.openExternal(authorizationUrl);
      if (!result.ok) throw new Error(result.error || "无法打开系统浏览器");
      setActionMessage("已请求系统浏览器重新打开授权页");
    } catch {
      setActionError("仍无法打开网页，请使用手机扫码或复制链接后更换浏览器。");
    }
  };

  const copyAuthorizationUrl = async () => {
    setActionMessage("");
    setActionError("");
    try {
      await navigator.clipboard.writeText(authorizationUrl);
      setActionMessage("授权链接已复制");
    } catch {
      setActionError("复制失败，请手动选中下方链接复制。");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card p-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex h-[208px] w-[208px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="腾讯会议授权二维码"
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : qrError ? (
            <TriangleAlert className="h-8 w-8 text-amber-500" aria-hidden />
          ) : (
            <Loader2 className="h-7 w-7 animate-spin text-slate-500" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-sm font-medium text-text-strong">手机扫码授权</div>
            <p className={`mt-1 text-xs leading-relaxed ${browserOpenFailed ? "text-amber-400" : "text-text-muted"}`}>
              {browserOpenFailed
                ? "电脑浏览器未能打开授权页，可直接使用手机扫码，或复制链接后更换浏览器。"
                : "如果电脑浏览器中的页面无法访问，可直接使用手机扫码继续授权。"}
            </p>
          </div>

          <div className="select-all break-all rounded-md border border-border bg-surface-panel px-2.5 py-2 font-mono text-[10px] leading-relaxed text-text-muted">
            {authorizationUrl}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => void reopenAuthorizationPage()}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              重新打开网页
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => void copyAuthorizationUrl()}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              复制链接
            </button>
          </div>

          {qrError ? <p className="text-xs text-amber-400">{qrError}</p> : null}
          {actionMessage ? <p className="text-xs text-emerald-400">{actionMessage}</p> : null}
          {actionError ? <p className="text-xs text-amber-400">{actionError}</p> : null}
        </div>
      </div>
    </div>
  );
}
