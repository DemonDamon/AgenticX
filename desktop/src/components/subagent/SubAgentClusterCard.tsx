/**
 * Near 集群卡片（Sub-Plan C FR-1 / FR-6）—— 把一次派生的多个子智能体聚合为一张卡片：
 * 卡片头「Agent 集群 · N 个并行任务」+ 成员工牌列表，默认折叠为概览，可展开看完整工牌。
 *
 * 折叠语义与 `ToolCallCard` 一致（默认折叠、可展开）；成员可点击触发 `onOpenRun`（打开
 * Sub-Plan D 的右侧落盘 drawer）。数据源统一吃 `BadgeVM[]`，对 live / persisted 无感。
 */
import { useMemo, useState } from "react";
import { AgentBadge } from "./AgentBadge";
import { PixelProgress } from "./PixelProgress";
import { statusMeta } from "./badge-theme";
import type { BadgeVM } from "./badge-vm";

type Props = {
  members: BadgeVM[];
  title?: string;
  selectedRunId?: string | null;
  onOpenRun?: (runId: string) => void;
  /** 默认折叠；传 true 可初始展开。 */
  defaultExpanded?: boolean;
  className?: string;
};

function ClusterHeaderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 text-[var(--kb-citation-fg)]" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M5.5 5.2L7 10.4M10.5 5.2L9 10.4M6 4h4" />
    </svg>
  );
}

/** 折叠态概览：一行 mini 像素进度点阵，概括所有成员进度。 */
function ClusterOverviewStrip({ members }: { members: BadgeVM[] }) {
  return (
    <div className="flex flex-col gap-1">
      {members.map((m) => (
        <div key={m.runId} className="flex items-center gap-2">
          <span className="w-14 shrink-0 truncate text-[11px] text-text-muted" title={m.name}>
            {m.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-text-faint">{m.badgeSeq}</span>
          <div className="min-w-0 flex-1">
            <PixelProgress progress={m.progress} status={m.status} cells={14} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SubAgentClusterCard({
  members,
  title,
  selectedRunId,
  onOpenRun,
  defaultExpanded = false,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const count = members.length;
  const runningCount = useMemo(
    () => members.filter((m) => m.status === "running" || m.status === "pending").length,
    [members],
  );
  const doneCount = useMemo(
    () => members.filter((m) => m.status === "completed").length,
    [members],
  );

  if (count === 0) return null;

  return (
    <div
      className={`overflow-hidden rounded-xl border border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_22%,transparent)] bg-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_5%,transparent)] ${className ?? ""}`}
    >
      {/* 卡片头 */}
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_16%,transparent)] px-3 py-2 text-left transition hover:bg-[rgba(var(--theme-color-rgb),0.06)]"
        onClick={() => setExpanded((v) => !v)}
      >
        <ClusterHeaderIcon />
        <span className="text-[12.5px] font-medium text-[var(--kb-citation-fg)]">
          {title?.trim() ? title : `Agent 集群 · ${count} 个并行任务`}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-text-faint">
          {runningCount > 0 ? <span className="text-[var(--kb-citation-fg)]">{runningCount} 执行中</span> : null}
          {doneCount > 0 ? <span className="text-[var(--status-success)]">{doneCount} 完成</span> : null}
          <svg viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </button>

      {/* 内容区 */}
      <div className="p-2.5">
        {expanded ? (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <AgentBadge
                key={m.runId}
                vm={m}
                selected={selectedRunId === m.runId}
                onClick={onOpenRun}
              />
            ))}
          </div>
        ) : (
          <ClusterOverviewStrip members={members} />
        )}
      </div>
    </div>
  );
}
