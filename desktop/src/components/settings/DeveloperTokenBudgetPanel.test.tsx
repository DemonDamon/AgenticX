import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TOKEN_BUDGET_DEFAULT_SESSION,
  TOKEN_BUDGET_MAX_SESSION,
  TOKEN_BUDGET_MIN_WARNING_SESSION,
  TOKEN_BUDGET_WARNING_SESSION,
  normalizeSessionTokenLimit,
} from "../automation/TokenBudgetConfigSection";
import {
  DEVELOPER_TOKEN_BUDGET_MIN_SESSION,
  DeveloperTokenBudgetPanel,
  normalizeLoadedDeveloperTokenBudget,
  validateDeveloperTokenBudget,
} from "./DeveloperTokenBudgetPanel";

describe("DeveloperTokenBudgetPanel", () => {
  it("renders separate yellow and red alert fields with the intended defaults", () => {
    const html = renderToStaticMarkup(<DeveloperTokenBudgetPanel />);

    expect(html).toContain("会话 Token 两级提醒");
    expect(html).toContain("500,000");
    expect(html).toContain("1,000,000");
    expect(html).toContain("黄色提醒阈值");
    expect(html).toContain("红色提醒阈值");
    expect(html).toContain('aria-label="会话 Token 黄色提醒阈值"');
    expect(html).toContain('value="500000"');
    expect(html).toContain('aria-label="会话 Token 红色提醒阈值"');
    expect(html).toContain('value="1000000"');
    expect(html).toContain("两级提醒都不会中断任务或阻止后续对话");
    expect(html).not.toContain("单轮上限");
  });

  it("normalizes invalid and out-of-range shared session limits", () => {
    expect(normalizeSessionTokenLimit(Number.NaN)).toBe(TOKEN_BUDGET_DEFAULT_SESSION);
    expect(DEVELOPER_TOKEN_BUDGET_MIN_SESSION).toBe(100_000);
    expect(normalizeSessionTokenLimit(9_000_000)).toBe(TOKEN_BUDGET_MAX_SESSION);
    expect(normalizeSessionTokenLimit(1_234_567.8)).toBe(1_234_568);
  });

  it("preserves an explicitly configured 500k local red alert", () => {
    expect(normalizeLoadedDeveloperTokenBudget({ max_tokens_per_session: 500_000 })).toEqual({
      yellow: 499_999,
      red: 500_000,
    });
    expect(normalizeLoadedDeveloperTokenBudget({
      warning_tokens_per_session: 250_000,
      max_tokens_per_session: 500_000,
    })).toEqual({ yellow: 250_000, red: 500_000 });
    expect(normalizeLoadedDeveloperTokenBudget({
      warning_tokens_per_session: null,
      max_tokens_per_session: 500_000,
    })).toEqual({ yellow: 499_999, red: 500_000 });
    expect(normalizeLoadedDeveloperTokenBudget({
      warning_tokens_per_session: "invalid",
      max_tokens_per_session: 500_000,
    })).toEqual({ yellow: 499_999, red: 500_000 });
  });

  it("shows and accepts the runtime-supported 100k local red alert", () => {
    const loaded = normalizeLoadedDeveloperTokenBudget({
      warning_tokens_per_session: 50_000,
      max_tokens_per_session: 100_000,
    });

    expect(loaded).toEqual({ yellow: 50_000, red: 100_000 });
    expect(validateDeveloperTokenBudget(loaded)).toBe("");
  });

  it("rejects invalid ranges and yellow thresholds at or above the red threshold", () => {
    expect(validateDeveloperTokenBudget({ yellow: 500_000, red: 500_000 })).toBe(
      "黄色提醒阈值必须低于红色提醒阈值",
    );
    expect(validateDeveloperTokenBudget({
      yellow: TOKEN_BUDGET_MIN_WARNING_SESSION - 1,
      red: 1_000_000,
    })).toContain("黄色提醒阈值须在");
    expect(validateDeveloperTokenBudget({ yellow: 500_000, red: 99_999 })).toContain(
      "红色提醒阈值须在",
    );
    expect(validateDeveloperTokenBudget({ yellow: 500_000, red: 5_000_001 })).toContain(
      "红色提醒阈值须在",
    );
    expect(validateDeveloperTokenBudget({ yellow: 500_000, red: 1_000_000 })).toBe("");
  });
});
