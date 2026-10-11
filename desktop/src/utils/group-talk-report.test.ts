import { describe, expect, it } from "vitest";
import { looksLikeGroupReport, splitGroupTalkFromReport } from "./group-talk-report";

const shortTalk = "结论：建议采用方案 A。";

function longReport(): string {
  const lead = "结论：这块预算超了，超在差旅和外包。";
  const section = [
    "本轮核对了差旅、外包和采购三类支出，下面按科目展开说明，便于对照合同与报销单。",
    "差旅超标主要来自临时改签和周末停留；外包超标来自两周的加急档期与驻场加班。",
    "采购基本持平，但发票尚未齐，不能当作本周可关闭项。",
    "若需要完整表格，我可以再补一版到工作区，不把细项继续堆在群里。",
    "建议先砍差旅改签，再谈外包档期，采购维持原单并催发票。",
    "这版先给结论和三块拆解，细表不进群气泡。",
  ].join("");
  return `${lead}\n\n## 背景\n${section}\n\n## 明细\n${section}\n\n## 建议\n${section}`;
}

describe("looksLikeGroupReport", () => {
  it("rejects a short spoken reply", () => {
    expect(looksLikeGroupReport(shortTalk)).toBe(false);
  });

  it("accepts a heading-heavy write-up over the heading threshold", () => {
    expect(looksLikeGroupReport(longReport())).toBe(true);
    expect(longReport().length).toBeGreaterThanOrEqual(560);
  });
});

describe("splitGroupTalkFromReport", () => {
  it("keeps a short reply in the bubble", () => {
    expect(splitGroupTalkFromReport(shortTalk)).toEqual({ talk: shortTalk, report: null });
    expect(splitGroupTalkFromReport("结论：用方案 A。")).toEqual({
      talk: "结论：用方案 A。",
      report: null,
    });
  });

  it("peels the spoken lead and leaves the heading body in the report", () => {
    const raw = longReport();
    const split = splitGroupTalkFromReport(raw);
    expect(split.talk).toContain("预算超了");
    expect(split.talk).not.toContain("## 背景");
    expect(split.report).toContain("## 背景");
    expect(split.report).toContain("## 明细");
    expect(`${split.talk}${split.report ? `\n${split.report}` : ""}`.replace(/\s+/g, "")).toContain(
      "预算超了",
    );
  });

  it("does not peel when the remainder would be a stub", () => {
    const padded = `${"结论：先看这版。".repeat(20)}\n\n## 补丁\n再补一句。`;
    const split = splitGroupTalkFromReport(padded);
    expect(split.report === null || (split.report?.length ?? 0) >= 160).toBe(true);
  });
});
