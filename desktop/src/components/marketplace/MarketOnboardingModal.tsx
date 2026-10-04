/**
 * 插件市场首次进入引导弹窗:渐变 hero + 四个价值点 + 「我知道了」。
 * 关闭状态落在 localStorage,之后不再打扰。
 */

import { useTranslation } from "react-i18next";
import { Check, FileText, Plug, Sparkles, Wrench } from "lucide-react";
import { Modal } from "../ds/Modal";

/** 已读标记的存储键。 */
export const MARKET_ONBOARDING_DISMISSED_KEY = "agenticx.market.onboarding.v1.dismissed";

const POINT_ICONS = [FileText, Plug, Wrench, Sparkles] as const;

export function MarketOnboardingModal({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("marketplace");
  return (
    <Modal
      open={open}
      panelClassName="w-[560px] max-w-[92vw] bg-surface-panel"
    >
      <div data-market-onboarding>
        <div className="-m-4 mb-0 overflow-hidden rounded-t-xl bg-gradient-to-br from-sky-500 via-violet-500 to-purple-600 px-6 pb-6 pt-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <Sparkles className="h-6 w-6 text-white" aria-hidden />
          </div>
          <h3 className="text-lg font-semibold text-white">{t("onboarding.title")}</h3>
        </div>
        <ul className="space-y-3 px-2 py-5">
          {[1, 2, 3, 4].map((i) => {
            const Icon = POINT_ICONS[i - 1];
            return (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="text-[13px] leading-relaxed text-text-muted">
                  {t(`onboarding.point${i}`)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-center border-t border-border px-4 pt-4">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-5 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
            onClick={onDismiss}
          >
            <Check className="h-4 w-4" aria-hidden />
            {t("onboarding.gotIt")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
