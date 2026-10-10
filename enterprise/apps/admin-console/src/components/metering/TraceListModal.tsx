"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Badge, EmptyState } from "@agenticx/ui";
import { FileSearch } from "lucide-react";

type TraceRow = {
  trace_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  step_count: number;
  first_seen: string | null;
  models: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: TraceRow[];
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  colTraceId?: string;
  colTokens?: string;
  colCost?: string;
  colSteps?: string;
  colFirstSeen?: string;
  colModels?: string;
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TraceListModal({
  open,
  onOpenChange,
  rows,
  title,
  description,
  emptyTitle,
  emptyDescription,
  colTraceId,
  colTokens,
  colCost,
  colSteps,
  colFirstSeen,
  colModels,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] min-w-[900px] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title ?? "Top Traces by Token"}</DialogTitle>
          <DialogDescription>{description ?? "Click a trace to inspect step-level usage"}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileSearch className="h-5 w-5" />}
              title={emptyTitle ?? "No trace data"}
              description={emptyDescription ?? "Usage records in current filters have no trace_id"}
              size="default"
              className="border border-dashed m-6"
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colTraceId ?? "Trace ID"}</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colTokens ?? "Tokens"}</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colCost ?? "Cost"}</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colSteps ?? "Steps"}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colFirstSeen ?? "First Seen"}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colModels ?? "Models"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.trace_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/metering/agent-traces?trace_id=${encodeURIComponent(r.trace_id)}`}
                        target="_blank"
                        className="text-primary hover:underline"
                      >
                        {r.trace_id.slice(0, 16)}…
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.total_tokens)}</td>
                    <td className="px-3 py-2 text-right font-mono">${r.cost_usd.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.step_count}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.first_seen ? r.first_seen.slice(0, 16).replace("T", " ") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.models.slice(0, 3).map((m) => (
                          <Badge key={m} variant="soft" className="text-[10px] font-mono">{m}</Badge>
                        ))}
                        {r.models.length > 3 ? (
                          <Badge variant="soft" className="text-[10px]">+{r.models.length - 3}</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
