import { useTranslation } from "react-i18next";

type Props = {
  onLogin: () => void;
  /** Composer pill vs assistant-bubble inline block. */
  variant?: "composer" | "inline";
};

const CTA_BUTTON_CLASS =
  "inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-center text-[12px] text-amber-100/95 transition hover:bg-amber-500/20 [html[data-theme=light]_&]:border-amber-600/50 [html[data-theme=light]_&]:bg-amber-500/15 [html[data-theme=light]_&]:text-amber-900 [html[data-theme=light]_&]:hover:bg-amber-500/25";

/** CodeBuddy auth expired — browser OAuth (same flow as MCP F2.0 connectors). */
export function CodebuddyLoginPrompt({ onLogin, variant = "composer" }: Props) {
  const { t } = useTranslation("chat");
  if (variant === "inline") {
    return (
      <div className="mt-2 space-y-2" role="status">
        <p className="text-[13px] leading-relaxed text-text-strong">{t("harness.codebuddyLogin.body")}</p>
        <button type="button" onClick={onLogin} className={CTA_BUTTON_CLASS}>
          <span aria-hidden>!</span>
          <span>{t("harness.codebuddyLogin.banner")}</span>
        </button>
        <p className="text-[12px] leading-relaxed text-text-muted">{t("harness.codebuddyLogin.retryHint")}</p>
      </div>
    );
  }
  return (
    <div className="mb-2 flex justify-center px-1" role="status">
      <button type="button" onClick={onLogin} className={CTA_BUTTON_CLASS}>
        <span aria-hidden>!</span>
        <span>{t("harness.codebuddyLogin.banner")}</span>
      </button>
    </div>
  );
}
