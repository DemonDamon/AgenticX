import { useTranslation } from "react-i18next";

export type CodebuddyLoginTipPhase = "authorizing" | "success" | "failed";

type Props = {
  phase: CodebuddyLoginTipPhase;
  error?: string | null;
};

/** OAuth progress after user clicks re-login (never harness REPL). */
export function CodebuddyLoginPendingTip({ phase, error }: Props) {
  const { t } = useTranslation("chat");
  const key =
    phase === "authorizing"
      ? "harness.codebuddyLogin.authorizing"
      : phase === "success"
        ? "harness.codebuddyLogin.oauthSuccess"
        : "harness.codebuddyLogin.oauthFailed";
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-text-muted" role="status">
      {phase === "failed" && error
        ? t(key, { error })
        : t(key)}
    </p>
  );
}
