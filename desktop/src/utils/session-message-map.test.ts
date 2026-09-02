import { describe, expect, it } from "vitest";
import { mapLoadedSessionMessage } from "./session-message-map";

describe("mapLoadedSessionMessage turn usage", () => {
  it("maps persisted usage and model onto the Message", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "assistant",
        content: "done",
        provider: "moonshot",
        model: "kimi-k2.6",
        model_selection: "manual",
        usage: {
          input_tokens: 1200,
          output_tokens: 340,
          cached_tokens: 80,
          total_tokens: 1540,
        },
      },
      "sess-1",
      0,
    );
    expect(mapped.provider).toBe("moonshot");
    expect(mapped.model).toBe("kimi-k2.6");
    expect(mapped.modelSelection).toBe("manual");
    expect(mapped.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cachedTokens: 80,
      reasoningTokens: 0,
      totalTokens: 1540,
    });
  });

  it("leaves legacy rows without usage or model selection", () => {
    const mapped = mapLoadedSessionMessage(
      { role: "assistant", content: "old" },
      "sess-1",
      1,
    );
    expect(mapped.usage).toBeUndefined();
    expect(mapped.modelSelection).toBeUndefined();
  });
});
