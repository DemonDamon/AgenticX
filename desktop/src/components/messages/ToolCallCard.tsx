import type { Message } from "../../store";
import type { ReactNode } from "react";
import { Wrench } from "lucide-react";

type Props = {
  message: Message;
  action?: ReactNode;
};

export function ToolCallCard({ message, action }: Props) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted">
      <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-text-subtle">
        <Wrench className="h-3.5 w-3.5" />
        Tool
      </div>
      <div className="space-y-1">
        <span className="break-all">{message.content}</span>
        {action}
      </div>
    </div>
  );
}
