/**
 * Deep-research interaction policy: decouple "how much work" (researchDepth)
 * from "should we ask the user" (clarify mode/phase) and "is the plan visible".
 *
 * Deterministic rules own the boundaries (max questions, risk overrides,
 * default assumptions); the LLM clarifier only proposes question candidates.
 * No raw prompt / answer text is logged — only reason codes.
 */

import { defaultFocusOptions, looksOpenEndedResearchQuery } from "./research-intent";
import type { ClarifyQuestion } from "./clarifier";
import {
  MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
  type DeepResearchIntentConfidence,
} from "./clarification-policy";

export type ClarifyMode = "card" | "chat" | "none";
export type ClarifyPhase = "preflight" | "midrun";
export type ResearchDepth = "light" | "standard" | "deep";
/** `editable` kept for legacy events; new「计划对齐」uses `chat_editable`. */
export type PlanVisibility = "hidden" | "preview" | "editable" | "chat_editable";

export type ClarifyUserPreference =
  | "auto"
  | "direct"
  | "card_first"
  | "plan_chat";

export type ClarifyBudget = {
  /** 一轮 deep research 内允许的最大澄清次数（含启动前 + 运行中）。默认 3。 */
  maxRounds: number;
  /** 当前已用轮次 */
  usedRounds: number;
  /** 是否允许运行中补充澄清 */
  allowMidRun: boolean;
};

export type ClarifyStrategy = {
  mode: ClarifyMode;
  phase: ClarifyPhase;
  /** true = 高风险缺关键槽位，用户「直接开始」也不能静默绕过 */
  blocking: boolean;
  /** 本阶段最多呈现几个问题/几段引导语（≤2） */
  maxItems: number;
  reasonCodes: string[];
};

export type ResearchInteractionProfile = {
  researchDepth: ResearchDepth;
  clarifyMode: ClarifyMode;
  clarifyBudget: { maxRounds: number; allowMidRun: boolean };
  planVisibility: PlanVisibility;
  assumptions: string[];
};

export const DEFAULT_CLARIFY_MAX_ROUNDS = 3;
export const MAX_CLARIFY_ITEMS_PER_ROUND = 2;

/**
 * 高风险话题：错误结论代价高（医疗/法律/投资/重大决策）。
 * 命中后 clarify 为 blocking（required），即使用户偏好「直接开始」也要先问关键约束。
 */
const HIGH_RISK_RE =
  /(医疗|诊断|用药|药品|吃药|这个药|治疗|病历|医院|法律|诉讼|仲裁|合同条款|合规|投资|理财|股票|基金|买房|贷款|移民|签证|战略建议|战略咨询|商业决策|投资决策)/i;

/** 缺关键约束时会显著改变结论的槽位信号（问题中未给出对应信息）。 */
const SLOT_HINTS: Array<{ slot: string; ask: RegExp; missing: RegExp }> = [
  { slot: "region", ask: /(推荐|选购|买|价格|比价|优惠)/i, missing: /(国内|中国|美国|欧洲|日本|香港|地区|城市)/i },
  { slot: "budget", ask: /(推荐|选购|买哪款|性价比)/i, missing: /(预算|元|块|万|千|\$\d|\d+\s?k)/i },
  { slot: "audience", ask: /(战略|规划|建议|方案|报告)/i, missing: /(给|面向|针对|受众|管理层|技术团队|客户)/i },
  { slot: "timeframe", ask: /(趋势|演进|对比|预测|战略|规划)/i, missing: /(\d{4}|今年|明年|近\d|过去|未来|季度|年度)/i },
];

/** 用户回复中的「直接开始/你看着办」类跳过信号。 */
const SKIP_REPLY_RE =
  /^(直接开始|你看着办|都可以|随便|不用问了|开始吧|不用|算了|跳过|skip|go ahead|just start|start)\s*[。！!]?$/i;

export function isHighRiskQuery(query: string): boolean {
  return HIGH_RISK_RE.test(query);
}

/** 找出会显著改变结论、且用户未提供的阻塞槽位。 */
export function findMissingBlockingSlots(query: string): string[] {
  const missing: string[] = [];
  for (const hint of SLOT_HINTS) {
    if (hint.ask.test(query) && !hint.missing.test(query)) missing.push(hint.slot);
  }
  return missing;
}

function normalizePreference(raw: unknown): ClarifyUserPreference {
  switch (raw) {
    case "direct":
    case "card_first":
    case "plan_chat":
      return raw;
    // Legacy prefs merged into「计划对齐」.
    case "chat_first":
    case "plan_first":
      return "plan_chat";
    default:
      return "auto";
  }
}

/**
 * 决定本轮 deep research 的澄清形态。
 *
 * 规则（确定性，不看 LLM）：
 * - 收紧的单一事实题（非开放式）→ none，不打扰；
 * - 高风险 + 缺关键槽位 → blocking 澄清，按偏好选 card/chat（默认 card）；
 * - 用户偏好 direct 且非高风险 → none；
 * - 用户偏好 plan_chat → none（计划对齐走 plan gate，不走 clarify）；
 * - 用户偏好 card_first → card；高风险缺槽 → card blocking；
 * - auto：一个缺口用对话确认，两个及以上缺口用结构化卡片；无缺口且高置信度直跑。
 */
export function assessClarifyStrategy(input: {
  query: string;
  reconBrief?: string;
  userPreference?: ClarifyUserPreference | string;
  conversationHistory?: Array<{ role: string; content: string }>;
  /** Existing semantic router confidence; low dimensions count as unresolved intent signals. */
  intentConfidence?: DeepResearchIntentConfidence;
  /** Number of high-value questions proposed by the bounded clarifier. */
  proposedQuestionCount?: number;
}): ClarifyStrategy {
  const query = input.query.trim();
  const preference = normalizePreference(input.userPreference);
  const reasonCodes: string[] = [];

  const openEnded = looksOpenEndedResearchQuery(query);
  const highRisk = isHighRiskQuery(query);
  const missingSlots = findMissingBlockingSlots(query);
  const lowConfidenceDimensions = input.intentConfidence
    ? [
        input.intentConfidence.routeConfidence < MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
        input.intentConfidence.queryConfidence < MIN_TRUSTED_CLARIFICATION_CONFIDENCE,
      ].filter(Boolean).length
    : 0;
  const proposedQuestionCount = Math.max(
    0,
    Math.min(
      MAX_CLARIFY_ITEMS_PER_ROUND,
      Number.isFinite(input.proposedQuestionCount)
        ? Math.trunc(input.proposedQuestionCount ?? 0)
        : 0,
    ),
  );
  const unresolvedCount = Math.max(
    missingSlots.length,
    proposedQuestionCount,
    lowConfidenceDimensions,
  );
  if (highRisk) reasonCodes.push("high_risk");
  if (missingSlots.length > 0) reasonCodes.push(`missing_slots:${missingSlots.join("+")}`);
  if (lowConfidenceDimensions > 0) {
    reasonCodes.push(`low_confidence:${lowConfidenceDimensions}`);
  }
  if (proposedQuestionCount > 0) {
    reasonCodes.push(`clarifier_questions:${proposedQuestionCount}`);
  }
  if (openEnded) reasonCodes.push("open_ended");
  if (preference !== "auto") reasonCodes.push(`pref:${preference}`);

  // 0) 计划对齐：不走 clarify gate，由 planVisibility=chat_editable 驱动多轮改计划。
  if (preference === "plan_chat") {
    return {
      mode: "none",
      phase: "preflight",
      blocking: false,
      maxItems: 0,
      reasonCodes: [...reasonCodes, "plan_chat"],
    };
  }

  // 1) 收紧的单一事实题：长 prompt 也不误触发澄清。
  // 仅当用户未明确选偏好（auto）时才走确定性快速通道——明确选了
  // card_first 的用户即使问事实题也应尊重其偏好先对齐一次。
  if (
    preference === "auto" &&
    !openEnded &&
    !highRisk &&
    missingSlots.length === 0 &&
    lowConfidenceDimensions === 0 &&
    proposedQuestionCount === 0
  ) {
    reasonCodes.push("narrow_factual");
    return { mode: "none", phase: "preflight", blocking: false, maxItems: 0, reasonCodes };
  }

  // 2) 高风险且缺关键槽位：必须澄清，「直接开始」不能静默绕过。
  if (highRisk && missingSlots.length > 0) {
    return {
      mode: "card",
      phase: "preflight",
      blocking: true,
      maxItems: Math.min(missingSlots.length, MAX_CLARIFY_ITEMS_PER_ROUND),
      reasonCodes: [...reasonCodes, "required"],
    };
  }

  // 3) 条件已明确的具体任务（带预算/地区/时间等硬约束且不缺口径）→ none。
  // 长度启发式会把这类短句误判成开放式；确定性约束信号优先。
  // 同样仅对 auto 生效——明确选 card_first 的用户应被尊重。
  const hasConcreteConstraints =
    /(预算|\d+\s*(元|块|万|千)|国内|中国|美国|欧洲|日本|\d{4}\s*[-–—年])/.test(query);
  if (
    preference === "auto" &&
    !highRisk &&
    missingSlots.length === 0 &&
    hasConcreteConstraints
  ) {
    reasonCodes.push("well_specified");
    return { mode: "none", phase: "preflight", blocking: false, maxItems: 0, reasonCodes };
  }

  // 4) 用户明确「直接开始」且非高风险：按默认假设直接跑。
  if (preference === "direct") {
    reasonCodes.push("direct_override");
    return { mode: "none", phase: "preflight", blocking: false, maxItems: 0, reasonCodes };
  }

  // 5) 明确偏好 card_first：无条件尊重，非阻塞。
  // 即使 query 极短（"aaa"）或看起来像事实题，用户既然选了「卡片确认」
  // 就应当先对齐一次，而不是静默直跑。
  if (preference === "card_first") {
    return {
      mode: "card",
      phase: "preflight",
      blocking: false,
      maxItems: MAX_CLARIFY_ITEMS_PER_ROUND,
      reasonCodes: [...reasonCodes, "optional", `pref:${preference}`],
    };
  }

  // 6) auto 下按缺失信息量选择交互：一个关键缺口用对话，多个缺口用卡片。
  if (openEnded || unresolvedCount > 0) {
    const effectiveCount = Math.max(1, unresolvedCount);
    const mode: ClarifyMode = effectiveCount >= 2 ? "card" : "chat";
    return {
      mode,
      phase: "preflight",
      blocking: false,
      maxItems: Math.min(effectiveCount, MAX_CLARIFY_ITEMS_PER_ROUND),
      reasonCodes: [
        ...reasonCodes,
        "optional",
        mode === "chat" ? "single_gap_chat" : "multi_gap_card",
      ],
    };
  }

  return { mode: "none", phase: "preflight", blocking: false, maxItems: 0, reasonCodes };
}

/** 对话式澄清的用户回复是否为「直接开始/跳过」信号。 */
export function isSkipClarifyReply(userReply: string): boolean {
  return SKIP_REPLY_RE.test(userReply.trim());
}

/**
 * 把对话式澄清的自然语言回复解析成结构化槽位。
 *
 * 后端只认「澄清轮次 + 结构化槽位」，不认 UI 形态：chat 与 card 最终都落成
 * 同一组 slots 供 planner 消费。确定性解析只能保守处理——整段回复作为
 * freeform 槽位保留，由 planner prompt 直接阅读，不做脆弱的字段猜测。
 */
export function parseChatClarifyReply(input: {
  promptText: string;
  userReply: string;
  pendingSlots: string[];
}): Record<string, string> {
  const reply = input.userReply.trim();
  if (!reply || isSkipClarifyReply(reply)) return {};
  const slots: Record<string, string> = {};
  const pending = input.pendingSlots.filter((s) => s.trim());
  if (pending.length === 1) {
    slots[pending[0]!] = reply;
  } else {
    slots.freeform = reply;
  }
  return slots;
}

/**
 * 研究深度 = 「这次要投入多少工作」，与「要不要澄清」完全解耦。
 * 收紧事实题 → light；开放式/多维对比/演进/战略 → deep；其余 → standard。
 */
export function deriveResearchDepth(input: {
  query: string;
  subQuestionCount?: number;
}): ResearchDepth {
  const query = input.query.trim();
  if (!query) return "standard";
  if (looksOpenEndedResearchQuery(query)) return "deep";
  if ((input.subQuestionCount ?? 0) >= 4) return "deep";
  if (/(对比|比较|选型|演进|趋势|综述|全面|盘点)/.test(query)) return "deep";
  return "standard";
}

/** 深度 → 运行预算。只控制目标上限，不突破总预算/租户配额。 */
export type DepthBudget = {
  maxLanes: number;
  /** 每车道结果数上限（仍受 resolveResultsPerLane 下限约束） */
  resultsPerLaneCap: number;
  allowReflect: boolean;
  /** light 模式跳过正文抓取，只用 snippet，快速交付 */
  fetchFullText: boolean;
};

export function resolveDepthBudget(depth: ResearchDepth): DepthBudget {
  switch (depth) {
    case "light":
      return { maxLanes: 2, resultsPerLaneCap: 4, allowReflect: false, fetchFullText: false };
    case "deep":
      return { maxLanes: 8, resultsPerLaneCap: 10, allowReflect: true, fetchFullText: true };
    case "standard":
      return { maxLanes: 4, resultsPerLaneCap: 6, allowReflect: true, fetchFullText: true };
  }
}

/** 汇总运行级 profile（research_profile 事件负载）。 */
export function buildInteractionProfile(input: {
  query: string;
  preference?: ClarifyUserPreference | string;
  strategy: ClarifyStrategy;
  subQuestionCount?: number;
}): ResearchInteractionProfile {
  const preference = normalizePreference(input.preference);
  const researchDepth = deriveResearchDepth({
    query: input.query,
    subQuestionCount: input.subQuestionCount,
  });
  const planVisibility: PlanVisibility =
    preference === "plan_chat" ? "chat_editable" : "hidden";
  const assumptions: string[] = [];
  if (preference === "plan_chat") {
    assumptions.push("计划可经多轮对话调整；未修改则按当前草案执行。");
  } else if (input.strategy.mode === "none") {
    assumptions.push("按默认范围研究：未限定地域、时间与受众，以公开通用信息为准。");
  } else if (!input.strategy.blocking) {
    assumptions.push("若未补充方向偏好，将按默认研究面展开。");
  }
  return {
    researchDepth,
    clarifyMode: input.strategy.mode,
    clarifyBudget: {
      maxRounds: DEFAULT_CLARIFY_MAX_ROUNDS,
      allowMidRun: true,
    },
    planVisibility,
    assumptions,
  };
}

/** 阻塞槽位 → 高价值澄清题（确定性，不依赖 LLM）。 */
const SLOT_QUESTION_BANK: Record<string, { question: string; options: string[] }> = {
  region: {
    question: "调研结论主要适用于哪个地区/市场？",
    options: ["国内（中国大陆）", "海外主要市场", "全球范围"],
  },
  budget: {
    question: "预算大致在什么范围？",
    options: ["入门/经济型", "中端主流", "高端/不限"],
  },
  audience: {
    question: "调研结果主要给谁看、用来做什么？",
    options: ["管理层决策参考", "技术团队选型/落地", "个人了解与学习"],
  },
  timeframe: {
    question: "关注的时间范围？",
    options: ["近一年", "近 3–5 年", "长期趋势"],
  },
};

/**
 * 高风险且 LLM 候选为空时的确定性兜底：只问会改变结论的阻塞槽位，
 * 最多 maxItems 道。
 */
export function buildSlotClarifyQuestions(query: string, maxItems: number): ClarifyQuestion[] {
  const missing = findMissingBlockingSlots(query);
  const questions: ClarifyQuestion[] = [];
  for (const slot of missing) {
    const bank = SLOT_QUESTION_BANK[slot];
    if (!bank) continue;
    questions.push({
      id: `q_slot_${slot}`,
      question: bank.question,
      options: bank.options.map((label, index) => ({ id: `o${index + 1}`, label })),
      allowCustom: true,
      multiSelect: false,
    });
    if (questions.length >= maxItems) break;
  }
  return questions;
}

/**
 * 对话式澄清的自然语言引导：像 Gemini 那样列出「我打算这么做」的点，
 * 用户直接回复即可；也可以说「直接开始」按默认范围跑。
 */
export function buildChatClarifyPrompt(query: string, strategy: ClarifyStrategy): string {
  const missing = findMissingBlockingSlots(query);
  const lines: string[] = [
    "开始系统调研前，先和你快速对齐一下（直接回复即可；也可以说「直接开始」，我就按默认范围跑）：",
  ];
  let n = 0;
  for (const slot of missing.slice(0, strategy.maxItems)) {
    const bank = SLOT_QUESTION_BANK[slot];
    if (!bank) continue;
    n += 1;
    lines.push(`${n}. ${bank.question}（如：${bank.options.join(" / ")}）`);
  }
  if (n === 0) {
    const options = defaultFocusOptions(query)
      .map((o) => o.label)
      .join(" / ");
    n += 1;
    lines.push(`${n}. 你更想了解哪些方向？比如：${options}`);
  }
  if (n < strategy.maxItems) {
    lines.push(`${n + 1}. 对地域、时间范围或受众有没有限定？（没有可跳过）`);
  }
  return lines.join("\n");
}

/** 计划对齐卡下方的对话引导文案（仿 Gemini「方案更新完毕…」）。 */
export function buildPlanChatPrompt(planVersion: number): string {
  return [
    `方案已就绪（当前计划 v${Math.max(1, planVersion)}）。如需修改可直接回复，例如：侧重 X / 增加 Y 方向 / 去掉 Z；`,
    "也可以说「直接开始」或点「开始调研」。",
  ].join("");
}

export type PlanChatTurn = { role: "user" | "assistant"; content: string };

/** 把「原 query + 对话历史 + 当前计划」拼成 planner 入参。 */
export function buildPlanRevisionUserQuery(input: {
  originalQuery: string;
  plan: { topic: string; complexity: string; subQuestions: string[] };
  planVersion: number;
  chatHistory: PlanChatTurn[];
}): string {
  const history = input.chatHistory
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? "用户" : "助手"}: ${turn.content.trim()}`)
    .filter((line) => line.length > 3)
    .join("\n");
  return [
    input.originalQuery.trim(),
    "",
    "【计划对话】",
    history || "（无）",
    "",
    `【当前计划 v${input.planVersion}】`,
    JSON.stringify({
      topic: input.plan.topic,
      complexity: input.plan.complexity,
      sub_questions: input.plan.subQuestions,
    }),
    "",
    "请根据用户最新修改意见，输出更新后的完整研究计划 JSON（topic/complexity/sub_questions）。保持合理广度，不要塌缩成单点。",
  ].join("\n");
}

export type PlanChatGateAction = "start" | "reply" | "skip";

/**
 * 解析计划对齐 gate 的 resume：approve/skip 按钮、跳过口语、或自然语言改计划。
 * `PLAN_GATE_ACTION_KEY` / `CHAT_CLARIFY_ANSWER_KEY` 由调用方从 answers 传入。
 */
export function parsePlanChatGateAction(input: {
  answers: Record<string, string>;
  skip?: boolean;
  planActionKey?: string;
  chatAnswerKey?: string;
}): PlanChatGateAction {
  if (input.skip) return "skip";
  const planKey = input.planActionKey ?? "__plan_action__";
  const chatKey = input.chatAnswerKey ?? "__chat__";
  const planAction = input.answers[planKey]?.trim() ?? "";
  if (planAction === "skip") return "skip";
  if (planAction === "approve") return "start";
  const chat = input.answers[chatKey]?.trim() ?? "";
  if (chat && isSkipClarifyReply(chat)) return "skip";
  if (chat) return "reply";
  return "start";
}
