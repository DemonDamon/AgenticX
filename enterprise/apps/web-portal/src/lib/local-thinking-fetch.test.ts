import { describe, expect, it, vi } from "vitest";
import { localThinkingBudgetFetch } from "./local-thinking-fetch";

const local = { id: "local/qwen3.8", route: "local" };
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
function response(content: string, finish = "stop", input = 10, output = 4) {
  return new Response(
    frame({ choices: [{ delta: { content }, finish_reason: finish }] })
      + frame({ agenticx_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } })
      + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
const options = () => ({
  method: "POST",
  headers: { "x-agenticx-trace-stage": "chat.answer" },
  body: JSON.stringify({
    model: "qwen3.8",
    stream: true,
    thinking_token_budget: 32,
    max_tokens: 1024,
    messages: [{ role: "user", content: "计算17乘19" }],
  }),
});

describe("local reasoning continuation", () => {
  it("continues a reasoning-only stop into a second billed answer", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response("先计算", "stop", 10, 32))
      .mockResolvedValueOnce(response("323", "stop", 50, 3));
    const result = await localThinkingBudgetFetch(local, fetcher)("http://gateway", options());
    const text = await result.text();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const final = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(first.max_tokens).toBe(32);
    expect(first.thinking_token_budget).toBeUndefined();
    expect(final.continue_final_message).toBe(true);
    expect(final.messages.at(-1).content).toContain("</think>");
    expect(text).toContain("323");
    expect(text).toContain('"input_tokens":60');
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("does not split a third-party model", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response("直接回答"));
    await localThinkingBudgetFetch({ id: "hosted/qwen3.8", route: "third-party" }, fetcher)("http://gateway", options());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
