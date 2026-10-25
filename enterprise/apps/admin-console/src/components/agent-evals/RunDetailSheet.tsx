"use client";

import React, { useState } from "react";
import { Badge, Button, Progress, Sheet, SheetContent, SheetHeader, SheetTitle, StatCard } from "@agenticx/ui";

import { evalProgressPercent, type EvalResultView, type EvalRunView } from "../../lib/ma/eval-records";

type Filter = "all" | "failed" | "error";

export function RunDetailSheet({
  open = false,
  onOpenChange,
  run,
  results,
  embed = false,
  initialFilter = "all",
  initialExpandedId = null,
  onCompare,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  run: EvalRunView | null;
  results: EvalResultView[];
  embed?: boolean;
  initialFilter?: Filter;
  initialExpandedId?: string | null;
  onCompare?: () => void;
}) {
  const body = (
    <RunDetailBody
      run={run}
      results={results}
      initialFilter={initialFilter}
      initialExpandedId={initialExpandedId}
      onCompare={onCompare}
    />
  );
  if (embed) return body;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(960px,96vw)] overflow-y-auto sm:max-w-none">
        <SheetHeader>
          <SheetTitle>评测详情</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function RunDetailBody({
  run,
  results,
  initialFilter,
  initialExpandedId,
  onCompare,
}: {
  run: EvalRunView | null;
  results: EvalResultView[];
  initialFilter: Filter;
  initialExpandedId: string | null;
  onCompare?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [expanded, setExpanded] = useState<string | null>(initialExpandedId);
  const summary = run?.summary ?? {};
  const percent = evalProgressPercent(run?.progress);
  const visible = results.filter((row) => {
    if (filter === "all") return true;
    if (filter === "failed") return row.status === "failed";
    return row.status === "error";
  });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="均分" value={summary.mean_score ?? "—"} />
        <StatCard label="通过率" value={summary.pass_rate ?? "—"} />
        <StatCard label="未通过" value={summary.failed ?? 0} />
        <StatCard label="执行异常" value={summary.errored ?? 0} />
      </div>
      <p className="text-sm text-muted-foreground">执行异常不计入通过率与均分</p>
      <Progress value={percent} data-value={percent} aria-label="进度" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          全部
        </Button>
        <Button type="button" size="sm" variant={filter === "failed" ? "default" : "outline"} onClick={() => setFilter("failed")}>
          未通过
        </Button>
        <Button type="button" size="sm" variant={filter === "error" ? "default" : "outline"} onClick={() => setFilter("error")}>
          执行异常
        </Button>
        {onCompare ? (
          <Button type="button" size="sm" variant="outline" onClick={onCompare}>
            与另一次评测对比
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {visible.map((row) => (
          <div key={row.id} data-result-id={row.id} className="rounded-md border border-border p-3">
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
              <span>#{row.position} {row.status}</span>
              <Badge variant={row.status === "passed" ? "default" : "destructive"}>{row.status}</Badge>
            </button>
            {expanded === row.id ? (
              <div className="mt-3 space-y-2 text-sm">
                <p>{row.answer}</p>
                <p>裁判理由：{row.judge?.reason ?? "无"}</p>
                <ul>
                  {row.rule_results.map((rule) => (
                    <li key={`${rule.type}-${rule.detail}`} className={rule.passed ? "text-green-600" : "text-red-600"}>
                      {rule.type}: {rule.detail}
                    </li>
                  ))}
                </ul>
                {row.session_id ? <a href={`/ops/logs/managed/${row.session_id}`}>查看会话</a> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
