import assert from "node:assert/strict";
import test from "node:test";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import remarkForceStrongEmphasis from "./remark-force-strong";

function hasStrongNode(markdown: string): boolean {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkForceStrongEmphasis);
  const tree = processor.parse(markdown);
  processor.runSync(tree);
  return JSON.stringify(tree).includes('"strong"');
}

test("remarkForceStrongEmphasis: fixes bold immediately touching quotes/CJK on both sides", () => {
  assert.equal(
    hasStrongNode('**"这是我最后的波纹了……请收下吧！"**在截图里的用法：'),
    true,
  );
  assert.equal(
    hasStrongNode('简单说，这就是二次元版的**"离职前最后再做一件事"**的表达方式。'),
    true,
  );
});

test("remarkForceStrongEmphasis: fixes bold touching full-width brackets/quotes", () => {
  assert.equal(hasStrongNode("标题：**「引用标题」**后续文字"), true);
  assert.equal(hasStrongNode("开头**（括号开头）**结尾"), true);
  assert.equal(hasStrongNode("结论：**“关键发现”**。感谢阅读"), true);
});

test("remarkForceStrongEmphasis: does not affect already-valid bold", () => {
  assert.equal(hasStrongNode("**正常粗体**后面中文"), true);
  assert.equal(hasStrongNode("这是**加粗文字**的测试"), true);
});

test("remarkForceStrongEmphasis: leaves inline code and fenced code untouched", () => {
  assert.equal(hasStrongNode("这是一个含 `**不应该被转换**` 的代码片段"), false);
  assert.equal(hasStrongNode("```\n**code block should stay literal**\n```"), false);
});

test("remarkForceStrongEmphasis: ignores empty bold delimiters", () => {
  assert.equal(hasStrongNode("空的****粗体不转换"), false);
});
