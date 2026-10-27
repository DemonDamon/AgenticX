"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@agenticx/ui";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("pages.admin.agentEvals.compare");
  const baseRate = comparison?.base.summary.pass_rate;
  const targetRate = comparison?.target.summary.pass_rate;
  const baseMean = comparison?.base.summary.mean_score;
  const targetMean = comparison?.target.summary.mean_score;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        {comparison ? (
          <div className="space-y-3 text-sm">
            <p>
              {t("passRate", { base: baseRate ?? "—", target: targetRate ?? "—", delta: comparison.delta.pass_rate ?? "—" })}
            </p>
            <p>
              {t("meanScore", { base: baseMean ?? "—", target: targetMean ?? "—", delta: comparison.delta.mean_score ?? "—" })}
            </p>
            <p>
              {t("counts", {
                fixed: comparison.counts.fixed,
                regressed: comparison.counts.regressed,
                unchanged: comparison.counts.unchanged,
                errored: comparison.counts.errored,
              })}
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
          <p>{t("hint")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
