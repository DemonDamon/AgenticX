import { describe, expect, it } from "vitest";
import { classifyWebSearchNeed, shouldSkipWebSearch } from "../search-necessity";

describe("classifyWebSearchNeed", () => {
  it("skips greetings / thanks / confirmations (AC-1)", () => {
    const cases: Array<[string, "greeting"]> = [
      ["你好", "greeting"],
      ["你好呀", "greeting"],
      ["hi", "greeting"],
      ["Hello!", "greeting"],
      ["在吗？", "greeting"],
      ["谢谢", "greeting"],
      ["ok", "greeting"],
      ["嗯嗯", "greeting"],
      ["晚安", "greeting"],
    ];
    for (const [query, reason] of cases) {
      expect(classifyWebSearchNeed({ query }), query).toEqual({ need: "skip", reason });
    }
  });

  it("skips assistant meta questions (AC-1)", () => {
    for (const query of ["你是谁", "你能做什么", "你是什么模型", "现在有联网功能吗", "你能联网搜索吗"]) {
      expect(classifyWebSearchNeed({ query }), query).toEqual({
        need: "skip",
        reason: "assistant_meta",
      });
    }
  });

  it("skips pure datetime questions (AC-1)", () => {
    for (const query of ["今天几号啊", "现在几点"]) {
      expect(classifyWebSearchNeed({ query }), query).toEqual({
        need: "skip",
        reason: "datetime",
      });
    }
  });

  it("skips pure arithmetic (AC-1)", () => {
    for (const query of ["1+1=?", "(3+4)*2"]) {
      expect(classifyWebSearchNeed({ query }), query).toEqual({
        need: "skip",
        reason: "arithmetic",
      });
    }
  });

  it("skips attachment-only turns (AC-2)", () => {
    expect(
      classifyWebSearchNeed({
        query: "2026年度预算.xlsx",
        rawQuery: "--- 附件: 2026年度预算.xlsx ---\n<table text>",
      }),
    ).toEqual({ need: "skip", reason: "attachment_only" });

    expect(
      classifyWebSearchNeed({
        query: "总结一下",
        rawQuery: "总结一下\n--- 附件: a.pdf ---\nlong body",
      }),
    ).toEqual({ need: "skip", reason: "attachment_only" });
  });

  it("does not skip informational queries (AC-3)", () => {
    const mustSearch = [
      "你好，帮我查一下今天的黄金价格",
      "Hello, what's the latest GPT release?",
      "谢谢，再帮我搜一下他们的官网",
      "你是谁写的这篇论文的作者",
      "苹果最新财报",
      "今天天气怎么样",
      "2026 年 AI 大事件",
    ];
    for (const query of mustSearch) {
      expect(classifyWebSearchNeed({ query }), query).toEqual({ need: "search" });
    }

    expect(
      classifyWebSearchNeed({
        query: "结合这个文件，再帮我搜一下最新的行业政策",
        rawQuery:
          "结合这个文件，再帮我搜一下最新的行业政策\n--- 附件: a.pdf ---\nbody",
      }),
    ).toEqual({ need: "search" });
  });

  it("skips ordinary self-contained work even when it is long", () => {
    const long = `${"请帮我整理这段材料并写成一封正式邮件。".repeat(12)}`;
    expect(long.length).toBeGreaterThan(200);
    expect(classifyWebSearchNeed({ query: long })).toEqual({
      need: "skip",
      reason: "self_contained",
    });
  });

  it("skips an empty query without attachment", () => {
    expect(classifyWebSearchNeed({ query: "" })).toEqual({
      need: "skip",
      reason: "self_contained",
    });
  });

  it("skips ordinary writing and explanation requests", () => {
    for (const query of ["帮我写一封请假邮件", "解释一下递归", "把这段话翻译成英文"]) {
      expect(classifyWebSearchNeed({ query }), query).toEqual({
        need: "skip",
        reason: "self_contained",
      });
    }
  });

  it("shouldSkipWebSearch mirrors classify", () => {
    expect(shouldSkipWebSearch({ query: "你好" })).toBe(true);
    expect(shouldSkipWebSearch({ query: "最新的 AI 新闻" })).toBe(false);
  });
});
