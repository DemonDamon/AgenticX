import React from "react";
// @ts-expect-error react-dom/server is present at runtime but has no local declaration.
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import zh from "../../../messages/zh.json";
import type { EvalResultView, EvalRunView } from "../../lib/ma/eval-records";
import { RunDetailSheet } from "./RunDetailSheet";

const run: EvalRunView = {
  id: "R",
  tenant_id: "T",
  kind: "eval",
  status: "running",
  agent_id: "A",
  agent_version: 1,
  environment_id: null,
  dataset_id: "D",
  dataset_name: "集",
  dataset_hash: "h",
  rubric_id: "U",
  rubric_name: "标准",
  rubric_version: 1,
  rubric_hash: "h",
  base_run_id: null,
  progress: { done: 1, total: 2 },
  summary: { mean_score: 0.5, pass_rate: 0.5, failed: 1, errored: 1 },
  error: null,
  created_by: null,
  started_at: null,
  finished_at: null,
  created_at: "2026-10-25T00:00:00.000Z",
};

function result(id: string, status: EvalResultView["status"]): EvalResultView {
  return {
    id,
    run_id: "R",
    item_id: id,
    position: id === "E" ? 2 : 1,
    status,
    score: status === "error" ? null : 0.4,
    session_id: "S",
    answer: "全文回答",
    tool_names: [],
    stop_reason: "end_turn",
    rule_results: [{ type: "contains", passed: false, detail: "not found" }],
    judge: { score: 0.4, passed: false, reason: "缺少汇总", error: null },
    usage: {},
    duration_ms: 1,
    error: status === "error" ? "timeout" : null,
  };
}

function render(filter: "all" | "error" = "all", expanded: string | null = null) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="zh" timeZone="Asia/Shanghai" messages={zh}>
      <RunDetailSheet
        embed
        run={run}
        results={[result("F", "failed"), result("E", "error")]}
        initialFilter={filter}
        initialExpandedId={expanded}
      />
    </NextIntlClientProvider>,
  );
}

describe("RunDetailSheet", () => {
  it("shows the four stats and excludes errors from the score note", () => {
    const html = render();
    expect(html).toContain("均分");
    expect(html).toContain("通过率");
    expect(html).toContain("未通过");
    expect(html).toContain("执行异常");
    expect(html).toContain("执行异常不计入通过率与均分");
    expect(html).toContain('data-value="50"');
  });

  it("filters to execution errors", () => {
    const html = render("error");
    expect(html).toContain('data-result-id="E"');
    expect(html).not.toContain('data-result-id="F"');
  });

  it("expands the judge reason and each rule", () => {
    const html = render("all", "F");
    expect(html).toContain("缺少汇总");
    expect(html).toContain("contains: not found");
    expect(html).toContain("text-red-600");
  });
});
