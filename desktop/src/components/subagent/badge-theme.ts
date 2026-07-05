/**
 * Near 工牌视觉常量 —— 黑白高对比度极客风（玛奇 / NousResearch 神韵）。
 *
 * 所有色彩走主题 token（`--theme-color-rgb` / `--status-*`），此处只集中
 * 尺寸、像素格数、状态语义映射等纯常量，便于统一调整基调（Sub-Plan C NFR-1）。
 */
import type { SubAgentStatus } from "../../store";

/** 像素进度条默认格数（对齐图4 的方格质感）。 */
export const PIXEL_PROGRESS_CELLS = 20;

/** compact 工牌头像尺寸（集群卡片内一行）。 */
export const BADGE_COMPACT_AVATAR_PX = 28;

/** full 工牌头像尺寸（hover / 展开浮层）。 */
export const BADGE_FULL_AVATAR_PX = 44;

/** hover 浮出 full 工牌的延迟，对齐现有 `HoverTip` 语汇。 */
export const BADGE_HOVER_DELAY_MS = 280;

export type BadgeStatusTone = "theme" | "success" | "error" | "warning" | "muted";

/** 状态 → 语义色调 + 中文标签（与 `SubAgentStatusBadge` 语义对齐）。 */
export const STATUS_TONE: Record<string, { tone: BadgeStatusTone; label: string }> = {
  pending: { tone: "warning", label: "等待中" },
  awaiting_confirm: { tone: "warning", label: "待确认" },
  awaiting_input: { tone: "theme", label: "等待输入" },
  running: { tone: "theme", label: "执行中" },
  paused: { tone: "warning", label: "已暂停" },
  completed: { tone: "success", label: "已完成" },
  failed: { tone: "error", label: "失败" },
  cancelled: { tone: "muted", label: "已中断" },
};

export function statusMeta(status: string): { tone: BadgeStatusTone; label: string } {
  return STATUS_TONE[status] ?? STATUS_TONE.pending;
}

/** 语义色调 → CSS 变量（用于像素格 / 状态徽章）。 */
export const TONE_COLOR_VAR: Record<BadgeStatusTone, string> = {
  theme: "rgb(var(--theme-color-rgb))",
  success: "var(--status-success)",
  error: "var(--status-error)",
  warning: "var(--status-warning)",
  muted: "var(--text-muted)",
};

/** 终态状态集合（进度收敛为满格 / 停格）。 */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set<SubAgentStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
