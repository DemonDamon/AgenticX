import { TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ds/Button";
import { Modal } from "../ds/Modal";
import "../../i18n/i18n";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AllowAllConfirmDialog({ open, onCancel, onConfirm }: Props) {
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation("common");
  const risks = [t("composer.allowAllRiskDelete"), t("composer.allowAllRiskLeak")];
  return (
    <Modal
      open={open}
      backdropClassName="bg-black/55 backdrop-blur-[2px]"
      panelClassName="w-[408px] max-w-[92vw] bg-surface-panel"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-w-[68px]" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button variant="primary" className="min-w-[68px] font-medium" onClick={onConfirm}>
            {t("composer.enable")}
          </Button>
        </div>
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-[var(--status-warning)]">
            <TriangleAlert className="h-[15px] w-[15px]" strokeWidth={2} />
          </span>
          <h3 className="truncate text-[15px] font-semibold leading-none text-text-strong">
            {t("composer.allowAllTitle")}
          </h3>
        </div>
        <button
          type="button"
          aria-label={tCommon("close")}
          className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-text-faint transition-colors hover:bg-surface-hover hover:text-text-primary"
          onClick={onCancel}
        >
          <X className="h-[15px] w-[15px]" strokeWidth={2} />
        </button>
      </div>

      <p className="mt-3.5 text-[13px] leading-[1.7] text-text-muted">
        {t("composer.allowAllBody")}
      </p>

      <div className="mt-3 rounded-lg border-l-2 border-amber-500/60 bg-amber-500/[0.07] py-2 pl-3 pr-3">
        <p className="text-[12px] font-medium leading-none text-[var(--status-warning)]">
          {t("composer.allowAllRisks")}
        </p>
        <ul className="mt-1.5 space-y-1">
          {risks.map((risk) => (
            <li key={risk} className="flex items-start gap-1.5 text-[12.5px] leading-[1.6] text-text-muted">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-500/70" />
              {risk}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[12px] leading-[1.6] text-text-faint">
        {t("composer.allowAllFooter")}
      </p>
    </Modal>
  );
}
