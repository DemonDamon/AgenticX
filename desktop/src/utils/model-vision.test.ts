import { describe, expect, it } from "vitest";
import { isKnownNonVisionChatModel } from "./model-vision";

describe("isKnownNonVisionChatModel — zhipu GLM text vs vision", () => {
  it("treats known GLM text SKUs as non-vision", () => {
    expect(isKnownNonVisionChatModel("zhipu", "glm-4.5-air")).toBe(true);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4.5-airx")).toBe(true);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4.6")).toBe(true);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4-plus")).toBe(true);
    expect(isKnownNonVisionChatModel("zhipu", "glm-5")).toBe(true);
    expect(isKnownNonVisionChatModel("zhipu", "glm-5.2")).toBe(true);
  });

  it("treats GLM-5.3 Flash as vision-capable", () => {
    expect(isKnownNonVisionChatModel("zhipu", "glm-5.3-flash")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "GLM-5.3-Flash")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "openai/glm-5.3-flash")).toBe(false);
    expect(isKnownNonVisionChatModel("custom_openai_x", "glm-5.3-flash")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "glm-5.3")).toBe(false);
  });

  it("treats known text-only SKUs as non-vision on custom OpenAI gateways", () => {
    expect(isKnownNonVisionChatModel("custom_openai_caiyun", "glm-5.2")).toBe(true);
    expect(isKnownNonVisionChatModel("custom_openai_x", "glm-4.6v")).toBe(false);
  });

  it("allows GLM vision SKUs (digit+v / vision / vl)", () => {
    expect(isKnownNonVisionChatModel("zhipu", "glm-4v")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4v-flash")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4.1v-thinking-flash")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4.5v")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "glm-4.6v")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "openai/glm-4.6v")).toBe(false);
    expect(isKnownNonVisionChatModel("zhipu", "glm-6-future-vision")).toBe(false);
  });
});
