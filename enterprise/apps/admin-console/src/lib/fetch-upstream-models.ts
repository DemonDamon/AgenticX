import {
  extractOllamaContextWindow,
  extractUpstreamContextWindow,
} from "./model-context-window";

const FETCH_TIMEOUT_MS = 15000;
const MAX_MODEL_PAGES = 20;
/** Ollama 每个模型要单独 POST /api/show，限量限并发以免拖垮「获取模型列表」。 */
const OLLAMA_SHOW_TIMEOUT_MS = 5000;
const OLLAMA_SHOW_MAX_MODELS = 32;
const OLLAMA_SHOW_CONCURRENCY = 6;

/** 模型 ID → 上游自报的上下文窗口（token）。取不到的模型不会出现在表里。 */
export type UpstreamContextWindows = Record<string, number>;

const BAILIAN_EMBEDDING_MODELS = [
  "text-embedding-v4",
  "text-embedding-v3",
  "text-embedding-v2",
  "text-embedding-v1",
  "multimodal-embedding-v1",
  "qwen3-vl-embedding",
  "qwen2.5-vl-embedding",
] as const;

/** Zhipu OpenAI-compatible GET /models omits VLM chat SKUs; merge documented vision models. */
export const ZHIPU_DOCUMENTED_VLM_MODELS = [
  "glm-4.6v",
  "glm-5v-turbo",
  "glm-4.1v-thinking",
  "glm-4.6v-flash",
  "glm-4.1v-thinking-flash",
  "glm-4v-flash",
] as const;

function isOllamaLikeProvider(providerId: string): boolean {
  const p = providerId.trim().toLowerCase();
  return p === "ollama" || p.startsWith("custom_ollama_");
}

function normalizeOllamaApiBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v\d+$/i, "");
}

function isBailianLike(providerId: string, baseUrl: string): boolean {
  const p = providerId.trim().toLowerCase();
  if (p === "bailian" || p === "dashscope") return true;
  return /dashscope\.aliyuncs\.com/i.test(baseUrl);
}

export function isZhipuLike(providerId: string, baseUrl: string): boolean {
  const p = providerId.trim().toLowerCase();
  if (p === "zhipu") return true;
  return /open\.bigmodel\.cn/i.test(baseUrl);
}

function isModelsCatalogMissing(status: number, body: string): boolean {
  if (status === 404 || status === 405) return true;
  return /not found|unsupported|unknown route/i.test(body.slice(0, 400));
}

function extractModelId(row: Record<string, unknown>): string {
  for (const key of ["id", "model", "name"] as const) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

type OpenAiModelsPage = {
  data?: Array<Record<string, unknown>>;
  has_more?: boolean;
  last_id?: string;
};

export function mergeProviderCatalogExtras(
  providerId: string,
  baseUrl: string,
  apiModelIds: string[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  for (const id of apiModelIds) push(id);
  if (isBailianLike(providerId, baseUrl)) {
    for (const id of BAILIAN_EMBEDDING_MODELS) push(id);
  }
  if (isZhipuLike(providerId, baseUrl)) {
    for (const id of ZHIPU_DOCUMENTED_VLM_MODELS) push(id);
  }

  ordered.sort((a, b) => a.localeCompare(b));
  return ordered;
}

/** Ollama /api/show：拿单个模型的 context_length；任何失败都静默跳过（探测是尽力而为）。 */
async function fetchOllamaContextWindow(base: string, model: string): Promise<number | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_SHOW_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    });
    if (!resp.ok) return undefined;
    const payload = (await resp.json()) as Record<string, unknown>;
    return extractOllamaContextWindow(payload);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function probeOllamaContextWindows(base: string, models: string[]): Promise<UpstreamContextWindows> {
  const targets = models.slice(0, OLLAMA_SHOW_MAX_MODELS);
  const windows: UpstreamContextWindows = {};
  let cursor = 0;
  const workers = Array.from({ length: Math.min(OLLAMA_SHOW_CONCURRENCY, targets.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const model = targets[index];
      if (!model) return;
      const found = await fetchOllamaContextWindow(base, model);
      if (found !== undefined) windows[model] = found;
    }
  });
  await Promise.all(workers);
  return windows;
}

async function fetchOllamaModelNames(
  baseUrl: string
): Promise<{ ok: true; models: string[]; contextWindows: UpstreamContextWindows } | { ok: false; error: string }> {
  const base = normalizeOllamaApiBase(baseUrl);
  if (!base) return { ok: false, error: "API 地址未配置" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/api/tags`, { signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    }
    const data = (await resp.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((m) => String(m.name ?? "").trim()).filter(Boolean);
    models.sort((a, b) => a.localeCompare(b));
    const contextWindows = await probeOllamaContextWindows(base, models);
    return { ok: true, models, contextWindows };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "拉取超时" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenAiCompatibleModelIds(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<
  | { ok: true; models: string[]; contextWindows: UpstreamContextWindows }
  | { ok: false; error: string; status?: number; body?: string }
> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const contextWindows: UpstreamContextWindows = {};
  let after: string | undefined;

  for (let page = 0; page < MAX_MODEL_PAGES; page++) {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/models${query}`, { method: "GET", headers, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, error: "拉取超时" };
      }
      return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `上游返回 HTTP ${resp.status}`, status: resp.status, body };
    }

    const data = (await resp.json()) as OpenAiModelsPage;
    for (const row of data.data ?? []) {
      const id = extractModelId(row);
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
        // vLLM/SGLang 自部署会在这里回报 max_model_len——自部署场景最权威的窗口值。
        const window = extractUpstreamContextWindow(row);
        if (window !== undefined) contextWindows[id] = window;
      }
    }

    if (!data.has_more) break;
    const nextAfter = (data.last_id ?? ordered[ordered.length - 1] ?? "").trim();
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  return { ok: true, models: ordered, contextWindows };
}

export type FetchUpstreamModelsResult =
  | { ok: true; models: string[]; contextWindows: UpstreamContextWindows; warning?: string }
  | { ok: false; error: string };

export async function fetchUpstreamModels(input: {
  providerId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<FetchUpstreamModelsResult> {
  const providerId = input.providerId.trim();
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const apiKey = input.apiKey.trim();

  if (!baseUrl) {
    return { ok: false, error: "API 地址未配置" };
  }

  if (isOllamaLikeProvider(providerId)) {
    return fetchOllamaModelNames(baseUrl);
  }

  if (!apiKey) {
    return { ok: false, error: "API Key 未配置" };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const listed = await fetchOpenAiCompatibleModelIds(baseUrl, headers);
  if (!listed.ok) {
    if (listed.status === 401 || listed.status === 403) {
      return { ok: false, error: "API 地址可达，但 Key 无效或未授权" };
    }
    if (isBailianLike(providerId, baseUrl) || isZhipuLike(providerId, baseUrl)) {
      return {
        ok: true,
        models: mergeProviderCatalogExtras(providerId, baseUrl, []),
        contextWindows: {},
      };
    }
    if (listed.status && isModelsCatalogMissing(listed.status, listed.body ?? "")) {
      return {
        ok: true,
        models: [],
        contextWindows: {},
        warning: "该网关未提供 /models 接口，请使用「添加模型」手动填写模型 ID",
      };
    }
    return { ok: false, error: listed.error };
  }

  const models = mergeProviderCatalogExtras(providerId, baseUrl, listed.models);
  return { ok: true, models, contextWindows: listed.contextWindows };
}
