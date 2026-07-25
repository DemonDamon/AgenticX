import { describe, expect, it } from "vitest";
import {
  composerQuotePlaceholder,
  indexOfNextComposerQuotePlaceholder,
  matchComposerQuotePlaceholder,
  normalizeComposerQuotePlaceholdersToIndices,
  parseQuotedContentItems,
  resolveUserMessageQuoteDisplay,
  serializeQuotedContent,
  splitUserQuotedContent,
  stripComposerQuotePlaceholders,
} from "./user-quote-display";

describe("splitUserQuotedContent", () => {
  it("splits marker block from user text", () => {
    const raw =
      "你复述一下这句话\n\n[用户引用内容]\nNear: 失败原因：系统拒绝写入";
    expect(splitUserQuotedContent(raw)).toEqual({
      body: "你复述一下这句话",
      quoted: "Near: 失败原因：系统拒绝写入",
    });
  });

  it("returns null when marker absent", () => {
    expect(splitUserQuotedContent("普通消息")).toBeNull();
  });
});

describe("serializeQuotedContent / parseQuotedContentItems", () => {
  it("round-trips multiple quotes", () => {
    const blob = serializeQuotedContent([
      { label: "Near", body: "第一段引用" },
      { label: "Near", body: "第四轮引用" },
    ]);
    expect(parseQuotedContentItems(blob)).toEqual([
      "Near: 第一段引用",
      "Near: 第四轮引用",
    ]);
  });

  it("keeps legacy single quote as one item", () => {
    expect(parseQuotedContentItems("Near: 旧单条引用")).toEqual(["Near: 旧单条引用"]);
  });
});

describe("composer quote placeholders", () => {
  it("round-trips placeholder match and strip", () => {
    const id = "abc-123";
    const embedded = `请解释一下${composerQuotePlaceholder(id)}，然后`;
    const matched = matchComposerQuotePlaceholder(embedded, "请解释一下".length);
    expect(matched).toEqual({ id, len: composerQuotePlaceholder(id).length });
    expect(stripComposerQuotePlaceholders(embedded)).toBe("请解释一下，然后");
  });

  it("uses ASCII markers that survive innerText (not bare quote:N)", () => {
    expect(composerQuotePlaceholder("0")).toBe("[[agx-quote:0]]");
    expect(composerQuotePlaceholder("0").includes("\uE000")).toBe(false);
  });

  it("normalizes uuid placeholders to index order for history", () => {
    const a = "uuid-a";
    const b = "uuid-b";
    const raw = `前缀${composerQuotePlaceholder(b)}中间${composerQuotePlaceholder(a)}后缀`;
    const normalized = normalizeComposerQuotePlaceholdersToIndices(raw, [b, a]);
    expect(normalized).toBe(
      `前缀${composerQuotePlaceholder("0")}中间${composerQuotePlaceholder("1")}后缀`
    );
  });

  it("repairs bare quote:N left after PUA strip", () => {
    const repaired = resolveUserMessageQuoteDisplay(
      "帮我找一下这段代码 quote:0 ，还有 quote:1",
      "Near: find_affected()\n\n<<<agx-quote>>>\n\nNear: get_code_snippe"
    );
    expect(repaired.body).toBe(
      `帮我找一下这段代码 ${composerQuotePlaceholder("0")} ，还有 ${composerQuotePlaceholder("1")}`
    );
    expect(repaired.quotedItems).toHaveLength(2);
  });

  it("finds quote placeholders mid-string (not only at cursor 0)", () => {
    const body = `这代码${composerQuotePlaceholder("0")}有什么风险，还有如果不用${composerQuotePlaceholder("1")}，还能用啥？`;
    expect(indexOfNextComposerQuotePlaceholder(body, 0)).toBe("这代码".length);
    const second = indexOfNextComposerQuotePlaceholder(body, "这代码".length + 1);
    expect(second).toBe(body.indexOf(composerQuotePlaceholder("1")));
    expect(matchComposerQuotePlaceholder(body, second!)).toEqual({
      id: "1",
      len: composerQuotePlaceholder("1").length,
    });
  });
});

describe("resolveUserMessageQuoteDisplay", () => {
  it("prefers explicit quotedContent over inlined block", () => {
    const raw = "正文\n\n[用户引用内容]\n旧引用";
    expect(resolveUserMessageQuoteDisplay(raw, "新引用")).toEqual({
      body: "正文",
      quoted: "新引用",
      quotedItems: ["新引用"],
    });
  });

  it("uses explicit quotedContent when body is clean", () => {
    expect(resolveUserMessageQuoteDisplay("正文", "引用片段")).toEqual({
      body: "正文",
      quoted: "引用片段",
      quotedItems: ["引用片段"],
    });
  });
});
