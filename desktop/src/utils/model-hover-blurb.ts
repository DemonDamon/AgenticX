import { normalizeBareModelId } from "./model-display";
import { isKnownNonVisionChatModel } from "./model-vision";

export type ModelHoverBlurb = {
  title: string;
  description: string;
  /** Bottom meta row — real product info only, never invent consumption multipliers. */
  metaLabel: string;
  metaValue: string;
  /** True when this SKU accepts Moonshot K3 `reasoning_effort` (low/high/max). */
  supportsReasoningEffort: boolean;
  /** True when this SKU accepts DeepSeek V4 thinking switch + high/max effort. */
  supportsDeepSeekThinking: boolean;
};

/** Kimi K3 top-level `reasoning_effort` values (Moonshot API). */
export type KimiReasoningEffort = "low" | "high" | "max";

export const KIMI_REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: KimiReasoningEffort;
  label: string;
}> = [
  { value: "low", label: "低" },
  { value: "high", label: "高" },
  { value: "max", label: "最大" },
];

export const DEFAULT_KIMI_REASONING_EFFORT: KimiReasoningEffort = "max";

/** Normalize bare model id then detect Kimi K3 family (always-on thinking + reasoning_effort). */
export function supportsKimiK3ReasoningEffort(model: string): boolean {
  const bare = normalizeBareModelId(model).toLowerCase();
  return bare === "kimi-k3" || bare.startsWith("kimi-k3-") || bare.startsWith("kimi-k3.");
}

export function normalizeKimiReasoningEffort(raw: unknown): KimiReasoningEffort {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "low" || v === "high" || v === "max") return v;
  return DEFAULT_KIMI_REASONING_EFFORT;
}

export function labelForKimiReasoningEffort(effort: KimiReasoningEffort): string {
  return KIMI_REASONING_EFFORT_OPTIONS.find((o) => o.value === effort)?.label ?? "最大";
}

/** DeepSeek V4 Chat Completions `reasoning_effort` when thinking is on (high/max). */
export type DeepSeekReasoningEffort = "high" | "max";

export const DEEPSEEK_REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: DeepSeekReasoningEffort;
  label: string;
}> = [
  { value: "high", label: "高" },
  { value: "max", label: "超高" },
];

export const DEFAULT_DEEPSEEK_REASONING_EFFORT: DeepSeekReasoningEffort = "high";

export function supportsDeepSeekV4Thinking(model: string): boolean {
  return normalizeBareModelId(model).toLowerCase().startsWith("deepseek-v4");
}

export function normalizeDeepSeekReasoningEffort(raw: unknown): DeepSeekReasoningEffort {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "high" || v === "max") return v;
  return DEFAULT_DEEPSEEK_REASONING_EFFORT;
}

export function labelForDeepSeekReasoningEffort(effort: DeepSeekReasoningEffort): string {
  return DEEPSEEK_REASONING_EFFORT_OPTIONS.find((o) => o.value === effort)?.label ?? "高";
}

type CuratedRule = {
  /** Match against lowercased bare model id. */
  test: (lower: string) => boolean;
  description: string;
};

/**
 * Curated one-liners for well-known SKUs. Prefer distinctive strengths over
 * generic「适合日常任务」filler. Order matters — first match wins.
 */
const CURATED_BLURBS: CuratedRule[] = [
  {
    test: (m) => m === "kimi-k3" || m.startsWith("kimi-k3-") || m.startsWith("kimi-k3."),
    description:
      "擅长处理复杂的长程自主任务，前端开发能力突出，同时在知识工作与科研推理上表现出色",
  },
  {
    test: (m) => m.includes("kimi-k2.7-code") || m.includes("kimi-k2.7_code"),
    description: "编程专用：长上下文更稳地遵从指令，代码任务成功率更高",
  },
  {
    test: (m) => m.includes("kimi-k2.6"),
    description: "多模态通用模型，Agent / 代码 / 视觉理解均衡，支持思考开关",
  },
  {
    test: (m) => m.includes("kimi-k2.5"),
    description: "多模态 Agent 与代码能力突出，支持思考与非思考模式",
  },
  {
    test: (m) => /minimax[-_]?m3\b/.test(m) || m === "m3" || m.endsWith("/m3"),
    description: "原生多模态，擅长代码、智能体任务，支持百万级上下文",
  },
  {
    test: (m) => /minimax[-_]?m2\.7/.test(m) || /minimax[-_]?m2\b/.test(m),
    description: "偏代码与智能体协作，工具调用与工程任务表现稳定",
  },
  {
    test: (m) => /^glm-5(\.|$|-)/.test(m) || m.includes("glm-5."),
    description: "偏编程与复杂工程任务，长链条工具调用表现突出",
  },
  {
    test: (m) => /^glm-4\.7/.test(m) || m.includes("glm-4.7"),
    description: "综合对话与工具调用均衡，适合工程辅助与知识问答",
  },
  {
    test: (m) => m.startsWith("deepseek-v4") || m.includes("deepseek-v4"),
    description: "DeepSeek 旗舰模型，支持 1M 上下文窗口",
  },
  {
    test: (m) => m.includes("deepseek-r1") || m.includes("deepseek-reasoner"),
    description: "强推理模型，擅长数学、逻辑与分步推导",
  },
  {
    test: (m) => m.includes("deepseek-v3") || m.includes("deepseek-chat"),
    description: "高性价比通用对话，代码与中文任务表现稳定",
  },
  {
    test: (m) => m.includes("claude-opus") || m.includes("opus-4"),
    description: "顶配综合智能，长文写作、复杂规划与代码审查出色",
  },
  {
    test: (m) => m.includes("claude-sonnet"),
    description: "均衡的代码与 Agent 执行力，响应质量稳定",
  },
  {
    test: (m) => m.includes("claude-haiku"),
    description: "低延迟轻量对话，适合快速问答与简单改写",
  },
  {
    test: (m) => /\bgpt-5\b/.test(m) || m.includes("gpt-5."),
    description: "新一代综合能力，复杂任务分解与工具使用表现强",
  },
  {
    test: (m) => m.includes("o3") || m.includes("o4-mini") || /\bo1\b/.test(m),
    description: "偏深度推理与难题拆解，适合数学与多步分析",
  },
  {
    test: (m) => m.includes("gpt-4o") || m.includes("gpt-4.1"),
    description: "多模态通用对话，图文理解与工具调用成熟",
  },
  {
    test: (m) => m.includes("qwen3") || m.includes("qwen2.5") || m.startsWith("qwen"),
    description: "中文与代码均衡，开源生态工具链兼容性好",
  },
  {
    test: (m) => m.includes("doubao") || m.includes("seed-"),
    description: "中文对话流畅，适合办公助手与内容生成",
  },
  {
    test: (m) => m.includes("gemini"),
    description: "多模态与长上下文见长，适合跨文档综合分析",
  },
  {
    test: (m) => m.includes("codestral") || m.includes("devstral") || m.includes("coder"),
    description: "偏代码补全与工程改造，适合仓库级编程任务",
  },
];

function heuristicDescription(provider: string, model: string, lower: string): string {
  const textOnly = isKnownNonVisionChatModel(provider, model);
  if (/code|coder|codestral|devstral/.test(lower)) {
    return "偏代码与工程任务的对话模型";
  }
  if (/reason|r1|thinking|\bo1\b|\bo3\b|\bo4\b/.test(lower)) {
    return "偏复杂推理与长链条分析";
  }
  if (/vl|vision|omni|multimodal|4v|5v/.test(lower)) {
    return "多模态模型，擅长图文理解与跨模态任务";
  }
  if (textOnly) {
    return "文本对话模型，适合写作、问答与轻量分析";
  }
  return "通用对话模型，能力因服务商配置而异";
}

/** Short hover copy for the model picker tip card. */
export function describeModelForPicker(
  provider: string,
  model: string,
  providerLabel: string,
): ModelHoverBlurb {
  const title = normalizeBareModelId(model) || model.trim() || "未命名模型";
  const lower = title.toLowerCase();
  const curated = CURATED_BLURBS.find((rule) => rule.test(lower));
  const description = curated?.description ?? heuristicDescription(provider, model, lower);

  return {
    title,
    description,
    metaLabel: "服务渠道",
    metaValue: (providerLabel || "").trim() || provider,
    supportsReasoningEffort: supportsKimiK3ReasoningEffort(model),
    supportsDeepSeekThinking: supportsDeepSeekV4Thinking(model),
  };
}
