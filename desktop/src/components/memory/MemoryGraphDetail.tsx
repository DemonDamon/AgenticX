import { useTranslation } from "react-i18next";
import type { GraphEdgeDTO, GraphNodeDTO } from "./memory-graph-types";

type Props = {
  node: GraphNodeDTO | null;
  edges: GraphEdgeDTO[];
  onDeleteEpisode?: (episodeId: string) => void;
};

export function MemoryGraphDetail({ node, edges, onDeleteEpisode }: Props) {
  const { t } = useTranslation("settings");
  if (!node) {
    return (
      <div className="rounded-lg border border-border bg-surface-card p-3 text-xs text-text-faint">
        {t("memoryGraph.clickNode")}
      </div>
    );
  }

  const related = edges.filter((e) => e.source === node.id || e.target === node.id);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-card p-3 text-xs text-text-subtle">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-text-strong">{node.label}</div>
        <span className="rounded bg-surface-card-strong px-1.5 py-0.5 text-[10px] uppercase text-text-faint">
          {node.kind}
        </span>
      </div>
      {node.summary ? <p className="whitespace-pre-wrap leading-relaxed">{node.summary}</p> : null}
      {(node.validAt || node.invalidAt) && (
        <div className="text-[10px] text-text-faint">
          {node.validAt ? t("memoryGraph.validAt", { time: node.validAt }) : null}
          {node.invalidAt ? t("memoryGraph.invalidAt", { time: node.invalidAt }) : null}
        </div>
      )}
      {related.length > 0 ? (
        <div className="space-y-1 border-t border-[var(--border-muted)] pt-2">
          <div className="text-[10px] font-medium text-text-faint">{t("memoryGraph.related")}</div>
          {related.slice(0, 6).map((e) => (
            <div key={e.id} className={e.status === "invalidated" ? "text-text-faint line-through" : ""}>
              {e.label}
            </div>
          ))}
        </div>
      ) : null}
      {node.kind === "episode" && onDeleteEpisode ? (
        <button
          type="button"
          className="mt-2 rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10"
          onClick={() => onDeleteEpisode(node.id)}
        >
          {t("memoryGraph.deleteEpisode")}
        </button>
      ) : null}
    </div>
  );
}
