/**
 * 模型上下文窗口：管理员声明值的校验，以及从上游 /models 响应中探测真实窗口。
 *
 * 管理员未填写时该字段为 undefined，由 Desktop 运行时按模型名启发式兜底；
 * 这里只负责「拿到可信数字」和「拒绝不可信数字」。
 */

/** 低于此值连系统提示词都放不下，视为填错。 */
export const MIN_MODEL_CONTEXT_WINDOW = 4_000;
/** 预留到 Gemini 级别之上，避免拦住后续的长窗口模型。 */
export const MAX_MODEL_CONTEXT_WINDOW = 10_000_000;

/** 归一化管理员输入 / 上游探测值；不可信一律返回 undefined（= 交给运行时兜底）。 */
export function normalizeContextWindow(value: unknown): number | undefined {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n < MIN_MODEL_CONTEXT_WINDOW || n > MAX_MODEL_CONTEXT_WINDOW) return undefined;
  return n;
}

/**
 * 上游 /models 行里的窗口字段。各家命名不统一：
 * - vLLM / SGLang：max_model_len（自部署场景最权威的值，由 --max-model-len 决定）
 * - OpenRouter / Together：context_length
 * - LiteLLM 代理：model_info.max_input_tokens
 */
const UPSTREAM_WINDOW_KEYS = [
  "max_model_len",
  "context_length",
  "max_context_length",
  "context_window",
  "max_input_tokens",
] as const;

function pickWindow(source: Record<string, unknown>): number | undefined {
  for (const key of UPSTREAM_WINDOW_KEYS) {
    const found = normalizeContextWindow(source[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 从单个 /models 数据行里提取上下文窗口；取不到返回 undefined。 */
export function extractUpstreamContextWindow(row: Record<string, unknown>): number | undefined {
  const top = pickWindow(row);
  if (top !== undefined) return top;
  const info = row.model_info;
  if (info && typeof info === "object" && !Array.isArray(info)) {
    return pickWindow(info as Record<string, unknown>);
  }
  return undefined;
}

/** Ollama /api/show 的 model_info 用 "<arch>.context_length" 作键，架构名不固定。 */
export function extractOllamaContextWindow(payload: Record<string, unknown>): number | undefined {
  const info = payload.model_info;
  if (!info || typeof info !== "object" || Array.isArray(info)) return undefined;
  for (const [key, value] of Object.entries(info as Record<string, unknown>)) {
    if (!key.endsWith(".context_length")) continue;
    const found = normalizeContextWindow(value);
    if (found !== undefined) return found;
  }
  return undefined;
}
