import { describe, expect, it } from "vitest";
import { sanitizeHistoryForUpstream } from "../history-sanitize";

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

describe("sanitizeHistoryForUpstream", () => {
  it("strips closed think blocks and citation indices", () => {
    const out = sanitizeHistoryForUpstream([
      {
        role: "assistant",
        content: `${THINK_OPEN}abc${THINK_CLOSE}正文[1]`,
      },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "正文" }]);
  });

  it("drops unclosed think tails", () => {
    const out = sanitizeHistoryForUpstream([
      {
        role: "assistant",
        content: `正文${THINK_OPEN}abc`,
      },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "正文" }]);
  });

  it("removes assistant messages that become empty after sanitize", () => {
    const out = sanitizeHistoryForUpstream([
      {
        role: "assistant",
        content: `${THINK_OPEN}only reasoning${THINK_CLOSE}`,
      },
      { role: "user", content: "继续" },
    ]);
    expect(out).toEqual([{ role: "user", content: "继续" }]);
  });

  it("does not alter user messages", () => {
    const out = sanitizeHistoryForUpstream([
      {
        role: "user",
        content: `${THINK_OPEN}should stay${THINK_CLOSE}正文[1]`,
      },
    ]);
    expect(out).toEqual([
      {
        role: "user",
        content: `${THINK_OPEN}should stay${THINK_CLOSE}正文[1]`,
      },
    ]);
  });

  it("strips multi-digit citation indices but leaves non-numeric brackets", () => {
    const out = sanitizeHistoryForUpstream([
      {
        role: "assistant",
        content: "见[12]与[123]，保留[abc]和[]。",
      },
    ]);
    expect(out[0]?.content).toBe("见与，保留[abc]和[]。");
  });
});
