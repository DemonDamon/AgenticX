/**
 * 模型名启发式上下文窗口 —— 与 agenticx/runtime/model_context_window.py 镜像。
 *
 * 后端是唯一权威；这里存在只是为了在填写界面上把「自动」会解析成多少显示出来，
 * 否则用户没法判断该不该覆盖。两边一旦走偏由 model-context-window-parity 测试拦下。
 */

/** 有序表：按子串匹配，先命中者胜。 */
export const MODEL_CONTEXT_WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ["claude-opus-4", 200_000],
  ["claude-sonnet-5", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude", 200_000],
  ["gpt-5", 256_000],
  ["gpt-4o", 128_000],
  ["gpt-4", 128_000],
  ["o1", 200_000],
  ["o3", 200_000],
  ["deepseek", 128_000],
  ["qwen", 128_000],
  ["glm-5.2", 1_000_000],
  ["glm-5.1", 200_000],
  ["glm", 128_000],
  ["kimi", 256_000],
  ["minimax", 192_000],
  ["gemini-2.5", 1_048_576],
  ["gemini", 1_000_000],
];

export const DEFAULT_CONTEXT_WINDOW = 128_000;

const NAME_WINDOW_RE = /[-_](\d+)(k|m)(?![a-z0-9])/;

/** 模型名里显式写明的窗口（`-8k` / `-1m`）；k 按 1000 折算，取保守一侧。 */
export function parseContextWindowFromName(modelName: string): number | undefined {
  const match = NAME_WINDOW_RE.exec((modelName || "").toLowerCase());
  if (!match) return undefined;
  const digits = Number(match[1]);
  if (!Number.isFinite(digits)) return undefined;
  const value = digits * (match[2] === "k" ? 1_000 : 1_000_000);
  if (value < 4_000 || value > 10_000_000) return undefined;
  return value;
}

/** 未声明时后端会用的窗口：名字后缀 → 前缀表 → 默认值。 */
export function resolveHeuristicContextWindow(modelName: string): number {
  const fromName = parseContextWindowFromName(modelName);
  if (fromName !== undefined) return fromName;
  const name = (modelName || "").toLowerCase();
  for (const [key, window] of MODEL_CONTEXT_WINDOWS) {
    if (name.includes(key)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** 面板占位符用：128000 → "128K"，1000000 → "1M"。 */
export function formatContextWindowShort(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  const k = tokens / 1_000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}
