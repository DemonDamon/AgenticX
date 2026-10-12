/**
 * Collapsed long-report remainder under a group expert bubble.
 * Author: Damon Li
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FileText } from "lucide-react";
import { CitationMarkdownBody } from "./CitationMarkdownBody";

type Props = {
  content: string;
  onQuoteText?: (text: string) => void;
  onRevealPath?: (path: string) => void;
};

export function GroupTalkReportCard({ content, onQuoteText, onRevealPath }: Props) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const body = String(content ?? "").trim();
  if (!body) return null;

  return (
    <div data-slot="group-talk-report" className="agx-group-talk-report mt-1.5 w-full min-w-0 max-w-full">
      <button
        type="button"
        className="flex w-fit max-w-full items-center gap-1.5 rounded-full bg-surface-card-strong px-2.5 py-1 text-[12px] font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t("groupReport.title")}</span>
        <span className="text-text-faint">{open ? t("groupReport.collapse") : t("groupReport.expand")}</span>
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-text-faint transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          className="agx-im-body-type mt-1.5 min-w-0 max-w-full rounded-[18px] px-3.5 py-2 text-[var(--agx-chat-im-body-font-size)]"
          style={{
            background: "var(--chat-im-assistant-bg)",
            color: "var(--chat-im-assistant-text)",
          }}
        >
          <CitationMarkdownBody content={body} onQuoteText={onQuoteText} onRevealPath={onRevealPath} />
        </div>
      ) : null}
    </div>
  );
}
