import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BoardSpec } from "./data-board-fixture";
import { SAMPLE_BOARD } from "./data-board-fixture";
import {
  SAMPLE_CLASSIFICATION_GRADES,
  SAMPLE_CLEANING_RULES,
  SAMPLE_DICTIONARY_FIELDS,
  SAMPLE_QUALITY_METRICS,
  type ClassificationGrade,
  type CleaningRule,
  type DictionaryField,
  type QualityLastRun,
  type QualityMetric,
  type ReviewAction,
} from "./data-suite-types";

export type { DictionaryField } from "./data-suite-types";
export { SAMPLE_DICTIONARY_FIELDS } from "./data-suite-types";
export type {
  ClassificationGrade,
  CleaningRule,
  QualityLastRun,
  QualityMetric,
  ReviewAction,
} from "./data-suite-types";
export {
  SAMPLE_CLASSIFICATION_GRADES,
  SAMPLE_CLEANING_RULES,
  SAMPLE_QUALITY_METRICS,
} from "./data-suite-types";

type DictionaryFile = { fields: DictionaryField[] };
type BoardsFile = { boards: BoardSpec[] };
type CleaningRulesFile = { rules: CleaningRule[] };
type ClassificationFile = { grades: ClassificationGrade[] };
type QualityMetricsFile = { metrics: QualityMetric[]; last_run: QualityLastRun | null };
type ReviewActionsFile = { actions: ReviewAction[] };

function storeDir(): string {
  const env = process.env.AGX_DATA_SUITE_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/data-suite");
}

function dictionaryPath(): string {
  return path.join(storeDir(), "dictionary.json");
}

function boardsPath(): string {
  return path.join(storeDir(), "boards.json");
}

function cleaningRulesPath(): string {
  return path.join(storeDir(), "cleaning_rules.json");
}

function classificationPath(): string {
  return path.join(storeDir(), "classification.json");
}

function qualityMetricsPath(): string {
  return path.join(storeDir(), "quality_metrics.json");
}

function reviewActionsPath(): string {
  return path.join(storeDir(), "review_actions.json");
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function normalizeField(row: Partial<DictionaryField> & { name: string }): DictionaryField {
  return {
    name: row.name.trim(),
    business_def: String(row.business_def ?? ""),
    calc_logic: String(row.calc_logic ?? ""),
    update_freq: String(row.update_freq ?? ""),
    owner: String(row.owner ?? ""),
  };
}

function normalizeBoard(row: Partial<BoardSpec> & { id: string }): BoardSpec {
  return {
    id: row.id.trim(),
    title: String(row.title ?? row.id),
    drillLevels: Array.isArray(row.drillLevels) ? row.drillLevels.map(String) : [],
    widgets: Array.isArray(row.widgets) ? row.widgets : [],
  };
}

function normalizeCleaningRule(row: Partial<CleaningRule> & { id: string }): CleaningRule {
  return {
    id: row.id.trim(),
    template: String(row.template ?? ""),
    field: String(row.field ?? ""),
    params: row.params && typeof row.params === "object" ? { ...row.params } : {},
    enabled: row.enabled !== false,
  };
}

function normalizeGrade(row: Partial<ClassificationGrade> & { id: string }): ClassificationGrade {
  return {
    id: row.id.trim(),
    label: String(row.label ?? row.id),
    rank: Number(row.rank ?? 0),
  };
}

function normalizeMetric(row: Partial<QualityMetric> & { id: string }): QualityMetric {
  return {
    id: row.id.trim(),
    type: String(row.type ?? ""),
    field: String(row.field ?? ""),
  };
}

function normalizeReviewAction(
  row: Partial<ReviewAction> & { id: string; decision: ReviewAction["decision"] },
): ReviewAction {
  return {
    id: row.id.trim(),
    target_rule_id: String(row.target_rule_id ?? ""),
    decision: row.decision,
    note: String(row.note ?? ""),
    at: String(row.at ?? new Date().toISOString()),
  };
}

async function ensureDictionarySeed(): Promise<DictionaryFile> {
  const file = dictionaryPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<DictionaryFile>(file, { fields: [...SAMPLE_DICTIONARY_FIELDS] });
  } catch {
    const seeded: DictionaryFile = { fields: SAMPLE_DICTIONARY_FIELDS.map((f) => ({ ...f })) };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureBoardsSeed(): Promise<BoardsFile> {
  const file = boardsPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<BoardsFile>(file, { boards: [{ ...SAMPLE_BOARD, widgets: [...SAMPLE_BOARD.widgets] }] });
  } catch {
    const seeded: BoardsFile = {
      boards: [{ ...SAMPLE_BOARD, widgets: SAMPLE_BOARD.widgets.map((w) => ({ ...w })) }],
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureCleaningRulesSeed(): Promise<CleaningRulesFile> {
  const file = cleaningRulesPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<CleaningRulesFile>(file, {
      rules: SAMPLE_CLEANING_RULES.map((r) => ({ ...r, params: { ...r.params } })),
    });
  } catch {
    const seeded: CleaningRulesFile = {
      rules: SAMPLE_CLEANING_RULES.map((r) => ({ ...r, params: { ...r.params } })),
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureClassificationSeed(): Promise<ClassificationFile> {
  const file = classificationPath();
  try {
    await readFile(file, "utf-8");
    const data = await readJsonFile<ClassificationFile>(file, {
      grades: SAMPLE_CLASSIFICATION_GRADES.map((g) => ({ ...g })),
    });
    if (!data.grades?.length) {
      const seeded: ClassificationFile = {
        grades: SAMPLE_CLASSIFICATION_GRADES.map((g) => ({ ...g })),
      };
      await writeJsonFile(file, seeded);
      return seeded;
    }
    return data;
  } catch {
    const seeded: ClassificationFile = {
      grades: SAMPLE_CLASSIFICATION_GRADES.map((g) => ({ ...g })),
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureQualityMetricsSeed(): Promise<QualityMetricsFile> {
  const file = qualityMetricsPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<QualityMetricsFile>(file, {
      metrics: SAMPLE_QUALITY_METRICS.map((m) => ({ ...m })),
      last_run: null,
    });
  } catch {
    const seeded: QualityMetricsFile = {
      metrics: SAMPLE_QUALITY_METRICS.map((m) => ({ ...m })),
      last_run: null,
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureReviewActionsSeed(): Promise<ReviewActionsFile> {
  const file = reviewActionsPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<ReviewActionsFile>(file, { actions: [] });
  } catch {
    const seeded: ReviewActionsFile = { actions: [] };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

export async function listDictionaryFields(): Promise<DictionaryField[]> {
  const data = await ensureDictionarySeed();
  return [...(data.fields ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertDictionaryField(
  input: Partial<DictionaryField> & { name: string },
): Promise<DictionaryField> {
  if (!input.name?.trim()) {
    throw new Error("name required");
  }
  const field = normalizeField(input);
  const data = await ensureDictionarySeed();
  const fields = [...(data.fields ?? [])];
  const idx = fields.findIndex((f) => f.name === field.name);
  if (idx >= 0) fields[idx] = field;
  else fields.push(field);
  fields.sort((a, b) => a.name.localeCompare(b.name));
  await writeJsonFile(dictionaryPath(), { fields });
  return field;
}

export async function listBoards(): Promise<BoardSpec[]> {
  const data = await ensureBoardsSeed();
  return [...(data.boards ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getBoard(id: string): Promise<BoardSpec | null> {
  const boards = await listBoards();
  return boards.find((b) => b.id === id) ?? null;
}

export async function upsertBoard(input: Partial<BoardSpec> & { id: string }): Promise<BoardSpec> {
  if (!input.id?.trim()) {
    throw new Error("id required");
  }
  const board = normalizeBoard(input);
  const data = await ensureBoardsSeed();
  const boards = [...(data.boards ?? [])];
  const idx = boards.findIndex((b) => b.id === board.id);
  if (idx >= 0) boards[idx] = board;
  else boards.push(board);
  boards.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonFile(boardsPath(), { boards });
  return board;
}

export async function listCleaningRules(): Promise<CleaningRule[]> {
  const data = await ensureCleaningRulesSeed();
  return [...(data.rules ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

export async function upsertCleaningRule(
  input: Partial<CleaningRule> & { id: string },
): Promise<CleaningRule> {
  if (!input.id?.trim()) {
    throw new Error("id required");
  }
  const rule = normalizeCleaningRule(input);
  const data = await ensureCleaningRulesSeed();
  const rules = [...(data.rules ?? [])];
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);
  rules.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonFile(cleaningRulesPath(), { rules });
  return rule;
}

export async function listClassificationGrades(): Promise<ClassificationGrade[]> {
  const data = await ensureClassificationSeed();
  return [...(data.grades ?? [])].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

export async function upsertClassificationGrade(
  input: Partial<ClassificationGrade> & { id: string },
): Promise<ClassificationGrade> {
  if (!input.id?.trim()) {
    throw new Error("id required");
  }
  const grade = normalizeGrade(input);
  const data = await ensureClassificationSeed();
  const grades = [...(data.grades ?? [])];
  const idx = grades.findIndex((g) => g.id === grade.id);
  if (idx >= 0) grades[idx] = grade;
  else grades.push(grade);
  grades.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  await writeJsonFile(classificationPath(), { grades });
  return grade;
}

export async function listQualityMetrics(): Promise<QualityMetric[]> {
  const data = await ensureQualityMetricsSeed();
  return [...(data.metrics ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getQualityLastRun(): Promise<QualityLastRun | null> {
  const data = await ensureQualityMetricsSeed();
  return data.last_run ?? null;
}

export async function upsertQualityMetric(
  input: Partial<QualityMetric> & { id: string },
): Promise<QualityMetric> {
  if (!input.id?.trim()) {
    throw new Error("id required");
  }
  const metric = normalizeMetric(input);
  const data = await ensureQualityMetricsSeed();
  const metrics = [...(data.metrics ?? [])];
  const idx = metrics.findIndex((m) => m.id === metric.id);
  if (idx >= 0) metrics[idx] = metric;
  else metrics.push(metric);
  metrics.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonFile(qualityMetricsPath(), { metrics, last_run: data.last_run ?? null });
  return metric;
}

/** Stub one-day quality rollup over tiny fixture rows; persists last_run. */
export async function runQualityDay(day: string, rows?: Record<string, unknown>[]): Promise<QualityLastRun> {
  const data = await ensureQualityMetricsSeed();
  const metrics = data.metrics ?? [];
  const fixture =
    rows ??
    [
      { id: "1" },
      { id: null },
      { id: "1" },
    ];
  const n = fixture.length;
  const denom = Math.max(n, 1);
  const out: Record<string, number> = {};
  for (const m of metrics) {
    if (m.type === "null_rate") {
      const nulls = fixture.filter((r) => r[m.field] == null || r[m.field] === "").length;
      out[m.id] = nulls / denom;
    } else if (m.type === "distinct_count") {
      const vals = new Set(
        fixture
          .map((r) => r[m.field])
          .filter((v) => v != null && v !== ""),
      );
      out[m.id] = vals.size;
    } else if (m.type === "rule_fail_rate") {
      out[m.id] = 0;
    } else {
      out[m.id] = 0;
    }
  }
  const last_run: QualityLastRun = {
    day,
    metrics: out,
    meta: { row_count: n, quarantine_count: 0 },
  };
  await writeJsonFile(qualityMetricsPath(), { metrics, last_run });
  return last_run;
}

export async function listReviewActions(): Promise<ReviewAction[]> {
  const data = await ensureReviewActionsSeed();
  return [...(data.actions ?? [])];
}

export async function appendReviewAction(
  input: Partial<ReviewAction> & { id: string; decision: ReviewAction["decision"] },
): Promise<ReviewAction> {
  if (!input.id?.trim()) {
    throw new Error("id required");
  }
  if (!["approve", "reject", "keep"].includes(input.decision)) {
    throw new Error("decision must be approve|reject|keep");
  }
  const action = normalizeReviewAction(input);
  const data = await ensureReviewActionsSeed();
  const actions = [...(data.actions ?? []), action];
  await writeJsonFile(reviewActionsPath(), { actions });
  return action;
}
