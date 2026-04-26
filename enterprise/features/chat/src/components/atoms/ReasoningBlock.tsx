import * as React from "react";
import { Button } from "@agenticx/ui";

type ReasoningBlockProps = {
  reasoning?: string;
};

export function ReasoningBlock({ reasoning }: ReasoningBlockProps) {
  const [open, setOpen] = React.useState(false);
  const content = reasoning?.trim();

  if (!content) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-surface-subtle/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Reasoning</span>
        <Button size="xs" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <p className="mt-2 rounded-md bg-background/35 px-2.5 py-2 text-xs leading-6 text-muted-foreground">
          {content}
        </p>
      )}
    </div>
  );
}

