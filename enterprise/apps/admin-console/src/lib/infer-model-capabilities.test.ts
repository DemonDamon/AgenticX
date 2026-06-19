import { describe, expect, it } from "vitest";
import { inferModelCapabilities } from "./infer-model-capabilities";

describe("inferModelCapabilities", () => {
  it("marks GLM-5.1 as text-only for zhipu", () => {
    expect(inferModelCapabilities("zhipu", "glm-5.1")).toEqual(["text"]);
    expect(inferModelCapabilities("zhipu", "GLM-5.1")).toEqual(["text"]);
  });

  it("marks GLM-4.5V with vision", () => {
    expect(inferModelCapabilities("zhipu", "glm-4.5v")).toContain("vision");
  });

  it("marks deepseek-reasoner with reasoning", () => {
    expect(inferModelCapabilities("deepseek", "deepseek-reasoner")).toEqual(["text", "reasoning"]);
  });
});
