import { describe, expect, it, vi } from "vitest";
import { parseClarifierJson, proposeClarification } from "./clarifier";

describe("parseClarifierJson", () => {
  it("returns needed false for invalid JSON", () => {
    expect(parseClarifierJson("not-json")).toEqual({ needed: false });
    expect(parseClarifierJson("")).toEqual({ needed: false });
  });

  it("still clarifies when the model prefixes a think block", () => {
    const payload = {
      needed: true,
      questions: [
        {
          id: "q1",
          question: "想了解哪些方向？",
          options: [
            { id: "a", label: "架构" },
            { id: "b", label: "成本" },
          ],
        },
      ],
    };
    const raw = `<think>需要澄清吗？大概 {需要}</think>${JSON.stringify(payload)}`;
    const result = parseClarifierJson(raw);
    expect(result.needed).toBe(true);
    expect(result.needed && result.questions).toHaveLength(1);
  });

  it("parses standard JSON and clamps to 2 questions", () => {
    const payload = {
      needed: true,
      questions: [
        {
          id: "q1",
          question: "场景？",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
        {
          id: "q2",
          question: "渠道？",
          options: [
            { id: "c", label: "C" },
            { id: "d", label: "D" },
          ],
        },
        {
          id: "q3",
          question: "多余？",
          options: [
            { id: "e", label: "E" },
            { id: "f", label: "F" },
          ],
        },
      ],
    };
    const result = parseClarifierJson(JSON.stringify(payload));
    expect(result.needed).toBe(true);
    if (result.needed) {
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]?.id).toBe("q1");
    }
  });

  it("accepts fenced JSON", () => {
    const result = parseClarifierJson('```json\n{"needed":false}\n```');
    expect(result).toEqual({ needed: false });
  });
});

describe("proposeClarification grounding", () => {
  function stubGateway() {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"needed":false}' } }] }),
    });
  }

  function sentMessages(fetchImpl: ReturnType<typeof stubGateway>) {
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    return (JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> })
      .messages;
  }

  it("injects today's date and recon brief before the user query", async () => {
    const fetchImpl = stubGateway();
    await proposeClarification({
      url: "http://gw",
      headers: {},
      body: { model: "m" },
      userQuery: "deepseek v4 核心技术点",
      todayLine: "今天是 2026-08-02（UTC+8）。",
      reconBrief: "【检索到的现状】- DeepSeek V4 已发布",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const messages = sentMessages(fetchImpl);
    expect(messages).toHaveLength(4);
    expect(messages[0]?.content).toContain("调研开题助手");
    expect(messages[1]?.content).toContain("2026-08-02");
    expect(messages[2]?.content).toContain("已发布");
    expect(messages[3]).toEqual({ role: "user", content: "deepseek v4 核心技术点" });
  });

  it("keeps the original two-message shape when recon produced nothing", async () => {
    const fetchImpl = stubGateway();
    await proposeClarification({
      url: "http://gw",
      headers: {},
      body: { model: "m" },
      userQuery: "q",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(sentMessages(fetchImpl)).toHaveLength(2);
  });

  it("forces a focus clarify when the model skips an open-ended research ask", async () => {
    const fetchImpl = stubGateway(); // returns needed:false
    const result = await proposeClarification({
      url: "http://gw",
      headers: {},
      body: { model: "m" },
      userQuery: "deepseek v4 核心技术点",
      reconBrief: "【检索到的现状】- 已发布",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.needed).toBe(true);
    if (result.needed) {
      expect(result.questions[0]?.options.length).toBeGreaterThanOrEqual(3);
      expect(result.questions[0]?.question).toContain("方向");
    }
  });
});
