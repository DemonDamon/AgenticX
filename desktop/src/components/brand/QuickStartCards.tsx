import { useTranslation } from "react-i18next";
import { QUICK_START_IDS } from "./quick-start-items";

type Props = {
  onPick: (prompt: string) => void;
};

export function QuickStartCards({ onPick }: Props) {
  const { t } = useTranslation("chat");
  return (
    <div className="grid w-full max-w-2xl grid-cols-2 gap-2 text-left md:grid-cols-3">
      {QUICK_START_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(t(`quickStart.${id}.prompt`))}
          className="rounded-xl border border-border bg-surface-card px-3 py-2.5 transition-colors hover:bg-surface-hover"
        >
          <div className="text-[12px] font-medium text-text-strong">{t(`quickStart.${id}.title`)}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-muted">
            {t(`quickStart.${id}.desc`)}
          </div>
        </button>
      ))}
    </div>
  );
}
