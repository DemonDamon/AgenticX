/**
 * Near 蜂群卡片（Sub-Plan C FR-1 / FR-6）—— 把一次派生的多个子智能体聚合为一张卡片：
 * 卡片头「Agent 蜂群 · N 个并行任务」+ 成员行列表，始终完整展示（无折叠/展开切换，
 * 对齐 Kimi Work 的直出式呈现）。
 *
 * 成员行布局对齐 Kimi Work：左侧保留更多面积展示名称 + 任务摘要（截取式），右侧为
 * 编号 + 粒子矩阵进度条（`PixelProgress` 的 `dots` 态）。数据源统一吃 `BadgeVM[]`，
 * 对 live / persisted 无感。成员可点击触发 `onOpenRun`（打开 Sub-Plan D 的右侧落盘 drawer）。
 */
import { useMemo } from "react";
import { PixelProgress } from "./PixelProgress";
import type { BadgeVM } from "./badge-vm";

type Props = {
  members: BadgeVM[];
  title?: string;
  selectedRunId?: string | null;
  onOpenRun?: (runId: string) => void;
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

/** 粒子矩阵固定槽宽（6 列 × 4px + 间距），右侧永远预留，窄屏也不被文字挤没。 */
const DOT_MATRIX_SLOT_PX = 40;

/** 成员行摘要文案：任务描述优先，回落结果摘要，再回落角色。 */
function excerptFor(vm: BadgeVM): string {
  return (vm.task || vm.resultSummary || vm.role || "").trim();
}

function ClusterMemberRow({
  vm,
  selected,
  onClick,
}: {
  vm: BadgeVM;
  selected?: boolean;
  onClick?: (runId: string) => void;
}) {
  const excerpt = excerptFor(vm);
  return (
    <button
      type="button"
      className={`flex w-full min-w-0 overflow-hidden rounded-lg px-2 py-1.5 text-left transition ${
        selected ? "bg-[rgba(var(--theme-color-rgb),0.08)]" : "hover:bg-surface-hover"
      }`}
      onClick={() => onClick?.(vm.runId)}
    >
      {/* 左侧摘要区：占满剩余宽度，超长单行截断 */}
      <div className="min-w-0 flex-1 overflow-hidden pr-2">
        <div className="truncate text-[12.5px] font-medium text-text-strong" title={vm.name}>
          {vm.name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-text-muted" title={excerpt || undefined}>
          {excerpt || "—"}
        </div>
      </div>
      {/* 右侧固定槽：编号 + 点阵矩阵，不参与 flex 收缩 */}
      <div
        className="flex shrink-0 flex-col items-end justify-center gap-1 self-stretch py-0.5"
        style={{ width: DOT_MATRIX_SLOT_PX, minWidth: DOT_MATRIX_SLOT_PX }}
      >
        <span className="font-mono text-[10px] leading-none text-text-faint">{vm.badgeSeq}</span>
        <PixelProgress progress={vm.progress} status={vm.status} variant="dots" cells={12} />
      </div>
    </button>
  );
}

export function SubAgentClusterCard({
  members,
  title,
  selectedRunId,
  onOpenRun,
  className,
}: Props) {
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
      {/* 卡片头 —— 纯信息展示，不再可点击折叠。 */}
      <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,rgb(var(--theme-color-rgb))_16%,transparent)] px-3 py-2">
        <ClusterHeaderIcon />
        <span className="text-[12.5px] font-medium text-[var(--kb-citation-fg)]">
          {title?.trim() ? title : `Agent 蜂群 · ${count} 个并行任务`}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-text-faint">
          {runningCount > 0 ? <span className="text-[var(--kb-citation-fg)]">{runningCount} 执行中</span> : null}
          {doneCount > 0 ? <span className="text-[var(--status-success)]">{doneCount} 完成</span> : null}
        </span>
      </div>

      {/* 内容区 —— 始终完整展示成员行。 */}
      <div className="flex min-w-0 flex-col gap-0.5 p-1.5">
        {members.map((m) => (
          <ClusterMemberRow
            key={m.runId}
            vm={m}
            selected={selectedRunId === m.runId}
            onClick={onOpenRun}
          />
        ))}
      </div>
    </div>
  );
}
