import { describe, expect, it } from "vitest";
import {
  MODEL_CONTEXT_WINDOW_MAX,
  MODEL_CONTEXT_WINDOW_MIN,
  modelContextWindowKey,
  validateContextWindowInput,
} from "../src/components/settings/DeveloperContextWindowPanel";

describe("validateContextWindowInput", () => {
  it("treats an empty field as clearing the override, not an error", () => {
    expect(validateContextWindowInput("")).toEqual({ cleared: true });
    expect(validateContextWindowInput("   ")).toEqual({ cleared: true });
  });

  it("accepts usable windows and floors fractional input", () => {
    expect(validateContextWindowInput("128000")).toEqual({ value: 128_000 });
    expect(validateContextWindowInput(" 32768 ")).toEqual({ value: 32_768 });
    expect(validateContextWindowInput("131072.9")).toEqual({ value: 131_072 });
  });

  it("rejects out-of-range values instead of persisting them", () => {
    // 填高会让压缩触发得太晚，直接撞上游 400，所以宁可不提交。
    for (const bad of ["0", "-1", String(MODEL_CONTEXT_WINDOW_MIN - 1), String(MODEL_CONTEXT_WINDOW_MAX + 1)]) {
      expect(validateContextWindowInput(bad)).toHaveProperty("error");
    }
    expect(validateContextWindowInput("abc")).toEqual({ error: "上下文窗口必须是数字" });
  });

  it("accepts the exact bounds", () => {
    expect(validateContextWindowInput(String(MODEL_CONTEXT_WINDOW_MIN))).toEqual({
      value: MODEL_CONTEXT_WINDOW_MIN,
    });
    expect(validateContextWindowInput(String(MODEL_CONTEXT_WINDOW_MAX))).toEqual({
      value: MODEL_CONTEXT_WINDOW_MAX,
    });
  });
});

describe("modelContextWindowKey (renderer side)", () => {
  it("matches the key the main process persists", () => {
    expect(modelContextWindowKey("custom_openai_local", "glm-5.2")).toBe("custom_openai_local/glm-5.2");
    expect(modelContextWindowKey("enterprise", "zhipu/glm-5.2")).toBe("enterprise/zhipu/glm-5.2");
    expect(modelContextWindowKey("", "x")).toBe("");
  });
});
