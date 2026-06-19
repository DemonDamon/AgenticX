const FETCH_TIMEOUT_MS = 15000;

const BAILIAN_EMBEDDING_MODELS = [
  "text-embedding-v4",
  "text-embedding-v3",
  "text-embedding-v2",
  "text-embedding-v1",
  "multimodal-embedding-v1",
  "qwen3-vl-embedding",
  "qwen2.5-vl-embedding",
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

function isModelsCatalogMissing(status: number, body: string): boolean {
  if (status === 404 || status === 405) return true;
  return /not found|unsupported|unknown route/i.test(body.slice(0, 400));
}

async function fetchOllamaModelNames(baseUrl: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
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
    return { ok: true, models: models.sort((a, b) => a.localeCompare(b)) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "拉取超时" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  } finally {
    clearTimeout(timer);
  }
}

export type FetchUpstreamModelsResult =
  | { ok: true; models: string[]; warning?: string }
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

  const embeddingExtras = isBailianLike(providerId, baseUrl) ? [...BAILIAN_EMBEDDING_MODELS] : [];
  const mergeEmbeddings = (models: string[]) =>
    Array.from(new Set([...models, ...embeddingExtras])).sort((a, b) => a.localeCompare(b));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}/models`, { method: "GET", headers, signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (embeddingExtras.length > 0) {
        return { ok: true, models: mergeEmbeddings([]) };
      }
      if (isModelsCatalogMissing(resp.status, body)) {
        return {
          ok: true,
          models: [],
          warning: "该网关未提供 /models 接口，请使用「添加模型」手动填写模型 ID",
        };
      }
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: "API 地址可达，但 Key 无效或未授权" };
      }
      return { ok: false, error: `上游返回 HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((m) => String(m.id ?? "").trim()).filter(Boolean);
    return { ok: true, models: mergeEmbeddings(models) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "拉取超时" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  } finally {
    clearTimeout(timer);
  }
}
