import type { ConfirmStrategy } from "../store";

export type ConfirmStrategyOption = {
  value: ConfirmStrategy;
  label: string;
  description: string;
};

export type ConfirmPolicy = "ask-every-time" | "use-allowlist" | "run-everything";

export type ConfirmPolicyOption = {
  value: ConfirmPolicy;
  label: string;
  description: string;
};

/** Shared labels for every Desktop confirmation-strategy selector. */
export const CONFIRM_STRATEGY_OPTIONS: readonly ConfirmStrategyOption[] = [
  {
    value: "manual",
    label: "每次询问",
    description: "遇到需要授权的操作时，每次都由你确认",
  },
  {
    value: "semi-auto",
    label: "同类操作自动允许",
    description: "你确认一次后，仅本次运行中的同类操作不再询问",
  },
  {
    value: "auto",
    label: "全部自动执行",
    description: "不再逐次询问；工作区和受保护路径仍受限制，其他高风险操作可能直接运行",
  },
] as const;

/** Labels used inside a single confirmation dialog. */
export const CONFIRM_POLICY_OPTIONS: readonly ConfirmPolicyOption[] = [
  {
    value: "ask-every-time",
    label: "仅允许这一次",
    description: "只执行上方这次操作；下次遇到需要授权的操作仍会询问。",
  },
  {
    value: "use-allowlist",
    label: "本次运行允许同类操作",
    description: "当前任务运行结束前，与本次类型和范围相同的操作将自动允许。",
  },
  {
    value: "run-everything",
    label: "全部自动执行",
    description: "以后不再逐次询问；工作区和受保护路径仍受限制，其他高风险操作可能直接运行。",
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
