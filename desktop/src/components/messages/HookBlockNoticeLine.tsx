import { ShieldAlert } from "lucide-react";
import { SystemStatusLine } from "./SystemStatusLine";

type Props = {
  text: string;
};

/** Flat notice when the model only restates a hook-block tool result. */
export function HookBlockNoticeLine({ text }: Props) {
  return (
    <SystemStatusLine icon={ShieldAlert} tone="warning" data-status-kind="hook-block">
      <span className="min-w-0 break-words">{text}</span>
    </SystemStatusLine>
  );
}
