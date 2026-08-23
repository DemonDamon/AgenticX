import { describe, expect, it } from "vitest";
import {
  containsToolCallMarkup,
  isMostlyToolCallLeak,
  stripLeakedToolCallMarkup,
} from "../tool-call-leak";

const SESSION_LEAK =
  "我来帮您搜索关于王虹的最新新闻。\n" +
  `<minimax:tool_call>\n<invoke name="web_search">\n` +
  `<parameter name="query">王虹 新闻 2026年8月</parameter>\n` +
  `<parameter name="max_results">10</parameter>\n` +
  `</invoke>\n</minimax:tool_call>`;

describe("tool-call leak helpers", () => {
  it("detects and strips MiniMax vendor tool XML", () => {
    expect(containsToolCallMarkup(SESSION_LEAK)).toBe(true);
    expect(stripLeakedToolCallMarkup(SESSION_LEAK)).toBe("我来帮您搜索关于王虹的最新新闻。");
    expect(isMostlyToolCallLeak(SESSION_LEAK)).toBe(true);
  });

  it("treats a grounded answer plus leftover XML as markup but not a full leak", () => {
    const mixed =
      "王虹是数学家，2026 年获得菲尔兹奖，并因攻克三维挂谷猜想受到关注。[1]\n" +
      `<minimax:tool_call><invoke name="web_search"></invoke></minimax:tool_call>`;
    expect(containsToolCallMarkup(mixed)).toBe(true);
    expect(isMostlyToolCallLeak(mixed)).toBe(false);
    expect(stripLeakedToolCallMarkup(mixed)).toBe(
      "王虹是数学家，2026 年获得菲尔兹奖，并因攻克三维挂谷猜想受到关注。[1]",
    );
  });

  it("does not flag ordinary assistant prose", () => {
    expect(containsToolCallMarkup("根据检索，王虹近期的新闻主要是菲尔兹奖。")).toBe(false);
    expect(isMostlyToolCallLeak("根据检索，王虹近期的新闻主要是菲尔兹奖。")).toBe(false);
  });

  it("still treats a think-then-search-preamble leak as a full leak", () => {
    const thinkOpen = "<" + "think" + ">";
    const thinkClose = "<" + "/" + "think" + ">";
    const raw =
      `${thinkOpen}需要联网搜索${thinkClose}\n\n我来帮您搜索关于王虹的最新新闻。\n` + SESSION_LEAK.slice(
        SESSION_LEAK.indexOf("<minimax:tool_call>"),
      );
    expect(isMostlyToolCallLeak(raw)).toBe(true);
  });
});
