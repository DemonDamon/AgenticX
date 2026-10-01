import { describe, expect, it } from "vitest";
import { shouldResetPagingAfterPollMerge } from "./session-poll-paging";

describe("shouldResetPagingAfterPollMerge", () => {
  it("does not reset when poll only grew the visible tail", () => {
    expect(
      shouldResetPagingAfterPollMerge({
        hadOlder: true,
        oldestLoadedIndex: 120,
        mergedLen: 42,
        previousLen: 40,
        grewTailOnly: true,
      })
    ).toBe(false);
  });

  it("does not reset when nothing changed under a paging window", () => {
    expect(
      shouldResetPagingAfterPollMerge({
        hadOlder: true,
        oldestLoadedIndex: 120,
        mergedLen: 40,
        previousLen: 40,
        grewTailOnly: false,
      })
    ).toBe(false);
  });

  it("allows reset for an authoritative full-history merge", () => {
    expect(
      shouldResetPagingAfterPollMerge({
        hadOlder: true,
        oldestLoadedIndex: 120,
        mergedLen: 160,
        previousLen: 40,
        grewTailOnly: false,
      })
    ).toBe(true);
  });

  it("does not reset when paging was already flat", () => {
    expect(
      shouldResetPagingAfterPollMerge({
        hadOlder: false,
        oldestLoadedIndex: 0,
        mergedLen: 50,
        previousLen: 40,
        grewTailOnly: false,
      })
    ).toBe(false);
  });
});
