import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  error: string;
  onClose: () => void;
};

export function CommandPerfCard({ error, onClose }: Props) {
  const { t } = useTranslation("chat");
  if (!error) return null;
  return (
    <div className="mb-2 rounded-xl border border-border bg-surface-panel px-3 py-2 text-[12px] text-text-primary">
      <div className="flex items-start justify-between gap-2">
        <p className="text-status-error">{error}</p>
        <button type="button" className="rounded p-1 text-text-faint hover:bg-surface-hover" onClick={onClose} aria-label={t("composer.commands.close")}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
