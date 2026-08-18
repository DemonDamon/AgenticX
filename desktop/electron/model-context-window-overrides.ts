/**
 * 开发者菜单的按模型上下文窗口覆盖值（本机配置，键为 `provider/model`）。
 *
 * 企业目录已经声明窗口的模型不走这里 —— 那条路由管理员在后台统一管理。
 * 这里解决的是自配置厂商 / 本地自部署端点：模型名启发式猜不准，
 * 又没有企业后台可填。猜高会让压缩触发得太晚直接撞上游 400，所以
 * 非法值一律丢弃回落到启发式，而不是写进配置里。
 */

export const MIN_MODEL_CONTEXT_WINDOW = 4_000;
export const MAX_MODEL_CONTEXT_WINDOW = 10_000_000;

export type ModelContextWindowOverrides = Record<string, number>;

/** 请求实际使用的 provider + model 拼成的配置键。 */
export function modelContextWindowKey(provider: string, model: string): string {
  const p = String(provider ?? "").trim();
  const m = String(model ?? "").trim();
  if (!p || !m) return "";
  return `${p}/${m}`;
}

function normalizeWindow(value: unknown): number | undefined {
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

/** 清洗任意来源的覆盖表：丢掉空键和不可用数值，永远返回一个新对象。 */
export function sanitizeModelContextWindowOverrides(value: unknown): ModelContextWindowOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ModelContextWindowOverrides = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey ?? "").trim();
    if (!key) continue;
    const window = normalizeWindow(rawValue);
    if (window === undefined) continue;
    out[key] = window;
  }
  return out;
}
