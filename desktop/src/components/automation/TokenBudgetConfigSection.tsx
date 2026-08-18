import type { ChangeEvent } from "react";

export const TOKEN_BUDGET_MIN_SESSION = 100_000;
export const TOKEN_BUDGET_MAX_SESSION = 5_000_000;
export const TOKEN_BUDGET_WARNING_SESSION = 500_000;
export const TOKEN_BUDGET_DEFAULT_SESSION = 1_000_000;
export const TOKEN_BUDGET_MIN_WARNING_SESSION = 50_000;
export const TOKEN_BUDGET_MIN_TURN = 50_000;
export const TOKEN_BUDGET_MAX_TURN = 1_000_000;
export const TOKEN_BUDGET_DEFAULT_TURN = 100_000;

export type TokenBudgetConfig = {
  max_tokens_per_session: number;
  max_tokens_per_turn: number;
};

type TokenBudgetConfigSectionProps = {
  value: TokenBudgetConfig;
  onChange: (value: TokenBudgetConfig) => void;
  disabled?: boolean;
};

export function normalizeSessionTokenLimit(raw: number): number {
  if (!Number.isFinite(raw)) return TOKEN_BUDGET_DEFAULT_SESSION;
  return Math.max(TOKEN_BUDGET_MIN_SESSION, Math.min(TOKEN_BUDGET_MAX_SESSION, Math.round(raw)));
}

export function normalizeSessionWarningTokenLimit(
  raw: number,
  hardLimit = TOKEN_BUDGET_DEFAULT_SESSION,
): number {
  const normalizedHard = normalizeSessionTokenLimit(hardLimit);
  if (!Number.isFinite(raw)) {
    return Math.min(TOKEN_BUDGET_WARNING_SESSION, normalizedHard - 1);
  }
  return Math.max(
    TOKEN_BUDGET_MIN_WARNING_SESSION,
    Math.min(normalizedHard - 1, Math.round(raw)),
  );
}

function clampTurn(raw: number): number {
  if (!Number.isFinite(raw)) return TOKEN_BUDGET_DEFAULT_TURN;
  return Math.max(TOKEN_BUDGET_MIN_TURN, Math.min(TOKEN_BUDGET_MAX_TURN, Math.round(raw)));
}

export function TokenBudgetConfigSection({ value, onChange, disabled }: TokenBudgetConfigSectionProps) {
  const handleSessionChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, max_tokens_per_session: normalizeSessionTokenLimit(Number(e.target.value)) });
  };
  const handleTurnChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, max_tokens_per_turn: clampTurn(Number(e.target.value)) });
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">Token 预算</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        会话累计值只用于分级提醒，不会中断任务或阻止后续对话；模型上下文接近窗口时仍会按既有机制整理。单轮上限继续控制一次模型请求可使用的 token。修改后请保存，后续对话轮次生效。
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-text-muted">
          会话红色提醒阈值
          <input
            type="number"
            min={TOKEN_BUDGET_MIN_SESSION}
            max={TOKEN_BUDGET_MAX_SESSION}
            step={50_000}
            value={value.max_tokens_per_session}
            onChange={handleSessionChange}
            disabled={disabled}
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary disabled:opacity-50"
          />
        </label>
        <label className="block text-xs text-text-muted">
          单轮上限
          <input
            type="number"
            min={TOKEN_BUDGET_MIN_TURN}
            max={TOKEN_BUDGET_MAX_TURN}
            step={10_000}
            value={value.max_tokens_per_turn}
            onChange={handleTurnChange}
            disabled={disabled}
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary disabled:opacity-50"
          />
        </label>
      </div>
    </div>
  );
}

export function normalizeTokenBudgetConfig(raw: Partial<TokenBudgetConfig> | undefined): TokenBudgetConfig {
  return {
    max_tokens_per_session: normalizeSessionTokenLimit(
      Number(raw?.max_tokens_per_session ?? TOKEN_BUDGET_DEFAULT_SESSION),
    ),
    max_tokens_per_turn: clampTurn(Number(raw?.max_tokens_per_turn ?? TOKEN_BUDGET_DEFAULT_TURN)),
  };
}
