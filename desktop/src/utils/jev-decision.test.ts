import { describe, expect, it } from "vitest";
import {
  isJevHardFallback,
  jevActionLabelZh,
  jevFallbackCauseZh,
  jevFallbackLineZh,
  jevKbActionLabel,
  parseJevDecision,
} from "./jev-decision";

describe("jev-decision mappings", () => {
  it("maps Chinese action and fallback labels", () => {
    expect(jevActionLabelZh("route_to")).toBe("派给成员");
    expect(jevActionLabelZh("meta_direct")).toBe("Near 作答");
    expect(jevActionLabelZh("continue_thread")).toBe("续聊");
    expect(jevActionLabelZh("open_floor")).toBe("开放麦");
    expect(jevFallbackCauseZh("jev_no_key")).toBe("未配置密钥");
    expect(jevFallbackCauseZh("jev_timeout")).toBe("超时");
    expect(jevFallbackCauseZh("jev_http")).toBe("请求失败");
    expect(jevFallbackCauseZh("jev_fallback_llm")).toBe("置信不足");
    expect(jevFallbackCauseZh("jev_soft_timeout")).toBe("判定较慢");
    expect(jevFallbackCauseZh("jev_fallback_meta")).toBe("已回落 Near");
    expect(isJevHardFallback("jev_timeout")).toBe(true);
    expect(isJevHardFallback("jev_fallback_llm")).toBe(false);
    expect(jevFallbackLineZh("jev_fallback_llm")).toBe("改走主模型 · 置信不足");
    expect(jevFallbackLineZh("jev_soft_timeout")).toBe("改走主模型 · 判定较慢");
    expect(jevFallbackLineZh("jev_no_key")).toBe("未采用 · 未配置密钥");
  });

  it("maps kb_auto second-line labels", () => {
    const base = parseJevDecision({
      kind: "jev_kb_gate",
      phase: "done",
      purpose: "kb_auto",
      source: "jev",
      action: "search",
      noul_execution: 0.9,
    });
    expect(base).not.toBeNull();
    expect(jevKbActionLabel(base!)).toBe("检索知识库");
    expect(jevKbActionLabel({ ...base!, action: "skip", noul_execution: 0.1 })).toBe("跳过检索");
  });

  it("parses a group routing payload", () => {
    const parsed = parseJevDecision({
      kind: "jev_decision",
      phase: "done",
      purpose: "group_routing",
      source: "jev",
      model: "jev-1.13.0",
      action: "route_to",
      target_ids: ["fin"],
      target_labels: ["财务"],
      confidence: 0.72,
      gate: "auto",
      probabilities: { route_to: 0.81 },
    });
    expect(parsed?.model).toBe("jev-1.13.0");
    expect(parsed?.target_labels).toEqual(["财务"]);
    expect(parsed?.confidence).toBe(0.72);
  });
});
