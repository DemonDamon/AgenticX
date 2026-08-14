import { describe, expect, it, vi } from "vitest";
import {
  MAX_CLAIM_BLOCK_CHARS,
  MAX_VERIFIED_CLAIMS,
  MAX_VERIFY_EVIDENCE_CHARS,
  MIN_VERIFY_REMAINING_MS,
  applyVerificationFindings,
  buildVerificationEvidence,
  buildVerificationEvidenceBundle,
  extractCitedClaims,
  parseVerificationFindings,
  selectClaimsForVerification,
  verifyReportCitations,
} from "./citation-verifier";
import type { Citation } from "./registry";

function citation(index: number, overrides: Partial<Citation> = {}): Citation {
  return {
    index,
    title: `来源 ${index}`,
    url: `https://example.com/${index}`,
    snippet: `摘要 ${index}`,
    ...overrides,
  };
}

describe("extractCitedClaims", () => {
  it("splits paragraphs into cited sentences and keeps offsets exact", () => {
    const markdown = "模型于 2025 年发布 [1]。它的上下文是 200K [2]。这句没有引用。";
    const claims = extractCitedClaims(markdown);

    expect(claims.map((c) => c.text)).toEqual([
      "模型于 2025 年发布 [1]。",
      "它的上下文是 200K [2]。",
    ]);
    for (const claim of claims) {
      expect(markdown.slice(claim.offset, claim.end)).toBe(claim.text);
    }
    expect(claims[0]?.citations).toEqual([1]);
    expect(claims[1]?.citations).toEqual([2]);
  });

  it("keeps a list marker out of the claim span", () => {
    const markdown = "- 训练成本下降 40% [3]。\n- 没有引用的条目。";
    const claims = extractCitedClaims(markdown);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.kind).toBe("list");
    expect(claims[0]?.text).toBe("训练成本下降 40% [3]。");
    expect(markdown.slice(claims[0]!.offset, claims[0]!.end)).toBe(claims[0]!.text);
  });

  it("treats a table row as one unit and skips the divider", () => {
    const markdown = [
      "| 模型 | 参数 |",
      "| --- | --- |",
      "| A | 70B [4] |",
    ].join("\n");
    const claims = extractCitedClaims(markdown);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.kind).toBe("table");
    expect(claims[0]?.text).toBe("| A | 70B [4] |");
  });

  it("never extracts from fenced code or headings", () => {
    const markdown = [
      "## 结论 [9]",
      "",
      "```python",
      "print('cite [1] here')",
      "```",
      "",
      "正文里的断言 [1]。",
    ].join("\n");
    const claims = extractCitedClaims(markdown);

    expect(claims.map((c) => c.text)).toEqual(["正文里的断言 [1]。"]);
  });

  it("increments the section index at each heading", () => {
    const markdown = [
      "## 一",
      "断言甲 [1]。",
      "## 二",
      "断言乙 [2]。",
    ].join("\n");
    const claims = extractCitedClaims(markdown);
    expect(claims.map((c) => c.sectionIndex)).toEqual([1, 2]);
  });
});

describe("selectClaimsForVerification", () => {
  it("caps the audit and rotates across sections", () => {
    const markdown = Array.from({ length: 6 }, (_, section) =>
      [
        `## 第 ${section + 1} 节`,
        ...Array.from({ length: 12 }, (_, i) => `第 ${section}-${i} 条断言 [${i + 1}]。`),
      ].join("\n"),
    ).join("\n");

    const selected = selectClaimsForVerification(extractCitedClaims(markdown));

    expect(selected.length).toBeLessThanOrEqual(MAX_VERIFIED_CLAIMS);
    expect(new Set(selected.map((c) => c.sectionIndex)).size).toBe(6);
    const chars = selected.reduce((sum, claim) => sum + claim.text.length, 0);
    expect(chars).toBeLessThanOrEqual(MAX_CLAIM_BLOCK_CHARS);
  });

  it("prefers numeric, dated, comparative and causal statements", () => {
    const markdown = [
      "## 一",
      "这是一句普通的定性描述 [1]。",
      "2025 年营收增长 40%，高于同业 [2]。",
    ].join("\n");
    const selected = selectClaimsForVerification(extractCitedClaims(markdown), 1);

    expect(selected[0]?.text).toContain("40%");
  });
});

describe("buildVerificationEvidence", () => {
  it("emits one untrusted block per distinct citation", () => {
    const markdown = "甲 [1]。乙 [1]。丙 [2]。";
    const claims = extractCitedClaims(markdown);
    const evidence = buildVerificationEvidence(claims, [citation(1), citation(2)]);

    expect(evidence.match(/<untrusted_evidence /gu)).toHaveLength(2);
    expect(evidence).toContain('citation="1"');
    expect(evidence).toContain('citation="2"');
  });

  it("recalls the relevant passage from deep inside a long page body", () => {
    const filler = "无关背景段落。".repeat(400);
    const claims = extractCitedClaims("上下文窗口达到 200K tokens [1]。");
    const evidence = buildVerificationEvidence(claims, [
      citation(1, { fullText: `${filler}\n\n该模型上下文窗口达到 200K tokens。` }),
    ]);

    expect(evidence).toContain("200K tokens");
  });

  it("stays inside the evidence budget with many long sources", () => {
    const claims = extractCitedClaims(
      Array.from({ length: 12 }, (_, i) => `断言 ${i} [${i + 1}]。`).join(""),
    );
    const citations = Array.from({ length: 12 }, (_, i) =>
      citation(i + 1, { fullText: "长正文段落。".repeat(2_000) }),
    );

    const evidence = buildVerificationEvidence(claims, citations);
    expect(evidence.length).toBeLessThanOrEqual(MAX_VERIFY_EVIDENCE_CHARS);
  });

  it("reports which citations survived the global evidence cap", () => {
    const claims = extractCitedClaims(
      Array.from({ length: 6 }, (_, i) => `断言 ${i} [${i + 1}]。`).join(""),
    );
    const citations = Array.from({ length: 6 }, (_, i) =>
      citation(i + 1, { fullText: `来源 ${i + 1} ` + "长正文。".repeat(300) }),
    );

    const bundle = buildVerificationEvidenceBundle(claims, citations, 1_200, 800);
    expect(bundle.evidence.length).toBeLessThanOrEqual(1_200);
    expect(bundle.includedCitationIndexes.size).toBeGreaterThan(0);
    expect(bundle.includedCitationIndexes.size).toBeLessThan(citations.length);
    for (const index of bundle.includedCitationIndexes) {
      expect(bundle.evidence).toContain(`citation="${index}"`);
    }
  });
});

describe("parseVerificationFindings", () => {
  const markdown = "营收增长 40% [1][2]。";
  const claims = extractCitedClaims(markdown);

  it("accepts a downgrade that reuses the original citations", () => {
    const findings = parseVerificationFindings(
      '{"findings":[{"claim_id":"c1","verdict":"partial","replacement":"营收有所增长 [1]。"}]}',
      claims,
    );
    expect(findings).toEqual([
      { claimId: "c1", verdict: "partial", replacement: "营收有所增长 [1]。" },
    ]);
  });

  it("rejects unknown claim ids, unknown verdicts and new citations", () => {
    expect(
      parseVerificationFindings(
        '{"findings":[{"claim_id":"c99","verdict":"partial","replacement":"x [1]"}]}',
        claims,
      ),
    ).toEqual([]);
    expect(
      parseVerificationFindings(
        '{"findings":[{"claim_id":"c1","verdict":"maybe","replacement":"x [1]"}]}',
        claims,
      ),
    ).toEqual([]);
    expect(
      parseVerificationFindings(
        '{"findings":[{"claim_id":"c1","verdict":"partial","replacement":"x [7]"}]}',
        claims,
      ),
    ).toEqual([]);
  });

  it("rejects replacements that would inject structure", () => {
    for (const replacement of [
      "## 新标题 [1]",
      "```js\ncode [1]\n```",
      "第一行 [1]\n第二行 [1]",
      "只有文字，没有引用",
    ]) {
      expect(
        parseVerificationFindings(
          JSON.stringify({
            findings: [{ claim_id: "c1", verdict: "unsupported", replacement }],
          }),
          claims,
        ),
      ).toEqual([]);
    }
  });

  it("returns nothing for malformed JSON", () => {
    expect(parseVerificationFindings("not json at all", claims)).toEqual([]);
    expect(parseVerificationFindings('{"findings": "nope"}', claims)).toEqual([]);
  });

  it("refuses to delete a table row", () => {
    const tableClaims = extractCitedClaims("| A | 70B [1] |");
    expect(
      parseVerificationFindings(
        '{"findings":[{"claim_id":"c1","verdict":"unsupported","replacement":""}]}',
        tableClaims,
      ),
    ).toEqual([]);
  });
});

describe("applyVerificationFindings", () => {
  it("replaces in reverse order without disturbing the rest of the report", () => {
    const markdown = "## 结论\n\n甲增长 40% [1]。乙下降 10% [2]。\n\n尾段 [3]。";
    const claims = extractCitedClaims(markdown);
    const output = applyVerificationFindings(markdown, claims, [
      { claimId: "c1", verdict: "partial", replacement: "甲有所增长 [1]。" },
      { claimId: "c2", verdict: "partial", replacement: "乙有所下降 [2]。" },
    ]);

    expect(output).toBe("## 结论\n\n甲有所增长 [1]。乙有所下降 [2]。\n\n尾段 [3]。");
  });

  it("drops an orphaned list item instead of leaving a dangling bullet", () => {
    const markdown = "- 保留的条目 [1]。\n- 无依据的条目 [2]。\n- 另一条 [3]。";
    const claims = extractCitedClaims(markdown);
    const output = applyVerificationFindings(markdown, claims, [
      { claimId: "c2", verdict: "unsupported", replacement: "" },
    ]);

    expect(output).toBe("- 保留的条目 [1]。\n- 另一条 [3]。");
    expect(output).not.toMatch(/^-\s*$/mu);
  });

  it("keeps the surrounding sentence when only one clause is deleted", () => {
    const markdown = "甲成立 [1]。乙无依据 [2]。丙成立 [3]。";
    const claims = extractCitedClaims(markdown);
    const output = applyVerificationFindings(markdown, claims, [
      { claimId: "c2", verdict: "contradicted", replacement: "" },
    ]);

    expect(output).toBe("甲成立 [1]。丙成立 [3]。");
  });

  it("ignores a finding whose anchor text moved", () => {
    const markdown = "甲成立 [1]。";
    const claims = extractCitedClaims(markdown);
    const output = applyVerificationFindings("完全不同的正文 [1]。", claims, [
      { claimId: "c1", verdict: "unsupported", replacement: "" },
    ]);
    expect(output).toBe("完全不同的正文 [1]。");
  });
});

describe("verifyReportCitations", () => {
  const markdown = "## 结论\n\n营收增长 40% [1]。另一句 [2]。";
  const citations = [citation(1), citation(2)];

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      markdown,
      citations,
      topic: "T",
      callJson: vi.fn(async () => '{"findings":[]}'),
      baseBody: { model: "m" },
      remainingMs: 120_000,
      modelCallsRemaining: 4,
      ...overrides,
    };
  }

  it("audits the whole report with exactly one model call", async () => {
    const callJson = vi.fn(
      async (_body: Record<string, unknown>) =>
        '{"findings":[{"claim_id":"c1","verdict":"partial","replacement":"营收有所增长 [1]。"}]}',
    );
    const onVerifyStart = vi.fn();

    const result = await verifyReportCitations(baseInput({ callJson, onVerifyStart }));

    expect(callJson).toHaveBeenCalledTimes(1);
    expect(callJson.mock.calls[0]![0]).toMatchObject({ temperature: 0, max_tokens: 4096 });
    expect(onVerifyStart).toHaveBeenCalledTimes(1);
    expect(result.markdown).toBe("## 结论\n\n营收有所增长 [1]。另一句 [2]。");
    expect(result.appliedFindings).toBe(1);
  });

  it("skips the audit when time or model budget is short", async () => {
    const callJson = vi.fn(async () => '{"findings":[]}');
    const onVerifyStart = vi.fn();

    await expect(
      verifyReportCitations(
        baseInput({ callJson, onVerifyStart, remainingMs: MIN_VERIFY_REMAINING_MS }),
      ),
    ).resolves.toMatchObject({ audited: false, markdown });
    await expect(
      verifyReportCitations(baseInput({ callJson, onVerifyStart, modelCallsRemaining: 0 })),
    ).resolves.toMatchObject({ audited: false, markdown });

    expect(callJson).not.toHaveBeenCalled();
    expect(onVerifyStart).not.toHaveBeenCalled();
  });

  it("skips reports that carry no citations at all", async () => {
    const callJson = vi.fn(async () => '{"findings":[]}');
    await expect(
      verifyReportCitations(baseInput({ callJson, markdown: "## 结论\n\n没有任何引用。" })),
    ).resolves.toMatchObject({ audited: false });
    expect(callJson).not.toHaveBeenCalled();
  });

  it("keeps the original prose when the audit call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await verifyReportCitations(
      baseInput({
        callJson: vi.fn(async () => {
          throw new Error("gateway down");
        }),
      }),
    );

    expect(result.markdown).toBe(markdown);
    expect(result.appliedFindings).toBe(0);
    warn.mockRestore();
  });

  it("keeps the original prose when the audit returns garbage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await verifyReportCitations(
      baseInput({ callJson: vi.fn(async () => "抱歉，我无法完成。") }),
    );

    expect(result.markdown).toBe(markdown);
    expect(result.appliedFindings).toBe(0);
    warn.mockRestore();
  });

  it("never leaks confidence or gap language into the report", async () => {
    const result = await verifyReportCitations(
      baseInput({
        callJson: vi.fn(
          async () =>
            '{"findings":[{"claim_id":"c1","verdict":"unsupported","replacement":""}]}',
        ),
      }),
    );

    expect(result.markdown).not.toMatch(/置信度|信息缺口|复核|verdict|claim_id/u);
    expect(result.markdown).toBe("## 结论\n\n另一句 [2]。");
  });

  it("never audits a claim whose cited source was omitted by the evidence cap", async () => {
    const longMarkdown = Array.from(
      { length: 20 },
      (_, i) => `第 ${i + 1} 项增长 ${i + 1}% [${i + 1}]。`,
    ).join("\n");
    const longCitations = Array.from({ length: 20 }, (_, i) =>
      citation(i + 1, { fullText: `证据 ${i + 1} ` + "正文片段。".repeat(400) }),
    );
    const callJson = vi.fn(async (body: Record<string, unknown>) => {
      const prompt = JSON.stringify(body.messages ?? []);
      // c20's source falls beyond the 10K evidence cap, so the claim must not
      // be exposed to a model that could confuse omission with contradiction.
      expect(prompt).not.toContain("c20 | 引用 [20]");
      return '{"findings":[{"claim_id":"c20","verdict":"unsupported","replacement":""}]}';
    });

    const result = await verifyReportCitations(
      baseInput({ markdown: longMarkdown, citations: longCitations, callJson }),
    );

    expect(callJson).toHaveBeenCalledTimes(1);
    expect(result.markdown).toBe(longMarkdown);
    expect(result.appliedFindings).toBe(0);
  });
});
