import type { EnterpriseAgent } from "@agenticx/iam-core";

export const KNOWLEDGE_TOOL = "knowledge_search";

export function knowledgeSearchUrl(agent: Pick<EnterpriseAgent, "metadata">): string {
  const raw = agent.metadata?.knowledgeSearchUrl;
  if (typeof raw !== "string") return "";
  return normalizeKnowledgeSearchUrl(raw);
}

export function normalizeKnowledgeSearchUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  return url;
}

export async function searchKnowledge(
  url: string,
  query: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; text: string }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) return { ok: false, text: `knowledge search failed (${response.status})` };
  const payload = (await response.json()) as { results?: Array<{ text?: unknown }> };
  const lines = (payload.results ?? [])
    .map((item) => (typeof item?.text === "string" ? item.text.trim() : ""))
    .filter(Boolean);
  return { ok: true, text: lines.join("\n") || "没有检索到内容" };
}
