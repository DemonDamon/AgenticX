import { describe, expect, it } from "vitest";

import {
  isOptOutSubject,
  modelIdsFromSubjects,
  modelOptOutSubject,
  parseModelOptOutSubject,
} from "../opt-out-subject";

const MCP_ID = "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ";

describe("opt-out subjects", () => {
  it("keeps the model id in the shape the visibility table already uses", () => {
    // 换一种写法只会让「可见模型」和「关掉的模型」两边对不上。
    expect(modelOptOutSubject("openai/gpt-4")).toBe("model:openai/gpt-4");
    expect(parseModelOptOutSubject("model:openai/gpt-4")).toBe("openai/gpt-4");
  });

  it("accepts capability ids and model ids in the same column", () => {
    expect(isOptOutSubject(MCP_ID)).toBe(true);
    expect(isOptOutSubject("model:openai/gpt-4")).toBe(true);
  });

  it("rejects a bare id that names neither", () => {
    expect(isOptOutSubject("gpt-4")).toBe(false);
    expect(isOptOutSubject("model:")).toBe(false);
  });

  it("picks only the model rows out of a mixed list", () => {
    expect(modelIdsFromSubjects([MCP_ID, "model:a/b", "model:a/b", "model:c/d"])).toEqual([
      "a/b",
      "c/d",
    ]);
  });
});
