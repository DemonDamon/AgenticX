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

  it("prefers the turn bill when the footer stores last-request usage", () => {
    expect(
      sessionTokensFromMessages([
        {
          id: "a1",
          role: "assistant",
          content: "ans",
          usage: {
            inputTokens: 27111,
            outputTokens: 345,
            cachedTokens: 26112,
            reasoningTokens: 0,
            totalTokens: 27456,
            turnInputTokens: 78821,
            turnOutputTokens: 666,
            turnCachedTokens: 62848,
          },
        },
      ]),
    ).toEqual({
      input: 78821,
      output: 666,
      cached: 62848,
      lastInput: 78821,
      lastCached: 62848,
    });
  });
});
