import { describe, expect, it } from "vitest";
import { isKnownNonVisionChatModel, modelSupportsVision } from "./model-vision";

describe("model-vision", () => {
  it("treats zhipu GLM-5.1 as text-only", () => {
    expect(isKnownNonVisionChatModel("zhipu", "GLM-5.1")).toBe(true);
    expect(modelSupportsVision("zhipu", "GLM-5.1")).toBe(false);
  });

  it("treats zhipu glm-4v as vision-capable", () => {
    expect(isKnownNonVisionChatModel("zhipu", "glm-4v")).toBe(false);
    expect(modelSupportsVision("zhipu", "glm-4v")).toBe(true);
  });

  it("respects explicit vision capability flag", () => {
    expect(modelSupportsVision("zhipu", "GLM-5.1", ["vision"])).toBe(true);
  });
});
