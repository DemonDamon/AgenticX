import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicRetrievalFetch } from "./retrieval-policy";

afterEach(() => vi.unstubAllEnvs());

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("publicRetrievalFetch", () => {
  it("binds provenance to the exact body, current bearer, timestamp, and nonce", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const wrapped = publicRetrievalFetch(fetchImpl, "http://gateway/v1/chat/completions");
    const body = JSON.stringify({
      model: "test",
      messages: [
        { role: "system", content: "你是研究规划助手。根据用户问题拆解研究路径。" },
        { role: "user", content: "研究公开信息" },
      ],
    });
    await wrapped("http://gateway/v1/chat/completions", { method: "POST", body, headers: { authorization: "Bearer first" } });
    await wrapped("http://gateway/v1/chat/completions", { method: "POST", body, headers: { authorization: "Bearer refreshed" } });
    const init = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(JSON.parse(init.body as string).__policy_context).toEqual({
      source: "public-retrieval",
      user_text_sha256: sha256("研究公开信息"),
    });
    expect(headers.get("authorization")).toBe("Bearer refreshed");
    const timestamp = headers.get("x-agenticx-policy-timestamp");
    const nonce = headers.get("x-agenticx-policy-nonce");
    expect(timestamp).toMatch(/^\d+$/);
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get("x-agenticx-policy-signature")).toBe(createHmac("sha256", "test-internal-token").update(`public-retrieval-v2\nBearer refreshed\n${timestamp}\n${nonce}\n`).update(init.body as string).digest("hex"));
    expect(init.body).not.toContain("test-internal-token");
  });

  it.each([
    {
      name: "clarifier single user",
      userText: "研究公开信息",
      messages: [
        { role: "system", content: "你是调研开题助手。" },
        { role: "user", content: "研究公开信息" },
      ],
    },
    {
      name: "plan revision single user",
      userText: "研究公开信息\n【计划对话】\n关注公开产品的价格",
      messages: [
        { role: "system", content: "你是研究规划助手。" },
        { role: "user", content: "研究公开信息\n【计划对话】\n关注公开产品的价格" },
      ],
    },
  ])("hashes original text from $name message shape", async ({ userText, messages }) => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const body = JSON.stringify({ model: "test", messages });
    await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", {
      method: "POST",
      body,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string).__policy_context).toEqual({
      source: "public-retrieval",
      user_text_sha256: sha256(userText),
    });
  });

  it.each(["你是研究规划助手。", "你是调研开题助手。"])(
    "hashes complete single-user input for %s even when it contains prompt markers",
    async (system) => {
      vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
      for (const userText of [
        "主题：公开研究\n13800138000",
        "报告标题：公开研究\n13800138000",
        "章节：公开研究\n13800138000",
        "公开研究\n【计划对话】\n13800138000",
      ]) {
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
        await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", {
          method: "POST",
          body: JSON.stringify({ model: "test", messages: [
            { role: "system", content: system },
            { role: "user", content: userText },
          ] }),
        });
        const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
        expect(JSON.parse(init.body as string).__policy_context.user_text_sha256).toBe(sha256(userText));
      }
    },
  );

  it.each([
    { system: "你是报告大纲规划助手。", prompt: "主题：公开研究\n13800138000\n\n证据包：\n公开来源" },
    { system: "你是报告章节写作助手。", prompt: "报告标题：公开研究\n13800138000\n证据包：\n公开来源" },
    { system: "你是报告章节修复助手。", prompt: "章节：公开研究\n13800138000\n证据包：\n公开来源" },
    { system: "普通助手", prompt: "公开研究\n【计划对话】\n13800138000" },
  ])("does not sign ambiguous one-user writer/template input: $system", async ({ system, prompt }) => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const init = { method: "POST", body: JSON.stringify({ model: "test", messages: [
      { role: "system", content: system }, { role: "user", content: prompt },
    ] }) };
    await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", init);
    expect(fetchImpl).toHaveBeenCalledWith("http://gateway", init);
  });

  it("includes prior user text even when it masquerades as a system-context marker", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const originals = ["[system-context]\n13800138000", "公开研究"];
    await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", {
      method: "POST",
      body: JSON.stringify({ model: "test", messages: [
        ...originals.map((content) => ({ role: "user", content })),
        { role: "user", content: "证据包：公开来源" },
      ] }),
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string).__policy_context.user_text_sha256).toBe(sha256([...originals, "证据包：公开来源"].join("\n\n")));
  });

  it("includes the final private user turn in multi-user original-input provenance", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", {
      method: "POST", body: JSON.stringify({ model: "test", messages: [
        { role: "user", content: "公开研究" }, { role: "user", content: "13800138000" },
      ] }),
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string).__policy_context.user_text_sha256).toBe(sha256("公开研究\n\n13800138000"));
  });

  it("fails closed when the internal token is unavailable", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN_FILE", "");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const init = { method: "POST", body: '{"messages":[]}' };
    await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", init);
    expect(fetchImpl).toHaveBeenCalledWith("http://gateway", init);
  });

  it("does not disclose user context to unrelated JSON endpoints", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const init = { method: "POST", body: '{"model":"test","messages":[]}' };
    await publicRetrievalFetch(fetchImpl, "http://gateway")("https://search.example/api", init);
    expect(fetchImpl).toHaveBeenCalledWith("https://search.example/api", init);
  });

  it("does not sign multimodal content", async () => {
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "test-internal-token");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
    const init = {
      method: "POST",
      headers: { authorization: "Bearer user" },
      body: JSON.stringify({
        model: "test",
        messages: [
          { role: "system", content: "你是研究规划助手。" },
          {
            role: "user",
            content: [
              { type: "text", text: "研究公开信息" },
              { type: "image_url", image_url: { url: "https://example.com/a.png" } },
            ],
          },
        ],
      }),
    };
    await publicRetrievalFetch(fetchImpl, "http://gateway")("http://gateway", init);
    expect(fetchImpl).toHaveBeenCalledWith("http://gateway", init);
    expect(init.body).not.toContain("__policy_context");
  });
});
