import { describe, expect, it } from "vitest";
import {
  assessClarifyStrategy,
  buildInteractionProfile,
  buildPlanChatPrompt,
  buildPlanRevisionUserQuery,
  deriveResearchDepth,
  findMissingBlockingSlots,
  isHighRiskQuery,
  isSkipClarifyReply,
  parseChatClarifyReply,
  parsePlanChatGateAction,
  resolveDepthBudget,
} from "./interaction-policy";

describe("assessClarifyStrategy", () => {
  it("收紧的单一事实题（长 prompt）不触发澄清", () => {
    const longBackground = "背景：".padEnd(400, "某模型发布了很多版本。");
    const s = assessClarifyStrategy({ query: `${longBackground}这个 API 的发布日期是什么` });
    expect(s.mode).toBe("none");
    expect(s.blocking).toBe(false);
    expect(s.maxItems).toBe(0);
    expect(s.reasonCodes).toContain("narrow_factual");
  });

  it("短描述的难题是 deep 研究但单一开放缺口用对话澄清", () => {
    const s = assessClarifyStrategy({ query: "研究 Transformer 的核心技术演进" });
    expect(s.mode).toBe("chat");
    expect(s.blocking).toBe(false);
    expect(s.maxItems).toBe(1);
    expect(s.reasonCodes).toContain("optional");
    expect(s.reasonCodes).toContain("single_gap_chat");
  });

  it("高风险 + 缺关键槽位 → blocking required", () => {
    const s = assessClarifyStrategy({ query: "帮我做一份 AI 战略建议" });
    expect(s.blocking).toBe(true);
    expect(s.maxItems).toBeGreaterThanOrEqual(1);
    expect(s.reasonCodes).toContain("high_risk");
    expect(s.reasonCodes).toContain("required");
  });

  it("用户选「直接开始」也不能静默绕过高风险缺槽", () => {
    const s = assessClarifyStrategy({
      query: "帮我制定投资战略建议",
      userPreference: "direct",
    });
    expect(s.blocking).toBe(true);
    expect(s.mode).not.toBe("none");
  });

  it("低风险 + direct 偏好 → none", () => {
    const s = assessClarifyStrategy({
      query: "调研一下向量数据库的核心技术点",
      userPreference: "direct",
    });
    expect(s.mode).toBe("none");
  });

  it("plan_chat 偏好 → clarifyMode none（计划对齐走 plan gate）", () => {
    const s = assessClarifyStrategy({
      query: "调研一下向量数据库的核心技术点",
      userPreference: "plan_chat",
    });
    expect(s.mode).toBe("none");
    expect(s.blocking).toBe(false);
    expect(s.reasonCodes).toContain("plan_chat");
  });

  it("旧 chat_first / plan_first 偏好迁移为 plan_chat → none", () => {
    expect(
      assessClarifyStrategy({
        query: "调研一下向量数据库的核心技术点",
        userPreference: "chat_first",
      }).mode,
    ).toBe("none");
    expect(
      assessClarifyStrategy({
        query: "调研一下向量数据库的核心技术点",
        userPreference: "plan_first",
      }).reasonCodes,
    ).toContain("plan_chat");
  });

  it("auto 偏好下非开放式事实题仍走 none（narrow_factual 快速通道保留）", () => {
    const s = assessClarifyStrategy({
      query: "这个 API 的发布日期是什么",
    });
    expect(s.mode).toBe("none");
    expect(s.reasonCodes).toContain("narrow_factual");
  });

  it("plan_chat 偏好即使对极短无意义输入也走 none（计划对齐不静默直跑 lanes，由 plan gate 承接）", () => {
    const s = assessClarifyStrategy({
      query: "aaa",
      userPreference: "plan_chat",
    });
    expect(s.mode).toBe("none");
    expect(s.reasonCodes).toContain("plan_chat");
  });

  it("card_first 偏好对极短输入走 card（尊重明确偏好）", () => {
    const s = assessClarifyStrategy({
      query: "aaa",
      userPreference: "card_first",
    });
    expect(s.mode).toBe("card");
  });

  it("auto 偏好下极短无意义输入走 none（无偏好不强制澄清）", () => {
    const s = assessClarifyStrategy({
      query: "aaa",
    });
    expect(s.mode).toBe("none");
  });

  it("推荐类问题缺预算/地区 → optional 澄清（由歧义触发而非深度）", () => {
    const s = assessClarifyStrategy({ query: "推荐一款手机" });
    expect(s.mode).toBe("card");
    expect(s.blocking).toBe(false);
    expect(s.reasonCodes.some((c) => c.startsWith("missing_slots"))).toBe(true);
    expect(s.reasonCodes).toContain("multi_gap_card");
  });

  it("只有一个低置信度维度时用对话确认，两个维度都低时用卡片", () => {
    expect(
      assessClarifyStrategy({
        query: "这个 API 的发布日期是什么",
        intentConfidence: { routeConfidence: 0.85, queryConfidence: 0.95 },
      }).mode,
    ).toBe("chat");
    expect(
      assessClarifyStrategy({
        query: "这个 API 的发布日期是什么",
        intentConfidence: { routeConfidence: 0.85, queryConfidence: 0.85 },
      }).mode,
    ).toBe("card");
  });

  it("clarifier 提出一问时用对话，两问时用卡片", () => {
    expect(
      assessClarifyStrategy({ query: "aaa", proposedQuestionCount: 1 }).mode,
    ).toBe("chat");
    expect(
      assessClarifyStrategy({ query: "aaa", proposedQuestionCount: 2 }).mode,
    ).toBe("card");
  });

  it("条件已明确（预算/地区/对象都在）→ none", () => {
    const s = assessClarifyStrategy({
      query: "预算 3000 元在国内买哪款手机性价比最高",
    });
    expect(s.mode).toBe("none");
  });
});

describe("findMissingBlockingSlots / isHighRiskQuery", () => {
  it("识别高风险话题", () => {
    expect(isHighRiskQuery("这个药怎么用")).toBe(true);
    expect(isHighRiskQuery("帮我做投资决策")).toBe(true);
    expect(isHighRiskQuery("今天天气如何")).toBe(false);
  });

  it("缺槽位检测", () => {
    expect(findMissingBlockingSlots("推荐一款手机")).toContain("region");
    expect(findMissingBlockingSlots("推荐一款手机")).toContain("budget");
    expect(findMissingBlockingSlots("预算 5000 元在国内买手机")).toHaveLength(0);
  });
});

describe("parseChatClarifyReply", () => {
  it("单一 pending slot 时整段回复归入该槽位", () => {
    expect(
      parseChatClarifyReply({
        promptText: "你打算给谁用？",
        userReply: "主要给管理层看",
        pendingSlots: ["audience"],
      }),
    ).toEqual({ audience: "主要给管理层看" });
  });

  it("多槽位时归入 freeform", () => {
    expect(
      parseChatClarifyReply({
        promptText: "确认一下",
        userReply: "面向技术团队，2026 年内",
        pendingSlots: ["audience", "timeframe"],
      }),
    ).toEqual({ freeform: "面向技术团队，2026 年内" });
  });

  it("跳过信号 → 空 slots", () => {
    expect(isSkipClarifyReply("直接开始")).toBe(true);
    expect(isSkipClarifyReply("你看着办")).toBe(true);
    expect(
      parseChatClarifyReply({
        promptText: "要确认吗",
        userReply: "直接开始",
        pendingSlots: ["audience"],
      }),
    ).toEqual({});
  });
});

describe("deriveResearchDepth / resolveDepthBudget", () => {
  it("开放式题 → deep；收紧事实题 → standard；多子问题 → deep", () => {
    expect(deriveResearchDepth({ query: "Transformer 核心技术演进" })).toBe("deep");
    expect(deriveResearchDepth({ query: "这个 API 的发布日期是什么" })).toBe("standard");
    expect(deriveResearchDepth({ query: "x", subQuestionCount: 4 })).toBe("deep");
  });

  it("深度预算：light 不反思不抓正文，deep 全量", () => {
    expect(resolveDepthBudget("light").allowReflect).toBe(false);
    expect(resolveDepthBudget("light").fetchFullText).toBe(false);
    expect(resolveDepthBudget("light").maxLanes).toBe(2);
    expect(resolveDepthBudget("deep").maxLanes).toBe(8);
    expect(resolveDepthBudget("deep").allowReflect).toBe(true);
  });
});

describe("plan_chat helpers", () => {
  it("buildPlanChatPrompt 含版本与开始调研引导", () => {
    const text = buildPlanChatPrompt(2);
    expect(text).toContain("v2");
    expect(text).toContain("开始调研");
  });

  it("buildPlanRevisionUserQuery 拼接对话历史与当前计划", () => {
    const q = buildPlanRevisionUserQuery({
      originalQuery: "调研向量库",
      plan: { topic: "向量库", complexity: "moderate", subQuestions: ["架构"] },
      planVersion: 1,
      chatHistory: [{ role: "user", content: "侧重性能" }],
    });
    expect(q).toContain("调研向量库");
    expect(q).toContain("侧重性能");
    expect(q).toContain("【当前计划 v1】");
    expect(q).toContain("架构");
  });

  it("parsePlanChatGateAction 区分 start / reply / skip", () => {
    expect(
      parsePlanChatGateAction({
        answers: { __plan_action__: "approve" },
      }),
    ).toBe("start");
    expect(
      parsePlanChatGateAction({
        answers: { __chat__: "侧重性能" },
      }),
    ).toBe("reply");
    expect(
      parsePlanChatGateAction({
        answers: { __chat__: "直接开始" },
      }),
    ).toBe("skip");
    expect(parsePlanChatGateAction({ answers: {}, skip: true })).toBe("skip");
  });
});

describe("buildInteractionProfile", () => {
  it("depth / clarifyMode / planVisibility 相互独立可断言", () => {
    const strategy = assessClarifyStrategy({
      query: "研究 Transformer 的核心技术演进",
      userPreference: "plan_chat",
    });
    const profile = buildInteractionProfile({
      query: "研究 Transformer 的核心技术演进",
      strategy,
      preference: "plan_chat",
    });
    expect(profile.researchDepth).toBe("deep");
    expect(profile.clarifyMode).toBe("none");
    expect(profile.planVisibility).toBe("chat_editable");
    expect(profile.clarifyBudget.maxRounds).toBe(3);
    expect(profile.clarifyBudget.allowMidRun).toBe(true);
  });

  it("none 模式记录默认范围假设", () => {
    const strategy = assessClarifyStrategy({ query: "这个 API 的发布日期是什么" });
    const profile = buildInteractionProfile({
      query: "这个 API 的发布日期是什么",
      strategy,
    });
    expect(profile.clarifyMode).toBe("none");
    expect(profile.assumptions.length).toBeGreaterThan(0);
    expect(profile.planVisibility).toBe("hidden");
  });
});
