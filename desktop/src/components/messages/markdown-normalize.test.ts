import assert from "node:assert/strict";
import { test } from "vitest";

import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import {
  normalizeChatMarkdownContent,
  normalizeLenientEmphasisInText,
} from "./markdown-normalize.ts";

function fencedCodeBlocks(markdown: string): { lang: string; value: string }[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const blocks: { lang: string; value: string }[] = [];
  visit(tree, "code", (node) => {
    blocks.push({
      lang: typeof node.lang === "string" ? node.lang : "",
      value: String(node.value ?? ""),
    });
  });
  return blocks;
}

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
  const input = "prose ** spaced** and `** keep **` and\n```\n** code **\n```";
  assert.equal(
    normalizeChatMarkdownContent(input),
    "prose **spaced** and `** keep **` and\n```\n** code **\n```",
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

test("normalizeChatMarkdownContent: keeps nested prompt fences as one markdown block", () => {
  const input = [
    "## 整理后的提示词",
    "",
    "```markdown",
    "# 问题诊断：公司网络环境下 AI 编码工具流式请求中断",
    "",
    "### 1. CC Switch + Codex",
    "- 报错：",
    "  ```",
    "  Error: unexpected status 502 Bad Gateway: CC Switch local proxy failed",
    "  ```",
    "",
    "### 2. 直接配置火山引擎 Coding Plan",
    "- 报错：",
    "  ```",
    "  Error: stream disconnected before completion",
    "  ```",
    "```",
    "",
    "团长可以直接复制使用。",
  ].join("\n");

  const normalized = normalizeChatMarkdownContent(input);
  const blocks = fencedCodeBlocks(normalized);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.lang, "markdown");
  assert.match(blocks[0]?.value ?? "", /问题诊断：公司网络环境下 AI 编码工具流式请求中断/);
  assert.match(blocks[0]?.value ?? "", /502 Bad Gateway/);
  assert.match(blocks[0]?.value ?? "", /直接配置火山引擎 Coding Plan/);
  assert.match(blocks[0]?.value ?? "", /stream disconnected before completion/);
  assert.match(normalized, /^````+markdown\s*$/m);
  assert.match(normalized, /团长可以直接复制使用。/);
});

test("normalizeChatMarkdownContent: does not rewrite sibling fences or fence interiors", () => {
  const input = "prose ** spaced**\n\n```\n** keep **\n```\n\nmore ** spaced**";
  assert.equal(
    normalizeChatMarkdownContent(input),
    "prose **spaced**\n\n```\n** keep **\n```\n\nmore **spaced**",
  );
});

test("normalizeChatMarkdownContent: leaves an unclosed fence untouched while streaming", () => {
  const input = "## 标题\n\n```markdown\n# 问题诊断\n  ```\n  Error: 502\n";
  assert.equal(
    normalizeChatMarkdownContent(input, { isStreaming: true }),
    input,
  );
});
