import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSourceAttribution } from "./source-attribution-parse";

test("extractSourceAttribution: blockquote legend with [N] markers", () => {
  const input = `## 五、总结

本轮下跌是多重共振。

> **数据来源标注**：
> - [1] 已验证数据：每日经济新闻、每经网盘面报道
> - [2] 已验证数据：21财经、央广网机构研判
> - [3] 合理推测：基于PMI及GDP数据的宏观分析
> - [4] 合理推测：基于消费信心指数的市场解读
`;

  const { body, items } = extractSourceAttribution(input);
  assert.match(body, /多重共振/);
  assert.equal(body.includes("数据来源标注"), false);
  assert.equal(body.includes("[1]"), false);
  assert.deepEqual(
    items.map((i) => ({ kind: i.kind, label: i.label, text: i.text })),
    [
      { kind: "verified", label: "已验证", text: "每日经济新闻、每经网盘面报道" },
      { kind: "verified", label: "已验证", text: "21财经、央广网机构研判" },
      { kind: "inference", label: "合理推测", text: "基于PMI及GDP数据的宏观分析" },
      { kind: "inference", label: "合理推测", text: "基于消费信心指数的市场解读" },
    ],
  );
});

test("extractSourceAttribution: preferred format without [N]", () => {
  const input = `结论如上。

**数据来源标注**
- 已验证：每日经济新闻
- 合理推测：基于 PMI 的宏观分析
- 纯假设：若政策超预期加码
`;

  const { body, items } = extractSourceAttribution(input);
  assert.equal(body.trim(), "结论如上。");
  assert.equal(items.length, 3);
  assert.equal(items[0]?.kind, "verified");
  assert.equal(items[1]?.kind, "inference");
  assert.equal(items[2]?.kind, "hypothesis");
  assert.equal(items[2]?.label, "纯假设");
});

test("extractSourceAttribution: leaves normal citations in body", () => {
  const input = `外围科技股暴跌。[1]

筹码拥挤放大抛压。[2]
`;
  const { body, items } = extractSourceAttribution(input);
  assert.equal(items.length, 0);
  assert.equal(body, input);
});

test("extractSourceAttribution: no false positive on 数据来源：AkShare inline", () => {
  const input = `图表如下。数据来源：AkShare（非实时）。`;
  const { body, items } = extractSourceAttribution(input);
  assert.equal(items.length, 0);
  assert.equal(body, input);
});
