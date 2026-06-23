import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../../../store";

interface ProposalScore {
  accuracy: number;
  brevity: number;
  robustness: number;
}

export interface SkillProposal {
  proposal_id: string;
  base_skill: string;
  action: "create" | "patch";
  created_at: string;
  diff_summary: string;
  scores: ProposalScore | null;
  status: "pending";
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-subtle">
      <span className="w-16 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-surface-card-strong overflow-hidden">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums">{pct}%</span>
    </div>
  );
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

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
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
      <p className="text-[11px] text-text-faint py-1">暂无待审 skill 变更</p>
    );
  }

  return (
    <div className="space-y-2">
      {err ? <p className="text-[11px] text-red-400">{err}</p> : null}
      {loading && proposals.length === 0 ? (
        <p className="text-[11px] text-text-faint">加载中…</p>
      ) : null}
      {proposals.map((p) => (
        <div
          key={p.proposal_id}
          className="rounded-lg border border-border-subtle bg-surface-card p-3 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-strong">{p.base_skill}</span>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-surface-card-strong text-text-muted">
                  {p.action}
                </span>
              </div>
              {p.diff_summary ? (
                <p className="text-[11px] text-text-subtle mt-1 line-clamp-2">{p.diff_summary}</p>
              ) : null}
            </div>
            <span className="text-[10px] text-text-faint shrink-0">{p.created_at?.slice(0, 16)}</span>
          </div>
          {p.scores ? (
            <div className="space-y-1 pt-1">
              <ScoreBar label="准确" value={p.scores.accuracy} />
              <ScoreBar label="简洁" value={p.scores.brevity} />
              <ScoreBar label="稳健" value={p.scores.robustness} />
            </div>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busyId === p.proposal_id}
              className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-50"
              onClick={() => void act(p.proposal_id, "approve")}
            >
              批准
            </button>
            <button
              type="button"
              disabled={busyId === p.proposal_id}
              className="px-3 py-1 text-xs rounded-md border border-border-subtle text-text-muted disabled:opacity-50"
              onClick={() => void act(p.proposal_id, "reject")}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
