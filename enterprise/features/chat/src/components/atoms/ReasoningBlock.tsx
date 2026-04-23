import * as React from "react";
import { Button } from "@agenticx/ui";

type ReasoningBlockProps = {
  reasoning?: string;
};

export function ReasoningBlock({ reasoning }: ReasoningBlockProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Reasoning</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {reasoning ?? "Reasoning placeholder. W3 将接入真实推理内容。"}
        </p>
      )}
    </div>
  );
}

