import { useTranslation } from "react-i18next";

type Props = {
  onLogin: () => void;
};

/** Composer CTA: CodeBuddy auth expired, re-login inside Near's terminal. */
export function CodebuddyLoginPrompt({ onLogin }: Props) {
  const { t } = useTranslation("chat");
  return (
    <div className="mb-2 flex justify-center px-1" role="status">
      <button
        type="button"
        onClick={onLogin}
        className="inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-center text-[12px] text-amber-100/95 transition hover:bg-amber-500/20 [html[data-theme=light]_&]:border-amber-600/50 [html[data-theme=light]_&]:bg-amber-500/15 [html[data-theme=light]_&]:text-amber-900 [html[data-theme=light]_&]:hover:bg-amber-500/25"
      >
        <span aria-hidden>!</span>
        <span>{t("harness.codebuddyLogin.banner")}</span>
      </button>
    </div>
  );
}
