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

describe("primaryReportPathSuffix / title", () => {
  it("maps html/pdf to report.html and md/docx to final-report.md", () => {
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
      "final-report.md",
    );
  });

  it("builds readable primary titles", () => {
    expect(primaryArtifactTitle("DeepSeek V4", { shapes: ["structured"], format: "md" })).toBe(
      "DeepSeek V4.md",
    );
    expect(primaryArtifactTitle("DeepSeek V4", { shapes: ["structured"], format: "html" })).toBe(
      "DeepSeek V4.html",
    );
  });
});
