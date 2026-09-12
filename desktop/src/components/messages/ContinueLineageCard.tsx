import { ExternalLink, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationLineage } from "../../utils/session-message-map";

type Props = {
  lineage: ConversationLineage;
  sourceTitle?: string;
  onOpenSource?: (lineage: ConversationLineage) => void;
};

export function ContinueLineageCard({
  lineage,
  sourceTitle,
  onOpenSource,
}: Props) {
  const { t } = useTranslation("chat");
  const source = sourceTitle?.trim() || lineage.parentSessionId.slice(0, 12);
  return (
    <div className="mx-auto my-2 flex max-w-[680px] items-start gap-2 rounded-lg bg-surface-card px-3 py-2 text-[11px] text-text-muted">
      <GitBranch aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
      <div className="min-w-0 flex-1">
        <div>
          {t("actions.continueLineage", { source })}
        </div>
      </div>
      {onOpenSource ? (
        <button
          type="button"
          className="rounded-md p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
          aria-label={t("actions.continueOpenSource")}
          onClick={() => onOpenSource(lineage)}
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
