import { useEffect, useState } from "react";

type LoopReviewDimension = {
  key: string;
  label: string;
  raw_score: number;
  score: number;
  evidence: string;
  rationale: string;
};

type LoopReviewFinding = {
  key: string;
  impact: string;
  repair: string;
  verification: string;
};

type LoopReviewData = {
  session_id: string;
  generated_at: string;
  schema_version: number;
  overall: number;
  dimensions: LoopReviewDimension[];
  findings: LoopReviewFinding[];
};

type Props = {
  sessionId: string;
  onClose: () => void;
};

/** 证据状态展示文案（内部枚举仍为英文，后续可接 i18n） */
const EVIDENCE_LABELS: Record<string, string> = {
  missing: "缺失",
  unobserved: "未观测",
  present: "已存在",
  wired: "已接入",
  exercised: "已执行",
  outcome_supported: "结果可证",
  not_applicable: "不适用",
};

function evidenceLabel(evidence: string): string {
  return EVIDENCE_LABELS[evidence] ?? evidence;
}

function isPositiveEvidence(evidence: string): boolean {
  return evidence === "outcome_supported" || evidence === "exercised";
}

function scoreTone(score: number): "good" | "mid" | "warn" {
  if (score >= 80) return "good";
  if (score >= 60) return "mid";
  return "warn";
}

const TONE_BAR: Record<"good" | "mid" | "warn", string> = {
  good: "bg-[var(--ui-btn-primary-bg,#3b82f6)]",
  mid: "bg-[var(--ui-btn-primary-bg,#3b82f6)] opacity-70",
  warn: "bg-amber-500",
};

const TONE_TEXT: Record<"good" | "mid" | "warn", string> = {
  good: "text-text-strong",
  mid: "text-text-strong",
  warn: "text-amber-500",
};

export function LoopReviewCard({ sessionId, onClose }: Props) {
  const [data, setData] = useState<LoopReviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.agenticxDesktop
      .getSessionLoopReview(sessionId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.review) setData(r.review);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div
      className="flex w-[340px] flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
      style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="text-[13px] font-semibold text-text-strong">会话体检</div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto px-4 py-3">
        {loading && (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-surface-card" />
            ))}
          </div>
        )}

        {!loading && !data && (
          <div className="py-6 text-center text-[12px] text-text-muted">
            本次会话暂无体检数据
          </div>
        )}

        {!loading && data && (
          <>
            <div className="mb-3 flex items-baseline gap-1">
              <span className={`text-2xl font-semibold ${TONE_TEXT[scoreTone(data.overall)]}`}>
                {data.overall}
              </span>
              <span className="text-[12px] text-text-muted">/ 100</span>
            </div>

            <div className="space-y-2.5">
              {data.dimensions.map((d) => {
                const capped = d.score < d.raw_score;
                return (
                  <div key={d.key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[12px] text-text-strong">{d.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1 py-px text-[10px] ${
                            isPositiveEvidence(d.evidence)
                              ? "bg-surface-card-strong text-text-strong"
                              : "bg-surface-card text-text-muted"
                          }`}
                        >
                          {evidenceLabel(d.evidence)}
                        </span>
                        <span className={`text-[12px] font-medium ${TONE_TEXT[scoreTone(d.score)]}`}>
                          {d.score}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-card">
                      <div
                        className={`h-full rounded-full ${TONE_BAR[scoreTone(d.score)]}`}
                        style={{ width: `${d.score}%` }}
                      />
                    </div>
                    {capped && (
                      <div className="mt-0.5 text-[10px] text-text-faint">
                        已按证据封顶（原始 {d.raw_score}）
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[11px] font-medium text-text-muted">
                体检发现（{data.findings.length}）
              </div>
              {data.findings.length === 0 ? (
                <div className="text-[12px] text-text-muted">未发现需要修复的问题</div>
              ) : (
                <div className="space-y-2.5">
                  {data.findings.map((f) => (
                    <div key={f.key} className="rounded-lg bg-surface-card px-2.5 py-2">
                      <div className="text-[12px] text-text-strong">影响：{f.impact}</div>
                      <div className="mt-1 text-[11px] text-text-muted">修复：{f.repair}</div>
                      <div className="text-[11px] text-text-muted">验证：{f.verification}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
