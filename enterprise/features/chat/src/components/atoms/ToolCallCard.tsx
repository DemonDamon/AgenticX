import * as React from "react";
import type { ToolCallSummary } from "@agenticx/core-api";
import { Button } from "@agenticx/ui";

type ToolCallCardProps = {
  toolCall?: ToolCallSummary;
};

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [open, setOpen] = React.useState(false);

  if (!toolCall) return null;

  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-surface-subtle/45 p-3">
      <div className="flex flex-row items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tool Call</span>
        <Button size="xs" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Collapse" : "Expand"}
        </Button>
      </div>
      {open && (
        <div className="space-y-1.5 rounded-md bg-background/35 px-2.5 py-2 text-xs leading-6 text-muted-foreground">
          <p>name: {toolCall.tool_name}</p>
          <p>status: {toolCall.status}</p>
          <p>preview: {toolCall.result_preview}</p>
        </div>
      )}
    </div>
  );
}

