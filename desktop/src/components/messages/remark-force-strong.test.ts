import assert from "node:assert/strict";
import test from "node:test";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

import remarkForceStrongEmphasis from "./remark-force-strong";

function parseWithForceStrong(markdown: string) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkForceStrongEmphasis);
  const tree = processor.parse(markdown);
  processor.runSync(tree);
  return tree;
}

function analyze(markdown: string): { strong: number; leftover: string[]; strongTexts: string[] } {
  const tree = parseWithForceStrong(markdown);
  let strong = 0;
  const leftover: string[] = [];
  const strongTexts: string[] = [];
  visit(tree, (node) => {
    if (node.type === "strong") {
      strong += 1;
      let text = "";
      visit(node, "text", (t) => {
        text += t.value;
      });
      strongTexts.push(text);
    }
    if (node.type === "text" && node.value.includes("**")) {
      leftover.push(node.value);
    }
  });
  return { strong, leftover, strongTexts };
}

function hasStrongNode(markdown: string): boolean {
  return analyze(markdown).strong > 0;
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

test("remarkForceStrongEmphasis: repairs GFM cross-paired adjacent CJK bold spans", () => {
  const md =
    "这个曲线图描述的是**「放手项目后被打扰的频率衰减」**，形状像**艾宾浩斯遗忘曲线**——刚离开时电话被打爆，随后快速下降，最后趋于一个低频率的常态。";
  const { strong, leftover, strongTexts } = analyze(md);
  assert.equal(leftover.length, 0, `unexpected leftover **: ${JSON.stringify(leftover)}`);
  assert.equal(strong, 2);
  assert.deepEqual(strongTexts, ["「放手项目后被打扰的频率衰减」", "艾宾浩斯遗忘曲线"]);
});

test("remarkForceStrongEmphasis: repairs adjacent bold with ASCII quotes between spans", () => {
  const md = '前缀**"第一段"**然后**第二段**结尾';
  const { strong, leftover, strongTexts } = analyze(md);
  // Either GFM already correct, or sibling repair — never leak **
  assert.equal(leftover.length, 0, `unexpected leftover **: ${JSON.stringify(leftover)}`);
  assert.ok(strong >= 2);
  assert.ok(strongTexts.some((t) => t.includes("第一段") || t.includes('"第一段"')));
  assert.ok(strongTexts.some((t) => t.includes("第二段")));
});

test("remarkForceStrongEmphasis: does not rewrite legitimate text+strong+text without orphan **", () => {
  const { strong, leftover, strongTexts } = analyze("前缀**正常加粗**后缀文字");
  assert.equal(leftover.length, 0);
  assert.equal(strong, 1);
  assert.deepEqual(strongTexts, ["正常加粗"]);
});
