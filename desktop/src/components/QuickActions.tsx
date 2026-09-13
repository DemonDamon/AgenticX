import { useTranslation } from "react-i18next";

type Props = {
  onSend: (text: string) => void;
};

const QUICK_ACTION_IDS = ["write", "translate", "summarize", "files", "search", "plan"] as const;

export function QuickActions({ onSend }: Props) {
  const { t } = useTranslation("sidebar");
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {QUICK_ACTION_IDS.map((id) => (
        <button
          key={id}
          onClick={() => onSend(t(`quickActions.${id}.prompt`))}
          className="rounded-full border border-border bg-surface-card px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover"
        >
          {t(`quickActions.${id}.label`)}
        </button>
      ))}
    </div>
  );
}
