import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TOKEN_BUDGET_DEFAULT_SESSION,
  TOKEN_BUDGET_MAX_SESSION,
  TOKEN_BUDGET_WARNING_SESSION,
  normalizeSessionTokenLimit,
} from "../automation/TokenBudgetConfigSection";
import {
  DEVELOPER_TOKEN_BUDGET_MIN_SESSION,
  DeveloperTokenBudgetPanel,
  normalizeDeveloperSessionTokenLimit,
} from "./DeveloperTokenBudgetPanel";

describe("DeveloperTokenBudgetPanel", () => {
  it("renders the fixed warning threshold and the one-million default without a per-turn control", () => {
    const html = renderToStaticMarkup(<DeveloperTokenBudgetPanel />);

    expect(html).toContain("会话资源限制");
    expect(html).toContain("500,000");
    expect(html).toContain("1,000,000");
    expect(html).toContain("单对话 token 上限");
    expect(html).not.toContain("单轮上限");
  });

  it("normalizes invalid and out-of-range session limits", () => {
    expect(normalizeSessionTokenLimit(Number.NaN)).toBe(TOKEN_BUDGET_DEFAULT_SESSION);
    expect(DEVELOPER_TOKEN_BUDGET_MIN_SESSION).toBe(TOKEN_BUDGET_WARNING_SESSION);
    expect(normalizeDeveloperSessionTokenLimit(1)).toBe(DEVELOPER_TOKEN_BUDGET_MIN_SESSION);
    expect(normalizeSessionTokenLimit(9_000_000)).toBe(TOKEN_BUDGET_MAX_SESSION);
    expect(normalizeSessionTokenLimit(1_234_567.8)).toBe(1_234_568);
  });
});
