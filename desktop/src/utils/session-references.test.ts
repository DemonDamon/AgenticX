/**
 * Tests for WorkPanel session reference aggregation.
 *
 * Author: Damon Li
 */

import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import { collectSessionReferences } from "./session-references";

function msg(partial: Partial<Message> & Pick<Message, "id" | "role" | "content">): Message {
  return {
    timestamp: Date.now(),
    ...partial,
  };
}

describe("collectSessionReferences", () => {
  it("returns empty bundle when session has no skills or refs", () => {
    const bundle = collectSessionReferences([
      msg({ id: "u1", role: "user", content: "hello" }),
      msg({ id: "a1", role: "assistant", content: "hi" }),
    ]);
    expect(bundle.isEmpty).toBe(true);
    expect(bundle.skillCount).toBe(0);
    expect(bundle.docCount).toBe(0);
  });

  it("aggregates web references from assistant messages and dedupes by url", () => {
    const refs = [
      {
        id: 1,
        title: "机构展望",
        url: "https://xueqiu.com/a",
        snippet: "s1",
        source: "web" as const,
        domain: "xueqiu.com",
      },
      {
        id: 2,
        title: "另一篇",
        url: "https://finance.eastmoney.com/b",
        snippet: "s2",
        source: "web" as const,
        domain: "finance.eastmoney.com",
      },
    ];
    const bundle = collectSessionReferences([
      msg({ id: "u1", role: "user", content: "研判" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "结论",
        references: refs,
        searchedQueries: ["A股科技股 后续走势"],
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "补充",
        references: [refs[0]!],
      }),
    ]);
    expect(bundle.isEmpty).toBe(false);
    expect(bundle.webGroups).toHaveLength(2);
    expect(bundle.kbGroups).toHaveLength(0);
    expect(bundle.searchedQueries).toEqual(["A股科技股 后续走势"]);
    expect(bundle.docCount).toBe(2);
  });

  it("collects skill_use tool names and @skill:// tokens", () => {
    const bundle = collectSessionReferences([
      msg({
        id: "u1",
        role: "user",
        content: "用 @skill://research-guide 分析一下",
      }),
      msg({
        id: "t1",
        role: "tool",
        content: "OK",
        toolName: "skill_use",
        toolArgs: { name: "agent-reach" },
      }),
      msg({
        id: "t2",
        role: "tool",
        content: "OK",
        toolName: "skill_use",
        toolArgs: { name: "research-guide" },
      }),
    ]);
    expect(bundle.skills.map((s) => s.name)).toEqual(["research-guide", "agent-reach"]);
    expect(bundle.skillCount).toBe(2);
  });

  it("falls back to knowledge_search tool JSON when assistant refs missing", () => {
    const toolJson = JSON.stringify({
      ok: true,
      hits: [
        {
          id: "doc_abc::0",
          text: "chunk text",
          metadata: { document_id: "doc_abc" },
          source: { title: "南网需求.md", chunk_index: 0 },
        },
      ],
    });
    const bundle = collectSessionReferences([
      msg({ id: "u1", role: "user", content: "查知识库" }),
      msg({
        id: "t1",
        role: "tool",
        content: toolJson,
        toolName: "knowledge_search",
        toolArgs: { query: "南网" },
      }),
    ]);
    expect(bundle.kbGroups).toHaveLength(1);
    expect(bundle.kbGroups[0]?.primary.title).toBe("南网需求.md");
    expect(bundle.searchedQueries).toContain("南网");
  });
});
