import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import { useAppStore } from "../../../store";
import { studioFetch } from "../../../utils/studio-fetch";
import { i18n } from "../../../i18n/i18n";

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
  author_session_id?: string;
  author_model?: string;
}

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...opts }));
}

function humanizeProposalError(raw: string, kind: "approve" | "reject"): string {
  if (raw === "skill already exists") return st("skillsPending.exists");
  if (raw.startsWith("blocked:")) return st("skillsPending.blocked");
  return raw || (kind === "approve" ? st("skillsPending.approveFailed") : st("skillsPending.rejectFailed"));
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
    create: st("skillsPending.actCreate"),
    patch: st("skillsPending.actPatch"),
    delete: st("skillsPending.actDelete"),
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
    if (diff < 60) return st("skillsPending.justNow");
    if (diff < 3600) return st("skillsPending.minutesAgo", { n: Math.floor(diff / 60) });
    if (diff < 86400) return st("skillsPending.hoursAgo", { n: Math.floor(diff / 3600) });
    return st("skillsPending.daysAgo", { n: Math.floor(diff / 86400) });
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
  const { t } = useTranslation("settings");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [proposals, setProposals] = useState<SkillProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<Record<string, "approved" | "rejected">>({});
  const [cardErr, setCardErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const headers: Record<string, string> = {};
      if (apiToken) headers["X-AGX-Desktop-Token"] = apiToken;
      const resp = await studioFetch("/api/skills/proposals", { headers, storeBase: apiBase });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setErr(data.error ?? t("skillsPending.loadFailed"));
        setProposals([]);
        onCountChange?.(0);
        return;
      }
      const list = (data.proposals ?? []) as SkillProposal[];
      setProposals(list);
      onCountChange?.(list.length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("skillsPending.loadFailedShort"));
      setProposals([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiToken, onCountChange, t]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, kind: "approve" | "reject") => {
    setBusyId(id);
    setCardErr((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiToken) headers["X-AGX-Desktop-Token"] = apiToken;
      const resp = await studioFetch(`/api/skills/proposals/${id}/${kind}`, {
        method: "POST",
        headers,
        body: kind === "reject" ? JSON.stringify({ reason: t("skillsPending.userReject") }) : undefined,
        storeBase: apiBase,
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setCardErr((prev) => ({
          ...prev,
          [id]: humanizeProposalError(String(data.error ?? ""), kind),
        }));
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
      setErr(e instanceof Error ? e.message : t("skillsPending.opFailed"));
    } finally {
      setBusyId(null);
    }
  };

  if (!loading && proposals.length === 0 && !err) {
    if (hideWhenEmpty) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-card px-3 py-2.5 text-[11px] text-text-faint">
        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        {t("skillsPending.empty")}
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
          {t("skillsPending.loading")}
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
            {p.author_session_id || p.author_model ? (
              <p className="mx-3.5 mb-2 text-[10px] text-text-faint" title={p.author_session_id || undefined}>
                {p.author_session_id
                  ? t("skillsPending.fromSession", {
                      id: p.author_session_id.length > 12 ? `${p.author_session_id.slice(0, 8)}…` : p.author_session_id,
                    })
                  : t("skillsPending.noSession")}
                {p.author_model ? ` · ${p.author_model}` : ""}
              </p>
            ) : null}

            {/* Diff summary */}
            {p.diff_summary ? (
              <p className="mx-3.5 mb-2 line-clamp-2 text-[11px] leading-relaxed text-text-subtle">
                {p.diff_summary}
              </p>
            ) : null}

            {/* Scores */}
            {p.scores ? (
              <div className="mx-3.5 mb-2 space-y-1 rounded-md bg-surface-panel px-2.5 py-2">
                <ScoreBar label={t("skillsPending.scoreAccuracy")} value={p.scores.accuracy} />
                <ScoreBar label={t("skillsPending.scoreBrevity")} value={p.scores.brevity} />
                <ScoreBar label={t("skillsPending.scoreRobust")} value={p.scores.robustness} />
              </div>
            ) : null}

            {cardErr[p.proposal_id] ? (
              <div className="mx-3.5 mb-2 whitespace-pre-wrap rounded-md bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-400">
                {cardErr[p.proposal_id]}
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex items-center gap-2 border-t border-border px-3.5 py-2.5">
              {done ? (
                <span className={`flex items-center gap-1 text-[11px] ${done === "approved" ? "text-emerald-500" : "text-text-faint"}`}>
                  {done === "approved" ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {done === "approved" ? t("skillsPending.approved") : t("skillsPending.rejected")}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex h-7 items-center rounded-md bg-[var(--ui-btn-primary-bg)] px-3 text-[11px] font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover)] disabled:opacity-40"
                    onClick={() => void act(p.proposal_id, "approve")}
                  >
                    {isBusy ? t("skillsPending.processing") : t("skillsPending.approve")}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex h-7 items-center rounded-md bg-red-600 px-3 text-[11px] font-medium text-white transition hover:bg-red-500 disabled:opacity-40"
                    onClick={() => void act(p.proposal_id, "reject")}
                  >
                    {t("skillsPending.reject")}
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
