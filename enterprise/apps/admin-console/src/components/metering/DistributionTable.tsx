"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from "@agenticx/ui";

type DistRow = {
  model: string;
  request_count: number;
  avg_tokens: number;
  p50: number;
  p90: number;
  p99: number;
};

type Props = {
  title: string;
  description?: string;
  rows: DistRow[];
  emptyLabel?: string;
  colModel?: string;
  colRequests?: string;
  colAvg?: string;
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function DistributionTable({ title, description, rows, emptyLabel, colModel, colRequests, colAvg }: Props) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {emptyLabel ?? "No data"}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colModel ?? "Model"}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colRequests ?? "Requests"}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{colAvg ?? "Avg"}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">p50</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">p90</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">p99</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Badge variant="soft" className="font-mono text-[10px]">{r.model}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatNumber(r.request_count)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatNumber(r.avg_tokens)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatNumber(r.p50)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-amber-500">{formatNumber(r.p90)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-500">{formatNumber(r.p99)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
