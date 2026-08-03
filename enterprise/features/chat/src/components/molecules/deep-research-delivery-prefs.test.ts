import { describe, expect, it } from "vitest";
import {
  displayDeliveryFileName,
  inferDeliveryFormat,
  isPrimaryDeliveryArtifactPath,
} from "./deep-research-delivery-prefs";

describe("inferDeliveryFormat", () => {
  it("defaults to md", () => {
    expect(inferDeliveryFormat(undefined)).toBe("md");
    expect(inferDeliveryFormat({})).toBe("md");
  });

  it("reads q_delivery_format labels", () => {
    expect(
      inferDeliveryFormat({ q_delivery_format: "可视化网页（.html）" }),
    ).toBe("html");
    expect(inferDeliveryFormat({ q_delivery_format: "可视化网页 (.html)" })).toBe(
      "html",
    );
    expect(inferDeliveryFormat({ q_delivery_format: "html" })).toBe("html");
    expect(inferDeliveryFormat({ q_delivery_format: "PDF（打印导出）" })).toBe("pdf");
    expect(inferDeliveryFormat({ q_delivery_format: "Word（.doc）" })).toBe("docx");
    expect(inferDeliveryFormat({ q_delivery_format: "Markdown（.md）" })).toBe("md");
  });
});

describe("isPrimaryDeliveryArtifactPath", () => {
  it("picks html primary for html/pdf prefs", () => {
    expect(isPrimaryDeliveryArtifactPath("research/r1/report.html", "html")).toBe(true);
    expect(isPrimaryDeliveryArtifactPath("research/r1/final-report.md", "html")).toBe(
      false,
    );
    expect(isPrimaryDeliveryArtifactPath("research/r1/report.html", "pdf")).toBe(true);
  });

  it("picks final-report.md for md/docx and hides report.md", () => {
    expect(isPrimaryDeliveryArtifactPath("research/r1/final-report.md", "md")).toBe(true);
    expect(isPrimaryDeliveryArtifactPath("research/r1/report.html", "md")).toBe(false);
    expect(isPrimaryDeliveryArtifactPath("research/r1/report.md", "md")).toBe(false);
  });
});

describe("displayDeliveryFileName", () => {
  it("prefers cleaned title with extension", () => {
    expect(
      displayDeliveryFileName({
        path: "research/r1/final-report.md",
        title: "DeepSeek V4 核心技术点 · 终稿",
      }),
    ).toBe("DeepSeek V4 核心技术点.md");
    expect(
      displayDeliveryFileName({
        path: "research/r1/report.html",
        title: "DeepSeek V4.html",
      }),
    ).toBe("DeepSeek V4.html");
  });
});
