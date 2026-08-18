import type { ConfirmStrategy } from "../store";

export type ConfirmStrategyOption = {
  value: ConfirmStrategy;
  label: string;
  description: string;
};

export type ConfirmPolicy = "ask-every-time" | "use-allowlist" | "run-everything";

/** Shared labels for every Desktop confirmation-strategy selector. */
export const CONFIRM_STRATEGY_OPTIONS: readonly ConfirmStrategyOption[] = [
  {
    value: "manual",
    label: "每次询问",
    description: "每次执行工具前都由你确认",
  },
  {
    value: "semi-auto",
    label: "白名单放行",
    description: "确认一次后，本次运行不再询问同类操作",
  },
  {
    value: "auto",
    label: "全部自动执行",
    description: "所有工具直接执行；工作区边界仍然有效",
  },
] as const;

export function confirmStrategyLabel(strategy: ConfirmStrategy): string {
  return (
    CONFIRM_STRATEGY_OPTIONS.find((option) => option.value === strategy)?.label ??
    CONFIRM_STRATEGY_OPTIONS[0].label
  );
}

export function defaultConfirmPolicyForStrategy(
  strategy: ConfirmStrategy,
): ConfirmPolicy {
  if (strategy === "auto") return "run-everything";
  if (strategy === "semi-auto") return "use-allowlist";
  return "ask-every-time";
}
