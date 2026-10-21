import { afterEach, describe, expect, it, vi } from "vitest";
import { withLocalThinkingBudget } from "./local-thinking-budget";

const local = { id: "local/qwen3.8", route: "local" };
afterEach(() => vi.unstubAllEnvs());

describe("local thinking budget", () => {
  it("bounds local reasoning without reducing the total output cap", () => {
    const body = { max_tokens: 32768 };
    expect(withLocalThinkingBudget(body, local)).toEqual({ max_tokens: 32768, thinking_token_budget: 2048 });
    expect(body).toEqual({ max_tokens: 32768 });
  });

  it("leaves half of a small caller cap for the answer and preserves explicit zero", () => {
    expect(withLocalThinkingBudget({ max_tokens: 1024 }, local).thinking_token_budget).toBe(512);
    expect(withLocalThinkingBudget({ max_completion_tokens: 100, thinking_token_budget: 80 }, local).thinking_token_budget).toBe(50);
    expect(withLocalThinkingBudget({ thinking_token_budget: 0 }, local).thinking_token_budget).toBe(0);
  });

  it("supports a deployment budget override", () => {
    vi.stubEnv("AGENTICX_LOCAL_THINKING_TOKEN_BUDGET", "1024");
    expect(withLocalThinkingBudget({}, local).thinking_token_budget).toBe(1024);
  });

  it.each([
    [{}, { id: "hosted/qwen3.8", route: "third-party" }],
    [{}, { id: "local/other-model", route: "local" }],
    [{ chat_template_kwargs: { enable_thinking: false } }, local],
  ])("does not add a budget for other providers or disabled reasoning", (body, model) => {
    expect(withLocalThinkingBudget(body, model)).toBe(body);
  });
});
