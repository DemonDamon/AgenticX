import { describe, expect, it, vi } from "vitest";
import {
  DEEP_RESEARCH_DISABLED_HINT,
  DEEP_RESEARCH_SEARCH_DISABLED_HINT,
  runDeepResearchTurn,
} from "../deep-research/orchestrator";

async function readSseText(response: Response): Promise<string> {
  const text = await response.text();
  const deltas: string[] = [];
  for (const block of text.split("\n\n")) {
    const line = block
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!line) continue;
    const data = line.replace(/^data:\s*/, "");
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string") deltas.push(content);
    } catch {
      // ignore
    }
  }
  return deltas.join("");
}

function synthUpstream(content: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("deep research tenant guards", () => {
  it("degrades when deepResearchEnabled is false and never searches", async () => {
    const executeSearch = vi.fn();
    const fetchImpl = vi.fn(async () => synthUpstream("plain"));

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }], agenticx_deep_research: true },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        executeSearch: executeSearch as never,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: false,
        }),
      },
    );

    const text = await readSseText(response);
    expect(text.startsWith(DEEP_RESEARCH_DISABLED_HINT.trim()) || text.includes("管理员未开启深度研究")).toBe(
      true,
    );
    expect(executeSearch).not.toHaveBeenCalled();
  });

  it("degrades when web_search.enabled is false and never searches", async () => {
    const executeSearch = vi.fn();
    const fetchImpl = vi.fn(async () => synthUpstream("plain"));

    const response = await runDeepResearchTurn(
      { model: "m", messages: [{ role: "user", content: "q" }], agenticx_deep_research: true },
      {
        url: "http://gw",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        executeSearch: executeSearch as never,
        loadTenantConfig: async () => ({
          enabled: false,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          deepResearchEnabled: true,
        }),
      },
    );

    const text = await readSseText(response);
    expect(text).toContain(DEEP_RESEARCH_SEARCH_DISABLED_HINT.trim().replace(/\n+$/, "").slice(0, 10));
    expect(executeSearch).not.toHaveBeenCalled();
  });
});
