import { useTranslation } from "react-i18next";

/** Shown after the user started shell `codebuddy login` — auth CTA is dismissed until retry succeeds. */
export function CodebuddyLoginPendingTip() {
  const { t } = useTranslation("chat");
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-text-muted" role="status">
      {t("harness.codebuddyLogin.pendingRetry")}
    </p>
  );
}
