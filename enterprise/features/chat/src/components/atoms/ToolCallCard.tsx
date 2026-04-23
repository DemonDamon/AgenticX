import * as React from "react";
import type { ToolCallSummary } from "@agenticx/core-api";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@agenticx/ui";

type ToolCallCardProps = {
  toolCall?: ToolCallSummary;
};

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Card className="mt-2 border-dashed">
      <CardHeader className="flex flex-row items-center justify-between p-3">
        <CardTitle className="text-xs uppercase tracking-wide">Tool Call</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Collapse" : "Expand"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="p-3 pt-0 text-xs text-zinc-500 dark:text-zinc-400">
          <p>name: {toolCall?.tool_name ?? "placeholder_tool"}</p>
          <p>status: {toolCall?.status ?? "queued"}</p>
          <p>preview: {toolCall?.result_preview ?? "W3 接入真实工具调用摘要"}</p>
        </CardContent>
      )}
    </Card>
  );
}

