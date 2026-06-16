/** 内置厂商展示名（配置 key 仍为英文 id）；自定义厂商用 entry.displayName */

const BUILTIN_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "volcengine",
  "bailian",
  "zhipu",
  "qianfan",
  "minimax",
  "kimi",
  "ollama",
]);

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

export type ProviderInterfaceKind = "openai" | "ollama";

export type ProviderDisplayEntry = {
  displayName?: string;
  baseUrl?: string;
  interface?: ProviderInterfaceKind;
};

/** Built-in or custom vendor that uses Ollama native API (/api/chat, /api/tags). */
export function isOllamaLikeProvider(
  providerId: string,
  entry?: Pick<ProviderDisplayEntry, "interface"> | null,
): boolean {
  return (
    providerId === "ollama"
    || providerId.startsWith("custom_ollama_")
    || entry?.interface === "ollama"
  );
}

/** OpenAI-compatible gateways need /v1; Ollama must not. */
export function providerUsesOpenAiV1BaseUrl(
  providerId: string,
  entry?: Pick<ProviderDisplayEntry, "interface"> | null,
): boolean {
  return !isOllamaLikeProvider(providerId, entry);
}

export function normalizeProviderBaseUrlForSave(
  providerId: string,
  baseUrl: string,
  entry?: Pick<ProviderDisplayEntry, "interface"> | null,
): string {
  const b = baseUrl.trim().replace(/\/+$/, "");
  if (!b) return b;
  if (!providerUsesOpenAiV1BaseUrl(providerId, entry)) {
    return b.replace(/\/v\d+$/i, "");
  }
  return /\/v\d(\/|$)/.test(b) ? b : `${b}/v1`;
}

export function previewProviderApiEndpoint(
  providerId: string,
  baseUrl: string,
  entry?: Pick<ProviderDisplayEntry, "interface"> | null,
): string {
  const b = baseUrl.trim().replace(/\/+$/, "");
  if (!b) return "";
  if (isOllamaLikeProvider(providerId, entry)) {
    const clean = b.replace(/\/v\d+$/i, "");
    return `${clean}/api/chat`;
  }
  const base = /\/v\d(\/|$)/.test(b) ? b : `${b}/v1`;
  return `${base}/chat/completions`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

/** Official OpenAI API bases — anything else on the built-in openai provider is a proxy/gateway. */
export function isOfficialOpenAIBase(baseUrl: string): boolean {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return true;
  return base === "https://api.openai.com" || base === "https://api.openai.com/v1";
}

/** 是否允许用户自定义侧栏/标题展示名（写入 display_name，不改配置 id）。 */
export function isProviderDisplayNameEditable(
  providerId: string,
  entry?: ProviderDisplayEntry | null,
): boolean {
  if (
    providerId.startsWith("custom_openai_")
    || providerId.startsWith("custom_ollama_")
    || entry?.interface === "openai"
    || entry?.interface === "ollama"
  ) {
    return true;
  }
  if (!BUILTIN_PROVIDER_IDS.has(providerId)) {
    return true;
  }
  if (providerId === "openai") {
    const baseUrl = (entry?.baseUrl ?? "").trim();
    return Boolean(baseUrl && !isOfficialOpenAIBase(baseUrl));
  }
  return false;
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

function makeCustomProviderId(prefix: string, displayName: string, existingKeys: string[]): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  const base = slug ? `${prefix}${slug}` : `${prefix}${Date.now()}`;
  const set = new Set(existingKeys);
  let id = base;
  let n = 0;
  while (set.has(id)) {
    n += 1;
    id = `${base}_${n}`;
  }
  return id;
}

/** 生成自定义 OpenAI 范式厂商的配置 id，避免与已有 key 冲突 */
export function makeCustomOpenAIProviderId(displayName: string, existingKeys: string[]): string {
  return makeCustomProviderId("custom_openai_", displayName, existingKeys);
}

/** 生成自定义 Ollama 厂商的配置 id（多实例远程 Ollama）。 */
export function makeCustomOllamaProviderId(displayName: string, existingKeys: string[]): string {
  return makeCustomProviderId("custom_ollama_", displayName, existingKeys);
}
