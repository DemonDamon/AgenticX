import { validateRubric } from "@agenticx/core-api/managed-evals";
import {
  maEvalDatasetItems as pgItems,
  maEvalDatasets as pgDatasets,
  maEvalRubrics as pgRubrics,
} from "@agenticx/db-schema";
import {
  maEvalDatasetItems as mysqlItems,
  maEvalDatasets as mysqlDatasets,
  maEvalRubrics as mysqlRubrics,
} from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { getMysqlRepositoryDb } from "./mysql/db";

export const EVAL_DATASET_ITEM_LIMIT = 500;

export class EvalDatasetLimitError extends Error {
  constructor(message = "每个评测集最多 500 条用例") {
    super(message);
    this.name = "EvalDatasetLimitError";
  }
}

export class EvalRubricInvalidError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super("评分标准不合法");
    this.name = "EvalRubricInvalidError";
    this.errors = errors;
  }
}

export class EvalNameConflictError extends Error {
  constructor(message = "名称已存在") {
    super(message);
    this.name = "EvalNameConflictError";
  }
}

export class EvalDatasetNotFoundError extends Error {
  constructor(message = "评测集不存在") {
    super(message);
    this.name = "EvalDatasetNotFoundError";
  }
}

export class EvalItemNotFoundError extends Error {
  constructor(message = "用例不存在") {
    super(message);
    this.name = "EvalItemNotFoundError";
  }
}

export class EvalRubricNotFoundError extends Error {
  constructor(message = "评分标准不存在") {
    super(message);
    this.name = "EvalRubricNotFoundError";
  }
}

export class EvalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalValidationError";
  }
}

export type EvalDataset = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvalDatasetItem = {
  id: string;
  tenantId: string;
  datasetId: string;
  position: number;
  query: string;
  expectedAnswer: string | null;
  expectedToolTrace: string[] | null;
  tags: string[];
  sourceSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvalItemInput = {
  query: string;
  expectedAnswer?: string | null;
  expectedToolTrace?: string[] | null;
  tags?: string[];
  sourceSessionId?: string | null;
};

export type EvalRubric = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  version: number;
  content: Record<string, unknown>;
  contentHash: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type DatasetRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ItemRow = {
  id: string;
  tenantId: string;
  datasetId: string;
  position: number;
  query: string;
  expectedAnswer: string | null;
  expectedToolTrace: string[] | null;
  tags: string[];
  sourceSessionId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RubricRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  version: number;
  content: Record<string, unknown>;
  contentHash: string;
  createdBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MemoryState = {
  datasets: DatasetRow[];
  items: ItemRow[];
  rubrics: RubricRow[];
};

let memoryState: MemoryState | null = null;

/** Unit tests bind an in-memory store so they do not need DATABASE_URL. */
export function __useMemoryEvalStoreForTests(): void {
  memoryState = { datasets: [], items: [], rubrics: [] };
}

export function __resetMemoryEvalStoreForTests(): void {
  memoryState = null;
}

export function evalMemoryState(): MemoryState | null {
  return memoryState;
}

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value == null) return fallback;
  return value as T;
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    current = coded.cause;
  }
  return false;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw new EvalValidationError("名称不能为空");
  const name = value.trim();
  if (!name || name.length > 128) throw new EvalValidationError("名称须为 1–128 个字符");
  return name;
}

function normalizeDescription(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new EvalValidationError("描述不合法");
  const text = value.trim();
  if (!text) return null;
  if (text.length > 1024) throw new EvalValidationError("描述不能超过 1024 字");
  return text;
}

function toDataset(row: DatasetRow): EvalDataset {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    itemCount: Number(row.itemCount),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toItem(row: ItemRow): EvalDatasetItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    datasetId: row.datasetId,
    position: Number(row.position),
    query: row.query,
    expectedAnswer: row.expectedAnswer,
    expectedToolTrace: asJson(row.expectedToolTrace, null),
    tags: asJson(row.tags, []),
    sourceSessionId: row.sourceSessionId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toRubric(row: RubricRow): EvalRubric {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    version: Number(row.version),
    content: asJson(row.content, {}),
    contentHash: row.contentHash,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapDataset(row: Record<string, unknown>): DatasetRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    itemCount: Number(row.itemCount),
    createdBy: row.createdBy == null ? null : String(row.createdBy),
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  };
}

function mapItem(row: Record<string, unknown>): ItemRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    datasetId: String(row.datasetId),
    position: Number(row.position),
    query: String(row.query),
    expectedAnswer: row.expectedAnswer == null ? null : String(row.expectedAnswer),
    expectedToolTrace: asJson(row.expectedToolTrace, null),
    tags: asJson(row.tags, []),
    sourceSessionId: row.sourceSessionId == null ? null : String(row.sourceSessionId),
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  };
}

function mapRubric(row: Record<string, unknown>): RubricRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    version: Number(row.version),
    content: asJson(row.content, {}),
    contentHash: String(row.contentHash),
    createdBy: row.createdBy == null ? null : String(row.createdBy),
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  };
}

async function selectDatasets(tenantId: string): Promise<DatasetRow[]> {
  if (memoryState) {
    return memoryState.datasets
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => iso(b.updatedAt).localeCompare(iso(a.updatedAt)));
  }
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlDatasets)
        .where(eq(mysqlDatasets.tenantId, tenantId))
        .orderBy(desc(mysqlDatasets.updatedAt))
    : await getIamDb()
        .select()
        .from(pgDatasets)
        .where(eq(pgDatasets.tenantId, tenantId))
        .orderBy(desc(pgDatasets.updatedAt));
  return (rows as Record<string, unknown>[]).map(mapDataset);
}

async function findDataset(tenantId: string, id: string): Promise<DatasetRow | null> {
  if (memoryState) {
    return memoryState.datasets.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
  }
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlDatasets)
        .where(and(eq(mysqlDatasets.tenantId, tenantId), eq(mysqlDatasets.id, id)))
        .limit(1)
    : await getIamDb()
        .select()
        .from(pgDatasets)
        .where(and(eq(pgDatasets.tenantId, tenantId), eq(pgDatasets.id, id)))
        .limit(1);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapDataset(row) : null;
}

export async function listEvalDatasets(tenantId: string): Promise<EvalDataset[]> {
  return (await selectDatasets(tenantId)).map(toDataset);
}

export async function createEvalDataset(
  tenantId: string,
  input: { name: string; description?: string | null },
  createdBy: string | null,
): Promise<EvalDataset> {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const now = new Date();
  const row: DatasetRow = {
    id: ulid(),
    tenantId,
    name,
    description,
    itemCount: 0,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  if (memoryState) {
    if (memoryState.datasets.some((item) => item.tenantId === tenantId && item.name === name)) {
      throw new EvalNameConflictError();
    }
    memoryState.datasets.push(row);
    return toDataset(row);
  }
  try {
    if (isMysql()) await (await getMysqlRepositoryDb()).insert(mysqlDatasets).values(row as never);
    else await getIamDb().insert(pgDatasets).values(row as never);
  } catch (error) {
    if (isUniqueViolation(error)) throw new EvalNameConflictError();
    throw error;
  }
  return toDataset(row);
}

export async function updateEvalDataset(
  tenantId: string,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<EvalDataset> {
  const existing = await findDataset(tenantId, id);
  if (!existing) throw new EvalDatasetNotFoundError();
  const name = patch.name === undefined ? existing.name : normalizeName(patch.name);
  const description = patch.description === undefined ? existing.description : normalizeDescription(patch.description);
  const now = new Date();
  if (memoryState) {
    if (
      memoryState.datasets.some((item) => item.tenantId === tenantId && item.name === name && item.id !== id)
    ) {
      throw new EvalNameConflictError();
    }
    existing.name = name;
    existing.description = description;
    existing.updatedAt = now;
    return toDataset(existing);
  }
  try {
    if (isMysql()) {
      await (await getMysqlRepositoryDb())
        .update(mysqlDatasets)
        .set({ name, description, updatedAt: now })
        .where(and(eq(mysqlDatasets.tenantId, tenantId), eq(mysqlDatasets.id, id)));
    } else {
      await getIamDb()
        .update(pgDatasets)
        .set({ name, description, updatedAt: now })
        .where(and(eq(pgDatasets.tenantId, tenantId), eq(pgDatasets.id, id)));
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new EvalNameConflictError();
    throw error;
  }
  return toDataset({ ...existing, name, description, updatedAt: now });
}

export async function deleteEvalDataset(tenantId: string, id: string): Promise<void> {
  const existing = await findDataset(tenantId, id);
  if (!existing) throw new EvalDatasetNotFoundError();
  if (memoryState) {
    memoryState.datasets = memoryState.datasets.filter((row) => row.id !== id);
    memoryState.items = memoryState.items.filter((row) => row.datasetId !== id);
    return;
  }
  if (isMysql()) {
    await (await getMysqlRepositoryDb())
      .delete(mysqlDatasets)
      .where(and(eq(mysqlDatasets.tenantId, tenantId), eq(mysqlDatasets.id, id)));
    return;
  }
  await getIamDb().delete(pgDatasets).where(and(eq(pgDatasets.tenantId, tenantId), eq(pgDatasets.id, id)));
}

async function listItemRows(tenantId: string, datasetId: string): Promise<ItemRow[]> {
  if (memoryState) {
    return memoryState.items
      .filter((row) => row.tenantId === tenantId && row.datasetId === datasetId)
      .sort((a, b) => a.position - b.position);
  }
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlItems)
        .where(and(eq(mysqlItems.tenantId, tenantId), eq(mysqlItems.datasetId, datasetId)))
        .orderBy(asc(mysqlItems.position))
    : await getIamDb()
        .select()
        .from(pgItems)
        .where(and(eq(pgItems.tenantId, tenantId), eq(pgItems.datasetId, datasetId)))
        .orderBy(asc(pgItems.position));
  return (rows as Record<string, unknown>[]).map(mapItem);
}

export async function listEvalDatasetItems(tenantId: string, datasetId: string): Promise<EvalDatasetItem[]> {
  if (!(await findDataset(tenantId, datasetId))) throw new EvalDatasetNotFoundError();
  return (await listItemRows(tenantId, datasetId)).map(toItem);
}

function normalizeItem(input: EvalItemInput): Omit<ItemRow, "id" | "tenantId" | "datasetId" | "position" | "createdAt" | "updatedAt"> {
  if (typeof input.query !== "string" || input.query.length === 0) throw new EvalValidationError("query 不能为空");
  if (input.query.length > 20000) throw new EvalValidationError("query 超过 20000 字");
  const expected = input.expectedAnswer ?? null;
  if (expected != null && (typeof expected !== "string" || expected.length > 20000)) {
    throw new EvalValidationError("expected_answer 超过 20000 字");
  }
  const trace = input.expectedToolTrace ?? null;
  if (trace != null && (!Array.isArray(trace) || trace.some((name) => typeof name !== "string"))) {
    throw new EvalValidationError("expected_tool_trace 格式不正确");
  }
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new EvalValidationError("tags 格式不正确");
  }
  return {
    query: input.query,
    expectedAnswer: expected,
    expectedToolTrace: trace,
    tags,
    sourceSessionId: input.sourceSessionId ?? null,
  };
}

export async function appendEvalDatasetItems(
  tenantId: string,
  datasetId: string,
  items: EvalItemInput[],
): Promise<EvalDatasetItem[]> {
  const dataset = await findDataset(tenantId, datasetId);
  if (!dataset) throw new EvalDatasetNotFoundError();
  const normalized = items.map(normalizeItem);
  const current = await listItemRows(tenantId, datasetId);
  if (current.length + normalized.length > EVAL_DATASET_ITEM_LIMIT) throw new EvalDatasetLimitError();
  const maxPosition = current.reduce((max, row) => Math.max(max, row.position), 0);
  const now = new Date();
  const created: ItemRow[] = normalized.map((item, index) => ({
    id: ulid(),
    tenantId,
    datasetId,
    position: maxPosition + index + 1,
    ...item,
    createdAt: now,
    updatedAt: now,
  }));
  const nextCount = current.length + created.length;
  if (memoryState) {
    memoryState.items.push(...created);
    dataset.itemCount = nextCount;
    dataset.updatedAt = now;
    return created.map(toItem);
  }
  const write = async (tx: {
    insert: (table: typeof pgItems | typeof mysqlItems) => { values: (rows: ItemRow[]) => Promise<unknown> };
    update: (table: typeof pgDatasets | typeof mysqlDatasets) => {
      set: (value: { itemCount: number; updatedAt: Date }) => { where: (clause: unknown) => Promise<unknown> };
    };
  }, datasets: typeof pgDatasets | typeof mysqlDatasets, itemTable: typeof pgItems | typeof mysqlItems) => {
    if (created.length > 0) await tx.insert(itemTable).values(created);
    await tx
      .update(datasets)
      .set({ itemCount: nextCount, updatedAt: now })
      .where(and(eq(datasets.tenantId, tenantId), eq(datasets.id, datasetId)));
  };
  if (isMysql()) {
    const db = await getMysqlRepositoryDb();
    await db.transaction(async (tx) => {
      await write(tx as never, mysqlDatasets, mysqlItems);
    });
  } else {
    await getIamDb().transaction(async (tx) => {
      await write(tx as never, pgDatasets, pgItems);
    });
  }
  return created.map(toItem);
}

export async function updateEvalDatasetItem(
  tenantId: string,
  datasetId: string,
  itemId: string,
  patch: Partial<EvalItemInput>,
): Promise<EvalDatasetItem> {
  const rows = await listItemRows(tenantId, datasetId);
  const existing = rows.find((row) => row.id === itemId);
  if (!existing) throw new EvalItemNotFoundError();
  const next = normalizeItem({
    query: patch.query ?? existing.query,
    expectedAnswer: patch.expectedAnswer === undefined ? existing.expectedAnswer : patch.expectedAnswer,
    expectedToolTrace: patch.expectedToolTrace === undefined ? existing.expectedToolTrace : patch.expectedToolTrace,
    tags: patch.tags ?? existing.tags,
    sourceSessionId: patch.sourceSessionId === undefined ? existing.sourceSessionId : patch.sourceSessionId,
  });
  const now = new Date();
  if (memoryState) {
    Object.assign(existing, next, { updatedAt: now });
    return toItem(existing);
  }
  if (isMysql()) {
    await (await getMysqlRepositoryDb())
      .update(mysqlItems)
      .set({ ...next, updatedAt: now })
      .where(and(eq(mysqlItems.tenantId, tenantId), eq(mysqlItems.id, itemId)));
  } else {
    await getIamDb()
      .update(pgItems)
      .set({ ...next, updatedAt: now })
      .where(and(eq(pgItems.tenantId, tenantId), eq(pgItems.id, itemId)));
  }
  return toItem({ ...existing, ...next, updatedAt: now });
}

export async function deleteEvalDatasetItem(tenantId: string, datasetId: string, itemId: string): Promise<void> {
  const dataset = await findDataset(tenantId, datasetId);
  if (!dataset) throw new EvalDatasetNotFoundError();
  const rows = await listItemRows(tenantId, datasetId);
  if (!rows.some((row) => row.id === itemId)) throw new EvalItemNotFoundError();
  const now = new Date();
  const nextCount = rows.length - 1;
  if (memoryState) {
    memoryState.items = memoryState.items.filter((row) => row.id !== itemId);
    dataset.itemCount = nextCount;
    dataset.updatedAt = now;
    return;
  }
  if (isMysql()) {
    const db = await getMysqlRepositoryDb();
    await db.transaction(async (tx) => {
      await tx.delete(mysqlItems).where(and(eq(mysqlItems.tenantId, tenantId), eq(mysqlItems.id, itemId)));
      await tx
        .update(mysqlDatasets)
        .set({ itemCount: nextCount, updatedAt: now })
        .where(and(eq(mysqlDatasets.tenantId, tenantId), eq(mysqlDatasets.id, datasetId)));
    });
    return;
  }
  await getIamDb().transaction(async (tx) => {
    await tx.delete(pgItems).where(and(eq(pgItems.tenantId, tenantId), eq(pgItems.id, itemId)));
    await tx
      .update(pgDatasets)
      .set({ itemCount: nextCount, updatedAt: now })
      .where(and(eq(pgDatasets.tenantId, tenantId), eq(pgDatasets.id, datasetId)));
  });
}

async function selectRubrics(tenantId: string): Promise<RubricRow[]> {
  if (memoryState) {
    return memoryState.rubrics
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => iso(b.updatedAt).localeCompare(iso(a.updatedAt)));
  }
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlRubrics)
        .where(eq(mysqlRubrics.tenantId, tenantId))
        .orderBy(desc(mysqlRubrics.updatedAt))
    : await getIamDb()
        .select()
        .from(pgRubrics)
        .where(eq(pgRubrics.tenantId, tenantId))
        .orderBy(desc(pgRubrics.updatedAt));
  return (rows as Record<string, unknown>[]).map(mapRubric);
}

async function findRubric(tenantId: string, id: string): Promise<RubricRow | null> {
  if (memoryState) return memoryState.rubrics.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
  const rows = isMysql()
    ? await (await getMysqlRepositoryDb())
        .select()
        .from(mysqlRubrics)
        .where(and(eq(mysqlRubrics.tenantId, tenantId), eq(mysqlRubrics.id, id)))
        .limit(1)
    : await getIamDb()
        .select()
        .from(pgRubrics)
        .where(and(eq(pgRubrics.tenantId, tenantId), eq(pgRubrics.id, id)))
        .limit(1);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapRubric(row) : null;
}

export async function listEvalRubrics(tenantId: string): Promise<EvalRubric[]> {
  return (await selectRubrics(tenantId)).map(toRubric);
}

export async function createEvalRubric(
  tenantId: string,
  input: { name: string; description?: string | null; content: unknown },
  createdBy: string | null,
): Promise<EvalRubric> {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const checked = validateRubric(input.content);
  if (!checked.ok || !checked.normalized || !checked.contentHash) throw new EvalRubricInvalidError(checked.errors);
  const now = new Date();
  const row: RubricRow = {
    id: ulid(),
    tenantId,
    name,
    description,
    version: 1,
    content: checked.normalized,
    contentHash: checked.contentHash,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  if (memoryState) {
    if (memoryState.rubrics.some((item) => item.tenantId === tenantId && item.name === name)) {
      throw new EvalNameConflictError();
    }
    memoryState.rubrics.push(row);
    return toRubric(row);
  }
  try {
    if (isMysql()) await (await getMysqlRepositoryDb()).insert(mysqlRubrics).values(row as never);
    else await getIamDb().insert(pgRubrics).values(row as never);
  } catch (error) {
    if (isUniqueViolation(error)) throw new EvalNameConflictError();
    throw error;
  }
  return toRubric(row);
}

export async function updateEvalRubric(
  tenantId: string,
  id: string,
  patch: { name?: string; description?: string | null; content?: unknown },
): Promise<EvalRubric> {
  const existing = await findRubric(tenantId, id);
  if (!existing) throw new EvalRubricNotFoundError();
  const name = patch.name === undefined ? existing.name : normalizeName(patch.name);
  const description = patch.description === undefined ? existing.description : normalizeDescription(patch.description);
  let content = existing.content;
  let contentHash = existing.contentHash;
  let version = existing.version;
  if (patch.content !== undefined) {
    const checked = validateRubric(patch.content);
    if (!checked.ok || !checked.normalized || !checked.contentHash) throw new EvalRubricInvalidError(checked.errors);
    if (checked.contentHash !== existing.contentHash) {
      content = checked.normalized;
      contentHash = checked.contentHash;
      version += 1;
    }
  }
  const now = new Date();
  if (memoryState) {
    if (memoryState.rubrics.some((item) => item.tenantId === tenantId && item.name === name && item.id !== id)) {
      throw new EvalNameConflictError();
    }
    Object.assign(existing, { name, description, content, contentHash, version, updatedAt: now });
    return toRubric(existing);
  }
  try {
    const values = { name, description, content, contentHash, version, updatedAt: now };
    if (isMysql()) {
      await (await getMysqlRepositoryDb())
        .update(mysqlRubrics)
        .set(values)
        .where(and(eq(mysqlRubrics.tenantId, tenantId), eq(mysqlRubrics.id, id)));
    } else {
      await getIamDb()
        .update(pgRubrics)
        .set(values)
        .where(and(eq(pgRubrics.tenantId, tenantId), eq(pgRubrics.id, id)));
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new EvalNameConflictError();
    throw error;
  }
  return toRubric({ ...existing, name, description, content, contentHash, version, updatedAt: now });
}

export async function deleteEvalRubric(tenantId: string, id: string): Promise<void> {
  const existing = await findRubric(tenantId, id);
  if (!existing) throw new EvalRubricNotFoundError();
  if (memoryState) {
    memoryState.rubrics = memoryState.rubrics.filter((row) => row.id !== id);
    return;
  }
  if (isMysql()) {
    await (await getMysqlRepositoryDb())
      .delete(mysqlRubrics)
      .where(and(eq(mysqlRubrics.tenantId, tenantId), eq(mysqlRubrics.id, id)));
    return;
  }
  await getIamDb().delete(pgRubrics).where(and(eq(pgRubrics.tenantId, tenantId), eq(pgRubrics.id, id)));
}
