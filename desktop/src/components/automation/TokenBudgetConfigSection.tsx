import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_CAP_ANCHOR_ID } from "../../settings-tab";

export const TOKEN_BUDGET_MIN_SESSION = 100_000;
export const TOKEN_BUDGET_MAX_SESSION = 5_000_000;
export const TOKEN_BUDGET_DEFAULT_SESSION = 500_000;
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
  /** Deep-link from budget exceeded card: scroll to session cap field. */
  scrollToSessionCap?: boolean;
  sessionCapHighlightKey?: number;
};

function clampSession(raw: number): number {
  if (!Number.isFinite(raw)) return TOKEN_BUDGET_DEFAULT_SESSION;
  return Math.max(TOKEN_BUDGET_MIN_SESSION, Math.min(TOKEN_BUDGET_MAX_SESSION, Math.round(raw)));
}

function clampTurn(raw: number): number {
  if (!Number.isFinite(raw)) return TOKEN_BUDGET_DEFAULT_TURN;
  return Math.max(TOKEN_BUDGET_MIN_TURN, Math.min(TOKEN_BUDGET_MAX_TURN, Math.round(raw)));
}

export function TokenBudgetConfigSection({
  value,
  onChange,
  disabled,
  scrollToSessionCap = false,
  sessionCapHighlightKey = 0,
}: TokenBudgetConfigSectionProps) {
  const { t } = useTranslation("workspace");
  const sessionCapAnchorRef = useRef<HTMLLabelElement>(null);
  const sessionCapInputRef = useRef<HTMLInputElement>(null);
  const [sessionCapHighlighted, setSessionCapHighlighted] = useState(false);

  const handleSessionChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, max_tokens_per_session: clampSession(Number(e.target.value)) });
  };
  const handleTurnChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, max_tokens_per_turn: clampTurn(Number(e.target.value)) });
  };

  useEffect(() => {
    if (!scrollToSessionCap || disabled) return;
    sessionCapAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSessionCapHighlighted(true);
    window.setTimeout(() => sessionCapInputRef.current?.focus(), 400);
    const timer = window.setTimeout(() => setSessionCapHighlighted(false), 2400);
    return () => window.clearTimeout(timer);
  }, [scrollToSessionCap, sessionCapHighlightKey, disabled]);

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">{t("automation.tokenBudget")}</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        {t("automation.tokenBudgetHint")}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label
          ref={sessionCapAnchorRef}
          id={SESSION_CAP_ANCHOR_ID}
          data-testid="token-budget-session-cap"
          className={`block scroll-mt-3 text-xs text-text-muted transition-[box-shadow] duration-500 ${
            sessionCapHighlighted ? "rounded-md shadow-[0_0_0_2px_var(--ui-btn-primary-bg)]" : ""
          }`}
        >
          {t("automation.sessionCap")}
          <input
            ref={sessionCapInputRef}
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
          {t("automation.turnCap")}
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
    max_tokens_per_session: clampSession(Number(raw?.max_tokens_per_session ?? TOKEN_BUDGET_DEFAULT_SESSION)),
    max_tokens_per_turn: clampTurn(Number(raw?.max_tokens_per_turn ?? TOKEN_BUDGET_DEFAULT_TURN)),
  };
}
