import { CalendarClock, ChevronsDown, CircleAlert, TriangleAlert } from "lucide-react";
import type { ContextNoticeKind } from "../../store";
import { SystemStatusLine } from "./SystemStatusLine";

type Props = {
  text: string;
  kind: ContextNoticeKind;
};

/** Flat, non-expandable context/token budget notice — aligned with ReAct rail icons. */
export function ContextNoticeLine({ text, kind }: Props) {
  const visual = kind === "token_warning_red"
    ? { icon: CircleAlert, tone: "danger" as const, status: "token-warning-red" }
    : kind === "enterprise_quota"
      ? { icon: CalendarClock, tone: "danger" as const, status: "enterprise-quota" }
    : kind === "token_warning_yellow"
      ? { icon: TriangleAlert, tone: "warning" as const, status: "token-warning-yellow" }
      : { icon: ChevronsDown, tone: "info" as const, status: "context-limit" };
  return (
    <SystemStatusLine icon={visual.icon} tone={visual.tone} data-status-kind={visual.status}>
      <span className="min-w-0 break-words">{text}</span>
    </SystemStatusLine>
  );
}
