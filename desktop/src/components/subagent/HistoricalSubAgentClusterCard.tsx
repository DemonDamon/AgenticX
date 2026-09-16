import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, SubAgent } from "../../store";
import { useAppStore } from "../../store";
import {
  fromLiveSubAgent,
  fromRunRecord,
  mergeBadgeVMs,
  type BadgeVM,
  type SubAgentCluster,
} from "./badge-vm";
import { SubAgentClusterCard } from "./SubAgentClusterCard";
import { fetchSubAgentClusters } from "./run-drawer-api";

type Props = {
  anchor: NonNullable<Message["subAgentCluster"]>;
  sessionId?: string;
  onOpenRun?: (runId: string) => void;
};

function orderByAnchorRunIds(items: BadgeVM[], runIds: string[]): BadgeVM[] {
  const order = new Map(runIds.map((runId, index) => [runId, index]));
  return [...items].sort((a, b) => {
    const ai = order.get(a.runId) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.runId) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.badgeSeq.localeCompare(b.badgeSeq);
  });
}

function liveMembersForAnchor(subAgents: SubAgent[], sessionId: string | undefined, runIds: string[]): BadgeVM[] {
  const sid = String(sessionId ?? "").trim();
  const runSet = new Set(runIds);
  return subAgents
    .filter((item) => runSet.has(item.id) && (!sid || String(item.sessionId ?? "").trim() === sid))
    .map((item, index) => fromLiveSubAgent(item, index));
}

function DegradedClusterCard({ title }: { title: string }) {
  const { t } = useTranslation("chat");
  return (
    <div className="rounded-xl border border-border bg-surface-card px-3 py-2.5 text-[12px] text-text-muted">
      <div className="font-medium text-text-strong">{title}</div>
      <div className="mt-1 text-[11px] text-text-faint">{t("subagent.historyClusterUnavailable")}</div>
    </div>
  );
}

export function HistoricalSubAgentClusterCard({ anchor, sessionId, onOpenRun }: Props) {
  const { t } = useTranslation("chat");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const subAgents = useAppStore((s) => s.subAgents);
  const [cluster, setCluster] = useState<SubAgentCluster | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sid = String(sessionId ?? "").trim();
    if (!apiBase || !apiToken || !sid || !anchor.clusterId) {
      setFailed(true);
      return;
    }
    setFailed(false);
    void (async () => {
      try {
        const res = await fetchSubAgentClusters(apiBase, apiToken, sid);
        if (cancelled) return;
        if (!res.ok || !Array.isArray(res.clusters)) {
          setFailed(true);
          return;
        }
        const next = res.clusters.find((item) => item.cluster_id === anchor.clusterId) ?? null;
        setCluster(next);
        if (!next) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiToken, sessionId, anchor.clusterId]);

  const members = useMemo(() => {
    const persisted = (cluster?.members ?? []).map((item, index) => fromRunRecord(item, index));
    const live = liveMembersForAnchor(subAgents, sessionId, anchor.runIds);
    return orderByAnchorRunIds(mergeBadgeVMs(persisted, live), anchor.runIds);
  }, [anchor.runIds, cluster, sessionId, subAgents]);

  const title = anchor.title || cluster?.title || t("subagent.swarmTitle", { count: anchor.runIds.length });
  if (members.length === 0) {
    return failed ? (
      <DegradedClusterCard title={title} />
    ) : (
      <div className="rounded-xl border border-border bg-surface-card px-3 py-2.5 text-[12px] text-text-faint">
        {t("subagent.restoringHistoryCluster")}
      </div>
    );
  }

  return (
    <SubAgentClusterCard
      members={members}
      title={title}
      onOpenRun={onOpenRun}
    />
  );
}
