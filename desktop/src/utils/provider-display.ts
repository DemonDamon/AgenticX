/** 内置厂商展示名（配置 key 仍为英文 id）；自定义厂商用 entry.displayName */

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  volcengine: "火山引擎",
  bailian: "阿里云百炼",
  zhipu: "智谱开放平台",
  qianfan: "百度千帆",
  minimax: "MiniMax",
  kimi: "月之暗面",
  ollama: "Ollama",
};

export type ProviderDisplayEntry = {
  displayName?: string;
  baseUrl?: string;
  interface?: "openai";
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

/** Official OpenAI API bases — anything else on the built-in openai provider is a proxy/gateway. */
export function isOfficialOpenAIBase(baseUrl: string): boolean {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return true;
  return base === "https://api.openai.com" || base === "https://api.openai.com/v1";
}

export function getProviderDisplayName(
  providerId: string,
  entry?: ProviderDisplayEntry | null,
): string {
  const custom = entry?.displayName?.trim();
  if (custom) return custom;
  if (providerId === "openai") {
    const baseUrl = (entry?.baseUrl ?? "").trim();
    if (baseUrl && !isOfficialOpenAIBase(baseUrl)) {
      return "OpenAI 兼容";
    }
  }
  return PROVIDER_DISPLAY_NAME[providerId] ?? providerId;
}

/** 生成自定义 OpenAI 范式厂商的配置 id，避免与已有 key 冲突 */
export function makeCustomOpenAIProviderId(displayName: string, existingKeys: string[]): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  const base = slug ? `custom_openai_${slug}` : `custom_openai_${Date.now()}`;
  const set = new Set(existingKeys);
  let id = base;
  let n = 0;
  while (set.has(id)) {
    n += 1;
    id = `${base}_${n}`;
  }
  return id;
}
