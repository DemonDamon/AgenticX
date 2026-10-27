import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryEvalStoreForTests,
  __useMemoryEvalStoreForTests,
  appendEvalDatasetItems,
  createEvalDataset,
  createEvalRubric,
  EvalDatasetLimitError,
  EvalNameConflictError,
  EvalRubricInvalidError,
  listEvalDatasetItems,
  listEvalDatasets,
  updateEvalRubric,
} from "../ma-evals";

describe("eval dataset and rubric repositories", () => {
  beforeEach(() => {
    __resetMemoryEvalStoreForTests();
    __useMemoryEvalStoreForTests();
  });

  it("appends items with consecutive positions and keeps item_count in sync", async () => {
    const dataset = await createEvalDataset("tenant", { name: "周报", description: "回归" }, "user");
    const first = await appendEvalDatasetItems("tenant", dataset.id, [
      { query: "一" },
      { query: "二", expectedAnswer: "答" },
    ]);
    const second = await appendEvalDatasetItems("tenant", dataset.id, [{ query: "三" }]);
    expect(first.map((item) => item.position)).toEqual([1, 2]);
    expect(second[0]?.position).toBe(3);
    const listed = await listEvalDatasetItems("tenant", dataset.id);
    expect(listed).toHaveLength(3);
    const rows = await listEvalDatasets("tenant");
    expect(rows[0]?.itemCount).toBe(3);
  });

  it("rejects the 501st item", async () => {
    const dataset = await createEvalDataset("tenant", { name: "满" }, "user");
    const batch = Array.from({ length: 500 }, (_, index) => ({ query: `q${index}` }));
    await appendEvalDatasetItems("tenant", dataset.id, batch);
    await expect(appendEvalDatasetItems("tenant", dataset.id, [{ query: "overflow" }])).rejects.toBeInstanceOf(
      EvalDatasetLimitError,
    );
    const listed = await listEvalDatasetItems("tenant", dataset.id);
    expect(listed).toHaveLength(500);
  });

  it("rejects an invalid rubric and bumps the version when content changes", async () => {
    await expect(createEvalRubric("tenant", { name: "空", content: {} }, "user")).rejects.toMatchObject({
      name: "EvalRubricInvalidError",
      errors: ["rubric: must define judge_model or at least one rule check"],
    });
    await expect(createEvalRubric("tenant", { name: "空", content: {} }, "user")).rejects.toBeInstanceOf(
      EvalRubricInvalidError,
    );
    const rubric = await createEvalRubric(
      "tenant",
      { name: "标准", content: { rule_checks: [{ type: "contains", value: "汇总" }] } },
      "user",
    );
    expect(rubric.version).toBe(1);
    const renamed = await updateEvalRubric("tenant", rubric.id, { description: "只改描述" });
    expect(renamed.version).toBe(1);
    const next = await updateEvalRubric("tenant", rubric.id, {
      content: { rule_checks: [{ type: "contains", value: "明细" }] },
    });
    expect(next.version).toBe(2);
    expect(next.contentHash).not.toBe(rubric.contentHash);
  });

  it("rejects a duplicate name", async () => {
    await createEvalDataset("tenant", { name: "同名" }, "user");
    await expect(createEvalDataset("tenant", { name: "同名" }, "user")).rejects.toBeInstanceOf(EvalNameConflictError);
    await createEvalRubric(
      "tenant",
      { name: "标准", content: { rule_checks: [{ type: "contains", value: "a" }] } },
      "user",
    );
    await expect(
      createEvalRubric("tenant", { name: "标准", content: { rule_checks: [{ type: "contains", value: "b" }] } }, "user"),
    ).rejects.toBeInstanceOf(EvalNameConflictError);
  });
});
