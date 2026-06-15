import { useMemo, useState } from "react";
import type { Message } from "../../store";
import type { SkillPatchPreviewPayload } from "./skill-manage-preview";

type Props = {
  message: Message;
  payload: SkillPatchPreviewPayload;
  onApply?: (message: Message, payload: SkillPatchPreviewPayload, targetIndex: number | null) => void;
};

export function SkillPatchPreviewCard({ message, payload, onApply }: Props) {
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const ranges = payload.target_ranges ?? [];
  const requiresTarget = Boolean(payload.requires_target_selection) && ranges.length > 1;
  const canApply = !requiresTarget || selectedTarget !== null;
  const riskLabel = useMemo(() => {
    const verdict = String(payload.risk?.verdict ?? "").toLowerCase();
    if (verdict === "dangerous") return "高风险";
    if (verdict === "caution") return "需警惕";
    if (verdict === "safe") return "安全";
    return "未知";
  }, [payload.risk?.verdict]);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-[12px] text-text-subtle">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface-hover px-1.5 py-0.5">skill patch preview</span>
        {payload.strategy ? <span>策略: {payload.strategy}</span> : null}
        {typeof payload.match_count === "number" ? <span>命中: {payload.match_count}</span> : null}
      </div>
      {payload.risk ? (
        <div className="rounded border border-border bg-surface-hover px-2 py-1">
          <div>风险: {riskLabel}</div>
          {payload.risk.reason ? <div className="mt-0.5 break-words text-text-faint">{payload.risk.reason}</div> : null}
          {payload.risk.findings && payload.risk.findings.length > 0 ? (
            <div className="mt-1 break-words text-text-faint">命中: {payload.risk.findings.slice(0, 5).join(", ")}</div>
          ) : null}
        </div>
      ) : null}

      {ranges.length > 0 ? (
        <div className="space-y-1">
          <div className="text-text-muted">候选目标</div>
          <div className="space-y-1">
            {ranges.map((r, i) => (
              <button
                key={`${r.start}-${r.end}-${i}`}
                type="button"
                className={`w-full rounded border px-2 py-1 text-left transition ${
                  selectedTarget === i
                    ? "border-[rgb(var(--theme-color-rgb,6,182,212))] bg-surface-hover text-text-strong"
                    : "border-border bg-surface-card text-text-subtle hover:bg-surface-hover"
                }`}
                onClick={() => setSelectedTarget(i)}
              >
                #{i} 行 {r.start_line}-{r.end_line} (pos {r.start}-{r.end})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {payload.diff ? (
        <div className="space-y-1">
          <button
            type="button"
            className="rounded border border-border bg-surface-hover px-2 py-0.5 text-[11px] text-text-strong"
            onClick={() => setShowDiff((v) => !v)}
          >
            {showDiff ? "收起 diff" : "展开 diff"}
          </button>
          {showDiff ? (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-black/20 p-2 text-[11px] leading-relaxed text-text-faint">
              {payload.diff}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {!armed ? (
          <button
            type="button"
            className="rounded border border-border bg-surface-hover px-2 py-1 text-[11px] text-text-strong hover:opacity-90 disabled:opacity-50"
            onClick={() => setArmed(true)}
            disabled={!canApply}
          >
            准备应用
          </button>
        ) : (
          <>
            <button
              type="button"
              className="rounded border border-[rgb(var(--theme-color-rgb,6,182,212))] bg-[rgba(var(--theme-color-rgb,6,182,212),0.12)] px-2 py-1 text-[11px] text-text-strong hover:opacity-90 disabled:opacity-50"
              onClick={() => onApply?.(message, payload, requiresTarget ? selectedTarget : null)}
              disabled={!canApply}
            >
              确认应用
            </button>
            <button
              type="button"
              className="rounded border border-border bg-surface-hover px-2 py-1 text-[11px] text-text-subtle"
              onClick={() => setArmed(false)}
            >
              取消
            </button>
          </>
        )}
        {requiresTarget && selectedTarget === null ? (
          <span className="text-[11px] text-amber-400">请先选择目标片段</span>
        ) : null}
      </div>
    </div>
  );
}
