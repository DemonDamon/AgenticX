import { describe, expect, it } from "vitest";

import { sessionTokensFromMessages } from "./session-tokens-from-messages";

describe("sessionTokensFromMessages", () => {
  it("is empty when no remaining assistant usage", () => {
    expect(
      sessionTokensFromMessages([{ id: "u1", role: "user", content: "retry first" }]),
    ).toEqual({
      input: 0,
      output: 0,
      cached: 0,
      lastInput: 0,
      lastCached: 0,
    });
  });

  it("sums surviving turns after an earlier-turn retry trim", () => {
    expect(
      sessionTokensFromMessages([
        { id: "u1", role: "user", content: "first" },
        {
          id: "a1",
          role: "assistant",
          content: "ans",
          usage: {
            inputTokens: 10_000,
            outputTokens: 50,
            cachedTokens: 4_000,
            reasoningTokens: 0,
            totalTokens: 10_050,
          },
        },
        { id: "u2", role: "user", content: "retry me" },
      ]),
    ).toEqual({
      input: 10_000,
      output: 50,
      cached: 4_000,
      lastInput: 10_000,
      lastCached: 4_000,
    });
  });
});
