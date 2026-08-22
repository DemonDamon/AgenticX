import { ChevronsDown, RefreshCw } from "lucide-react";
import { WIDGET_FLOW_REWRITE_STATUS } from "../../utils/context-notice";
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

/** In-stream only: shown while a text flowchart draft is replaced, then unmounted. */
export function WidgetFlowRewriteStatusLine() {
  return (
    <SystemStatusLine icon={RefreshCw} tone="info" data-status-kind="widget-flow-rewrite">
      <span className="min-w-0 break-words">{WIDGET_FLOW_REWRITE_STATUS}</span>
    </SystemStatusLine>
  );
}
