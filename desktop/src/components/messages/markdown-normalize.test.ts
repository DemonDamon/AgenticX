import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeChatMarkdownContent,
  normalizeLenientEmphasisInText,
} from "./markdown-normalize.ts";

test("normalizeLenientEmphasisInText: trims spaces inside ** delimiters", () => {
  assert.equal(normalizeLenientEmphasisInText("** Effort 校准**"), "**Effort 校准**");
  assert.equal(normalizeLenientEmphasisInText("**foo **"), "**foo**");
  assert.equal(normalizeLenientEmphasisInText("__ Effort__"), "__Effort__");
});

test("normalizeLenientEmphasisInText: removes stray asterisk after closed **", () => {
  assert.equal(
    normalizeLenientEmphasisInText("**0.50/百万输入tokens** *"),
    "**0.50/百万输入tokens**",
  );
  assert.equal(
    normalizeLenientEmphasisInText("**0.50/百万输入tokens** *输出"),
    "**0.50/百万输入tokens**输出",
  );
});

test("normalizeLenientEmphasisInText: collapses spaced ** ** delimiter typos", () => {
  assert.equal(
    normalizeLenientEmphasisInText("** **0.50/百万输入tokens** **"),
    "**0.50/百万输入tokens**",
  );
});

test("normalizeLenientEmphasisInText: converts full-width asterisks", () => {
  assert.equal(
    normalizeLenientEmphasisInText("＊＊0.50/百万输入tokens＊＊"),
    "**0.50/百万输入tokens**",
  );
});

test("normalizeChatMarkdownContent: auto-closes dangling ** while streaming", () => {
  assert.equal(
    normalizeChatMarkdownContent("价格：**0.50/百万输入tokens", { isStreaming: true }),
    "价格：**0.50/百万输入tokens**",
  );
  assert.equal(
    normalizeChatMarkdownContent("价格：**0.50/百万输入tokens"),
    "价格：**0.50/百万输入tokens",
  );
});

test("normalizeChatMarkdownContent: skips fenced and inline code", () => {
  const input = "prose ** spaced** and `** keep **` and ```\n** code **\n```";
  assert.equal(
    normalizeChatMarkdownContent(input),
    "prose **spaced** and `** keep **` and ```\n** code **\n```",
  );
});

test("normalizeChatMarkdownContent: streaming close ignores ** inside inline code", () => {
  const input = "before **open and `** not counted` tail";
  assert.equal(
    normalizeChatMarkdownContent(input, { isStreaming: true }),
    "before **open and `** not counted` tail**",
  );
});

test("normalizeChatMarkdownContent: unwraps automation HTML comment saved paths", () => {
  const input =
    "报告生成时间：2026-07-03 00:17:44\n\n<!-- 报告已保存至: /Users/damon/.agenticx/crontask/atask_19/A股日报_20260703.md -->";
  assert.equal(
    normalizeChatMarkdownContent(input),
    "报告生成时间：2026-07-03 00:17:44\n\n报告已保存至: `/Users/damon/.agenticx/crontask/atask_19/A股日报_20260703.md`",
  );
});

test("normalizeChatMarkdownContent: linkifies inline labeled saved paths", () => {
  assert.equal(
    normalizeChatMarkdownContent("文件已保存到 /Users/damon/out/report.md"),
    "文件已保存到 `/Users/damon/out/report.md`",
  );
  assert.equal(
    normalizeChatMarkdownContent("saved to: /Users/damon/out/report.md"),
    "saved to: `/Users/damon/out/report.md`",
  );
});

test("normalizeChatMarkdownContent: does not alter paths already in backticks", () => {
  const input = "已保存至: `/Users/damon/out/report.md`";
  assert.equal(normalizeChatMarkdownContent(input), input);
});
