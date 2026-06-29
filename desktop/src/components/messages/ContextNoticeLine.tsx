import { ChevronsDown } from "lucide-react";
import { SystemStatusLine } from "./SystemStatusLine";

type Props = {
  text: string;
};

/** Flat, non-expandable context/token budget notice — aligned with ReAct rail icons. */
export function ContextNoticeLine({ text }: Props) {
  return (
    <SystemStatusLine icon={ChevronsDown} tone="info" data-status-kind="context-limit">
      <span className="min-w-0 break-words">{text}</span>
    </SystemStatusLine>
  );
}
