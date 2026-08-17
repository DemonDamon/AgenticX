"use client";

import * as React from "react";
import {
  fetchActiveDeepResearchRuns,
  phaseLabelZh,
  type ActiveDeepResearchRun,
} from "../../utils/deep-research-active-run";

export type DeepResearchRecoverBannerProps = {
  sessionId: string | null | undefined;
  /** Invoked when user clicks recover — parent should open the reconnect stream. */
  onRecover?: (run: ActiveDeepResearchRun) => void;
  /**
   * 当前会话里已经挂了工作台的 runId（含 live 流式）。
   * 这些 run 用户正在看，不需要「继续查看」横条。
   */
  visibleRunIds?: ReadonlySet<string> | readonly string[];
  /**
   * 当前会话仍在 streaming/sending：live SSE 就是事件唯一来源，
   * 横条此时只会叠床架屋（新开一场深研立刻出横条的根因）。
   */
  suppressWhileStreaming?: boolean;
};

function hasVisibleRun(
  runId: string,
  visibleRunIds: DeepResearchRecoverBannerProps["visibleRunIds"],
): boolean {
  if (!visibleRunIds) return false;
  const maybeSet = visibleRunIds as ReadonlySet<string>;
  if (typeof maybeSet.has === "function") return maybeSet.has(runId);
  return (visibleRunIds as readonly string[]).includes(runId);
}

/**
 * 仅在「会话有活跃 run，但当前页面看不到它」时展示恢复横条
 * （切走再切回 / 刷新后）。live 流式或工作台已在消息列表里时隐藏。
 */
export function DeepResearchRecoverBanner({
  sessionId,
  onRecover,
  visibleRunIds,
  suppressWhileStreaming = false,
}: DeepResearchRecoverBannerProps) {
  const [run, setRun] = React.useState<ActiveDeepResearchRun | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setRun(null);
      return;
    }
    const load = async () => {
      const runs = await fetchActiveDeepResearchRuns(sessionId);
      if (!cancelled) setRun(runs[0] ?? null);
    };
    void load();
    // 轮询复验：run 完成/被服务端清理后横幅必须消失，不能常驻到下一次切会话。
    const timer = setInterval(() => {
      void load();
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  if (!run) return null;
  // Defensive: healed / terminal runs must never show the recover banner.
  if (
    run.phase === "done" ||
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return null;
  }
  // 正在看这场 / live 流还在喂工作台 → 不打扰。
  if (suppressWhileStreaming) return null;
  if (hasVisibleRun(run.runId, visibleRunIds)) return null;

  const label = `深度调研进行中（${phaseLabelZh(run.phase)}）· 点击继续查看`;

  return (
    <button
      type="button"
      onClick={() => {
        onRecover?.(run);
      }}
      className="mb-3 flex w-full items-center justify-center rounded-md border border-[var(--ui-border-subtle,rgba(127,127,127,0.25))] bg-[var(--ui-surface-muted,rgba(127,127,127,0.08))] px-3 py-2 text-center text-sm text-[var(--ui-text-primary,inherit)] transition-colors hover:bg-[var(--ui-surface-hover,rgba(127,127,127,0.14))]"
      data-testid="deep-research-recover-banner"
    >
      {label}
    </button>
  );
}
