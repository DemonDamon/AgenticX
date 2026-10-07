/**
 * 安装确认条:registry 技能命中确认码(non_high / high)时出现在内容区底部,
 * 用户「继续安装 / 取消」后回到状态机。
 */

import { useTranslation } from "react-i18next";
import { Loader2, ShieldAlert, ShieldQuestion } from "lucide-react";

export function InstallConfirmBar({
  kind,
  busy,
  onConfirm,
  onCancel,
}: {
  kind: "non_high" | "high";
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("marketplace");
  const isHigh = kind === "high";
  return (
    <div
      role="alertdialog"
      aria-label={t("scan.confirmTitle")}
      className={`sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
        isHigh
          ? "border-rose-500/50 bg-rose-500/15"
          : "border-amber-500/50 bg-amber-500/15"
      }`}
      data-market-confirm={kind}
    >
      {isHigh ? (
        <ShieldAlert className="h-5 w-5 shrink-0 text-rose-400" aria-hidden />
      ) : (
        <ShieldQuestion className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${isHigh ? "text-rose-300" : "text-amber-300"}`}>
          {t("scan.confirmTitle")}
        </div>
        <div className="mt-0.5 text-xs leading-relaxed text-text-muted">
          {t(isHigh ? "scan.highRisk" : "scan.nonHighRisk")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
          disabled={busy}
          onClick={onCancel}
        >
          {t("scan.cancel")}
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
            isHigh ? "bg-rose-500 text-white hover:bg-rose-500/90" : "bg-btnPrimary text-btnPrimary-text hover:bg-btnPrimary-hover"
          }`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {busy ? t("actions.installing") : t("scan.continueInstall")}
        </button>
      </div>
    </div>
  );
}
