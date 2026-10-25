"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@agenticx/ui";

import type { EvalComparison } from "../../lib/ma/eval-compare";

export function CompareDialog({
  open,
  onOpenChange,
  comparison,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparison: EvalComparison | null;
}) {
  const baseRate = comparison?.base.summary.pass_rate;
  const targetRate = comparison?.target.summary.pass_rate;
  const baseMean = comparison?.base.summary.mean_score;
  const targetMean = comparison?.target.summary.mean_score;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>版本对比</DialogTitle>
        </DialogHeader>
        {comparison ? (
          <div className="space-y-3 text-sm">
            <p>
              通过率 {baseRate ?? "—"} → {targetRate ?? "—"}（{comparison.delta.pass_rate ?? "—"}）
            </p>
            <p>
              均分 {baseMean ?? "—"} → {targetMean ?? "—"}（{comparison.delta.mean_score ?? "—"}）
            </p>
            <p>
              修复 {comparison.counts.fixed} / 退化 {comparison.counts.regressed} / 不变 {comparison.counts.unchanged} / 异常 {comparison.counts.errored}
            </p>
            <div className="max-h-80 overflow-auto">
              {comparison.items.map((item) => (
                <div key={item.item_id} className="border-b border-border py-2">
                  <span>#{item.position} {item.change}</span>
                  <p className="text-muted-foreground">{item.query}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p>选择同评测集、同评分标准的另一次已完成评测。</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
