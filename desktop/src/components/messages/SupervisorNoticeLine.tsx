import { CheckCircle2, OctagonAlert } from "lucide-react";
import type { Message } from "../../store";
import {
  isSupervisorDoneNotice,
  isSupervisorFailNotice,
  supervisorNoticeDisplayText,
} from "../../utils/supervisor-notice";
import { SystemStatusLine } from "./SystemStatusLine";

type Props = {
  message: Message;
};

export function SupervisorNoticeLine({ message }: Props) {
  const text = supervisorNoticeDisplayText(String(message.content ?? ""));
  if (!text) return null;
  const done = isSupervisorDoneNotice(message);
  const fail = isSupervisorFailNotice(message);
  const Icon = done ? CheckCircle2 : OctagonAlert;
  const tone = done ? "success" : "warning";

  return (
    <SystemStatusLine
      icon={Icon}
      tone={tone}
      data-status-kind={done ? "supervisor-done" : "supervisor-fail"}
    >
      <span className={fail ? "text-amber-100/88" : "text-text-subtle"}>{text}</span>
    </SystemStatusLine>
  );
}
