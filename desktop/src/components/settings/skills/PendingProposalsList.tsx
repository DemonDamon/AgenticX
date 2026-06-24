import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import { useAppStore } from "../../../store";

interface ProposalScore {
  accuracy: number;
  brevity: number;
  robustness: number;
}

export interface SkillProposal {
  proposal_id: string;
  base_skill: string;
  action: "create" | "patch" | "delete";
  created_at: string;
  diff_summary: string;
  scores: ProposalScore | null;
  status: "pending";
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-subtle">
      <span className="w-12 shrink-0 text-text-faint">{label}</span>
      <div className="h-1 flex-1 rounded-full bg-surface-card-strong overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right tabular-nums text-text-faint">{pct}%</span>
    </div>
  );
}

function ActionBadge({ action }: { action: SkillProposal["action"] }) {
  const styles: Record<SkillProposal["action"], string> = {
    create: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    patch:  "bg-blue-500/10  text-blue-400  border-blue-500/20",
    delete: "bg-red-500/10   text-red-400   border-red-500/20",
  };
  const labels: Record<SkillProposal["action"], string> = {
    create: "新建",
    patch:  "修改",
    delete: "删除",
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${styles[action]}`}>
      {labels[action]}
    </span>
  );
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  } catch {
    return iso?.slice(0, 16) ?? "";
  }
}

export function PendingProposalsList({
  onCountChange,
  hideWhenEmpty = false,
}: {
  onCountChange?: (count: number) => void;
  hideWhenEmpty?: boolean;
}) {
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [proposals, setProposals] = useState<SkillProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<Record<string, "approved" | "rejected">>({});

  const load = useCallback(async () => {
    const base = apiBase.replace(/\/$/, "");
    if (!base) return;
    setLoading(true);
    setErr("");
    try {
      const headers: Record<string, string> = {};
      if (apiToken) headers["X-AGX-Desktop-Token"] = apiToken;
      const resp = await fetch(`${base}/api/skills/proposals`, { headers });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setErr(data.error ?? "加载待审 skill 失败");
        setProposals([]);
        onCountChange?.(0);
        return;
      }
      const list = (data.proposals ?? []) as SkillProposal[];
      setProposals(list);
      onCountChange?.(list.length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
      setProposals([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiToken, onCountChange]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, kind: "approve" | "reject") => {
    const base = apiBase.replace(/\/$/, "");
    if (!base) return;
    setBusyId(id);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiToken) headers["X-AGX-Desktop-Token"] = apiToken;
      const resp = await fetch(`${base}/api/skills/proposals/${id}/${kind}`, {
        method: "POST",
        headers,
        body: kind === "reject" ? JSON.stringify({ reason: "用户拒绝" }) : undefined,
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setErr(data.error ?? `${kind} 失败`);
        return;
      }
      setJustDone((prev) => ({ ...prev, [id]: kind === "approve" ? "approved" : "rejected" }));
      setTimeout(() => {
        void load();
        setJustDone((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  if (!apiBase.trim()) return null;
  if (!loading && proposals.length === 0 && !err) {
    if (hideWhenEmpty) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2.5 text-[11px] text-text-faint">
        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        暂无待审 skill 变更
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {err ? (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          {err}
        </div>
      ) : null}
      {loading && proposals.length === 0 ? (
        <div className="flex items-center gap-2 py-2 text-[11px] text-text-faint">
          <Clock className="h-3.5 w-3.5 shrink-0 animate-spin" />
          加载中…
        </div>
      ) : null}
      {proposals.map((p) => {
        const done = justDone[p.proposal_id];
        const isBusy = busyId === p.proposal_id;
        return (
          <div
            key={p.proposal_id}
            className={`rounded-xl border bg-surface-card transition-all ${
              done === "approved"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : done === "rejected"
                  ? "border-red-500/30 bg-red-500/5 opacity-60"
                  : "border-border"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <ActionBadge action={p.action} />
                <span className="truncate text-sm font-semibold text-text-strong">
                  {p.base_skill}
                </span>
              </div>
              <span className="shrink-0 text-[10px] text-text-faint">{relativeTime(p.created_at)}</span>
            </div>

            {/* Diff summary */}
            {p.diff_summary ? (
              <p className="mx-3.5 mb-2 line-clamp-2 text-[11px] leading-relaxed text-text-subtle">
                {p.diff_summary}
              </p>
            ) : null}

            {/* Scores */}
            {p.scores ? (
              <div className="mx-3.5 mb-2 space-y-1 rounded-md bg-surface-panel px-2.5 py-2">
                <ScoreBar label="准确" value={p.scores.accuracy} />
                <ScoreBar label="简洁" value={p.scores.brevity} />
                <ScoreBar label="稳健" value={p.scores.robustness} />
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex items-center gap-2 border-t border-border px-3.5 py-2.5">
              {done ? (
                <span className={`flex items-center gap-1 text-[11px] ${done === "approved" ? "text-emerald-500" : "text-text-faint"}`}>
                  {done === "approved" ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {done === "approved" ? "已批准" : "已拒绝"}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex h-7 items-center rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
                    onClick={() => void act(p.proposal_id, "approve")}
                  >
                    {isBusy ? "处理中…" : "批准"}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex h-7 items-center rounded-md border border-border px-3 text-[11px] text-text-subtle transition hover:border-border-strong hover:text-text-primary disabled:opacity-40"
                    onClick={() => void act(p.proposal_id, "reject")}
                  >
                    拒绝
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
