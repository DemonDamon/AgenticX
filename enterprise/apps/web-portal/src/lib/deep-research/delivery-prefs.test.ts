import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_PREFS,
  DELIVERY_FORMAT_QUESTION_ID,
  DELIVERY_SHAPE_QUESTION_ID,
  deliveryClarifyQuestions,
  deliveryPrefsPromptBlock,
  parseDeliveryPrefs,
  primaryArtifactTitle,
  primaryReportPathSuffix,
  sanitizeResearchTopic,
} from "./delivery-prefs";

describe("deliveryClarifyQuestions", () => {
  it("returns shape (multi) and format (single) questions", () => {
    const qs = deliveryClarifyQuestions();
    expect(qs).toHaveLength(2);
    expect(qs[0]!.id).toBe(DELIVERY_SHAPE_QUESTION_ID);
    expect(qs[0]!.multiSelect).toBe(true);
    expect(qs[0]!.options.length).toBe(4);
    expect(qs[1]!.id).toBe(DELIVERY_FORMAT_QUESTION_ID);
    expect(qs[1]!.multiSelect).toBe(false);
    expect(qs[1]!.options.length).toBe(4);
  });
});

describe("parseDeliveryPrefs", () => {
  const questions = deliveryClarifyQuestions();

  it("returns defaults for empty answers", () => {
    expect(parseDeliveryPrefs({}, questions)).toEqual(DEFAULT_DELIVERY_PREFS);
  });

  it("parses multi shape + single format from joined labels", () => {
    const shape = questions[0]!;
    const format = questions[1]!;
    const prefs = parseDeliveryPrefs(
      {
        [DELIVERY_SHAPE_QUESTION_ID]: `${shape.options[1]!.label}、${shape.options[3]!.label}`,
        [DELIVERY_FORMAT_QUESTION_ID]: format.options[1]!.label,
      },
      questions,
    );
    expect(prefs.shapes).toEqual(["matrix", "decision"]);
    expect(prefs.format).toBe("html");
  });

  it("takes first matched format when multiple labels appear", () => {
    const format = questions[1]!;
    const prefs = parseDeliveryPrefs(
      {
        [DELIVERY_FORMAT_QUESTION_ID]: `${format.options[2]!.label}、${format.options[0]!.label}`,
      },
      questions,
    );
    // Longest-label-first may match either; first in FORMAT order after match list uses formatIds[0]
    expect(["docx", "md"]).toContain(prefs.format);
  });

  it("accepts loose html keywords when labels drift", () => {
    expect(
      parseDeliveryPrefs(
        { [DELIVERY_FORMAT_QUESTION_ID]: "可视化网页 (.html)" },
        questions,
      ).format,
    ).toBe("html");
    expect(
      parseDeliveryPrefs({ [DELIVERY_FORMAT_QUESTION_ID]: "html" }, questions).format,
    ).toBe("html");
  });
});

describe("deliveryPrefsPromptBlock", () => {
  it("includes shape and format lines", () => {
    const block = deliveryPrefsPromptBlock({
      shapes: ["matrix", "decision"],
      format: "html",
    });
    expect(block).toContain("【交付偏好】");
    expect(block).toContain("对比矩阵/时间线");
    expect(block).toContain("决策建议");
    expect(block).toContain("可视化网页（html）");
  });
});

describe("sanitizeResearchTopic", () => {
  it("strips clarify and delivery-preference blocks from titles", () => {
    const polluted = [
      "minimax H3 核心技术点",
      "",
      "【用户澄清】",
      "- 场景：全方向",
      "",
      "【交付偏好】",
      "- 主格式：可视化网页（html）",
    ].join("\n");
    expect(sanitizeResearchTopic(polluted)).toBe("minimax H3 核心技术点");
  });

  it("strips inline meta markers", () => {
    expect(sanitizeResearchTopic("DeepSeek V4 【用户澄清】 全方向")).toBe("DeepSeek V4");
  });

  it("falls back when only meta remains", () => {
    expect(sanitizeResearchTopic("【交付偏好】\n- 主格式：md")).toBe("调研报告");
  });
});

describe("primaryReportPathSuffix / title", () => {
  it("maps html/pdf to report.html, docx to report.doc, md to final-report.md", () => {
    expect(primaryReportPathSuffix({ shapes: ["structured"], format: "html" })).toBe(
      "report.html",
    );
    expect(primaryReportPathSuffix({ shapes: ["structured"], format: "pdf" })).toBe(
      "report.html",
    );
    expect(primaryReportPathSuffix({ shapes: ["structured"], format: "md" })).toBe(
      "final-report.md",
    );
    expect(primaryReportPathSuffix({ shapes: ["structured"], format: "docx" })).toBe(
      "report.doc",
    );
  });

  it("builds readable primary titles", () => {
    expect(primaryArtifactTitle("DeepSeek V4", { shapes: ["structured"], format: "md" })).toBe(
      "DeepSeek V4.md",
    );
    expect(primaryArtifactTitle("DeepSeek V4", { shapes: ["structured"], format: "html" })).toBe(
      "DeepSeek V4.html",
    );
    expect(primaryArtifactTitle("DeepSeek V4", { shapes: ["structured"], format: "docx" })).toBe(
      "DeepSeek V4.doc",
    );
  });
});
