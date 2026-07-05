/** 内置厂商展示名（配置 key 仍为英文 id）；自定义厂商用 entry.displayName */

/** 品牌专属颜色（纯色背景用于 logo 头像）；未匹配的自定义厂商按名称 hash 取色 */
const PROVIDER_BRAND_COLOR: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  volcengine: "#1664ff",
  bailian: "#ff6a00",
  zhipu: "#6154ec",
  qianfan: "#3264ff",
  minimax: "#1a1a1a",
  kimi: "#1d6af4",
  ollama: "#ffffff",
};

const PROVIDER_BRAND_TEXT_COLOR: Record<string, string> = {
  minimax: "#ffffff",
  ollama: "#18181b",
};

const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6",
  "#f59e0b", "#ef4444", "#22c55e", "#3b82f6",
];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

export function getProviderBrandColor(providerId: string): string {
  return PROVIDER_BRAND_COLOR[providerId] ?? PALETTE[hashCode(providerId) % PALETTE.length] ?? "#6366f1";
}

export function getProviderBrandTextColor(providerId: string): string {
  return PROVIDER_BRAND_TEXT_COLOR[providerId] ?? "#ffffff";
}

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

/** 用户通过「添加服务厂商」创建的条目，允许从设置中删除。 */
export function isProviderDeletable(providerId: string): boolean {
  if (providerId.startsWith("custom_openai_") || providerId.startsWith("custom_ollama_")) {
    return true;
  }
  return !BUILTIN_PROVIDER_IDS.has(providerId);
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

/** Case-insensitive provider entry lookup for usage stats / legacy keys. */
export function resolveProviderEntry(
  providers: Record<string, ProviderDisplayEntry> | undefined,
  providerId: string,
): ProviderDisplayEntry | undefined {
  const key = (providerId ?? "").trim();
  if (!key) return undefined;
  const direct = providers?.[key];
  if (direct) return direct;
  const lower = key.toLowerCase();
  if (!providers) return undefined;
  for (const [name, entry] of Object.entries(providers)) {
    if (name.toLowerCase() === lower) return entry;
  }
  return undefined;
}

export function getProviderDisplayName(
  providerId: string,
  entry?: ProviderDisplayEntry | null,
): string {
  const pid = (providerId ?? "").trim();
  if (!pid || pid === "(unknown)") return "未知厂商";
  const custom = entry?.displayName?.trim();
  if (custom) return custom;
  if (pid === "openai") {
    const baseUrl = (entry?.baseUrl ?? "").trim();
    if (baseUrl && !isOfficialOpenAIBase(baseUrl)) {
      return "OpenAI 兼容";
    }
  }
  if (PROVIDER_DISPLAY_NAME[pid]) return PROVIDER_DISPLAY_NAME[pid];
  if (pid.startsWith("custom_openai_") || pid.startsWith("custom_ollama_")) {
    return "历史厂商";
  }
  return pid;
}

/** Provider 名称取首字母（用于头像 fallback） */
export function getProviderInitials(providerId: string, entry?: ProviderDisplayEntry | null): string {
  const displayName = getProviderDisplayName(providerId, entry);
  const first = displayName.trim().charAt(0).toUpperCase();
  return first || "P";
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
