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

/**
 * Shared labels for every Desktop confirmation-strategy selector.
 *
 * ``auto`` 原来叫「低风险自动执行」，配琥珀色 TriangleAlert。但这个模式是 fail-closed
 * 的：只有显式带 ``risk: "low"`` 的操作会被自动批准，缺省、未知、以及 high /
 * destructive / non_whitelisted / permission_escalation / policy 一律仍然逐次询问
 * （见 utils/confirm-scope.ts 的 normalizeConfirmRisk）。工作区边界、受保护路径、
 * 管理员禁用的工具也照常拦。
 *
 * 也就是说告警式的措辞和配色高估了它。改成 Codex 那种「Approve for me」的说法——
 * 讲的是助手替你做了什么，而不是你在冒什么险；限定条件放进 description，信息一点没少。
 */
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
    label: "代我批准",
    description: "低风险操作由我代你批准；高风险及其他受保护操作仍会问你",
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
    label: "以后代我批准",
    description: "以后低风险操作由我代你批准；高风险及其他受保护操作仍会问你。",
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
