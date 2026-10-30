import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_CLASSIFICATION_GRADES,
  SAMPLE_CLEANING_RULES,
  SAMPLE_DICTIONARY_FIELDS,
  SAMPLE_QUALITY_METRICS,
  appendReviewAction,
  getBoard,
  getQualityLastRun,
  listBoards,
  listClassificationGrades,
  listCleaningRules,
  listDictionaryFields,
  listQualityMetrics,
  listReviewActions,
  runQualityDay,
  upsertBoard,
  upsertClassificationGrade,
  upsertCleaningRule,
  upsertDictionaryField,
  upsertQualityMetric,
} from "../data-suite-store";
import { SAMPLE_BOARD } from "../data-board-fixture";

const ORIGINAL_DIR = process.env.AGX_DATA_SUITE_STORE_DIR;
let tempDir: string;

function restoreEnv() {
  if (ORIGINAL_DIR === undefined) delete process.env.AGX_DATA_SUITE_STORE_DIR;
  else process.env.AGX_DATA_SUITE_STORE_DIR = ORIGINAL_DIR;
}

describe("data-suite-store", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-data-suite-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = tempDir;
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds dictionary on first list and persists upsert", async () => {
    const fields = await listDictionaryFields();
    expect(fields.map((f) => f.name)).toEqual(SAMPLE_DICTIONARY_FIELDS.map((f) => f.name));

    const updated = await upsertDictionaryField({
      name: "member_id",
      business_def: "Updated",
      calc_logic: "x",
      update_freq: "hourly",
      owner: "platform",
    });
    expect(updated.business_def).toBe("Updated");

    const again = await listDictionaryFields();
    expect(again.find((f) => f.name === "member_id")?.update_freq).toBe("hourly");

    const disk = JSON.parse(await readFile(path.join(tempDir, "dictionary.json"), "utf-8")) as {
      fields: { name: string; business_def: string }[];
    };
    expect(disk.fields.find((f) => f.name === "member_id")?.business_def).toBe("Updated");
  });

  it("adds a new dictionary field", async () => {
    await listDictionaryFields();
    await upsertDictionaryField({
      name: "region",
      business_def: "Member region",
      calc_logic: "raw",
      update_freq: "daily",
      owner: "data-platform",
    });
    const names = (await listDictionaryFields()).map((f) => f.name);
    expect(names).toContain("region");
  });

  it("seeds boards and roundtrips upsert by id", async () => {
    const boards = await listBoards();
    expect(boards.some((b) => b.id === SAMPLE_BOARD.id)).toBe(true);

    const created = await upsertBoard({
      id: "ops_board",
      title: "Ops",
      drillLevels: ["region"],
      widgets: [],
    });
    expect(created.id).toBe("ops_board");

    const got = await getBoard("ops_board");
    expect(got?.title).toBe("Ops");

    await upsertBoard({ id: "ops_board", title: "Ops v2", drillLevels: ["region"], widgets: [] });
    expect((await getBoard("ops_board"))?.title).toBe("Ops v2");

    const disk = JSON.parse(await readFile(path.join(tempDir, "boards.json"), "utf-8")) as {
      boards: { id: string; title: string }[];
    };
    expect(disk.boards.find((b) => b.id === "ops_board")?.title).toBe("Ops v2");
  });

  it("seeds cleaning rules and persists upsert", async () => {
    const rules = await listCleaningRules();
    expect(rules.map((r) => r.id)).toEqual(SAMPLE_CLEANING_RULES.map((r) => r.id));

    const updated = await upsertCleaningRule({
      id: "sample_not_null",
      template: "not_null",
      field: "member_id",
      params: {},
      enabled: false,
    });
    expect(updated.enabled).toBe(false);
    expect(updated.field).toBe("member_id");

    await upsertCleaningRule({
      id: "trim_name",
      template: "trim",
      field: "display_name",
      params: {},
      enabled: true,
    });
    const ids = (await listCleaningRules()).map((r) => r.id);
    expect(ids).toContain("trim_name");

    const disk = JSON.parse(await readFile(path.join(tempDir, "cleaning_rules.json"), "utf-8")) as {
      rules: { id: string; enabled: boolean }[];
    };
    expect(disk.rules.find((r) => r.id === "sample_not_null")?.enabled).toBe(false);
  });

  it("seeds classification grades S/A/B/C and upserts", async () => {
    const grades = await listClassificationGrades();
    expect(grades.map((g) => g.id)).toEqual(SAMPLE_CLASSIFICATION_GRADES.map((g) => g.id));
    expect(grades[0].rank).toBe(4);

    await upsertClassificationGrade({ id: "S", label: "Superior", rank: 5 });
    expect((await listClassificationGrades()).find((g) => g.id === "S")?.label).toBe("Superior");

    const disk = JSON.parse(await readFile(path.join(tempDir, "classification.json"), "utf-8")) as {
      grades: { id: string; label: string }[];
    };
    expect(disk.grades.find((g) => g.id === "S")?.label).toBe("Superior");
  });

  it("seeds quality metrics, upserts, and runDay persists last_run", async () => {
    const metrics = await listQualityMetrics();
    expect(metrics.map((m) => m.id)).toEqual(SAMPLE_QUALITY_METRICS.map((m) => m.id));
    expect(await getQualityLastRun()).toBeNull();

    await upsertQualityMetric({ id: "distinct_id", type: "distinct_count", field: "id" });
    const last = await runQualityDay("2026-10-30");
    expect(last.day).toBe("2026-10-30");
    expect(last.metrics.sample_null_rate).toBeCloseTo(1 / 3);
    expect(last.metrics.distinct_id).toBe(1);
    expect((await getQualityLastRun())?.day).toBe("2026-10-30");

    const disk = JSON.parse(await readFile(path.join(tempDir, "quality_metrics.json"), "utf-8")) as {
      last_run: { day: string } | null;
    };
    expect(disk.last_run?.day).toBe("2026-10-30");
  });

  it("appends review actions (audit log)", async () => {
    expect(await listReviewActions()).toEqual([]);
    const a = await appendReviewAction({
      id: "act-1",
      target_rule_id: "sample_not_null",
      decision: "approve",
      note: "ok",
      at: "2026-10-30T09:00:00.000Z",
    });
    expect(a.decision).toBe("approve");
    await appendReviewAction({
      id: "act-2",
      target_rule_id: "sample_not_null",
      decision: "keep",
      note: "",
      at: "2026-10-30T10:00:00.000Z",
    });
    expect((await listReviewActions()).map((x) => x.id)).toEqual(["act-1", "act-2"]);

    await expect(
      appendReviewAction({
        id: "bad",
        target_rule_id: "x",
        decision: "maybe" as "approve",
        note: "",
        at: "",
      }),
    ).rejects.toThrow(/decision/);
  });
});
