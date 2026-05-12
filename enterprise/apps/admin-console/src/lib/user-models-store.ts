/**
 * admin-console · 用户 ↔ 模型可见性映射（PostgreSQL）。
 * 原为 enterprise/.runtime/admin/user-models.json。
 */

import { enterpriseRuntimeUserVisibleModels as uvmTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import * as fs from "node:fs";
import * as path from "node:path";
import { sql, eq, and } from "drizzle-orm";

const RUNTIME_DIR = path.resolve(process.cwd(), "../../.runtime/admin");
const LEGACY_PATH = path.join(RUNTIME_DIR, "user-models.json");

let legacyMigrationRan = false;

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for user-visible model assignments.");
  return t;
}

type Mapping = Record<string, string[]>;

async function migrateLegacyIfNeeded(tid: string): Promise<void> {
  if (legacyMigrationRan) return;
  legacyMigrationRan = true;
  const db = getIamDb();
  const existing = await db.select({ modelId: uvmTable.modelId }).from(uvmTable).where(eq(uvmTable.tenantId, tid)).limit(1);
  if (existing.length > 0) return;
  if (!fs.existsSync(LEGACY_PATH)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_PATH, "utf-8")) as { userModels?: Mapping };
    const userModels = parsed.userModels ?? {};
    const rows = Object.entries(userModels).flatMap(([assignmentKey, modelIds]) =>
      (modelIds ?? []).filter(Boolean).map((modelId) => ({
        tenantId: tid,
        assignmentKey,
        modelId: modelId.trim(),
      }))
    );
    if (rows.length === 0) return;
    for (const chunk of chunked(rows, 200)) {
      await db.insert(uvmTable).values(chunk).onConflictDoNothing();
    }
  } catch {
    /* ignore */
  }
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function getUserModels(userId: string): Promise<string[]> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getIamDb();
  const rows = await db
    .select({ modelId: uvmTable.modelId })
    .from(uvmTable)
    .where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, userId)));
  return [...new Set(rows.map((r) => r.modelId))];
}

export async function setUserModels(userId: string, modelIds: string[]): Promise<string[]> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getIamDb();
  const unique = Array.from(new Set(modelIds.map((m) => m.trim()).filter(Boolean)));
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, userId)));
  if (unique.length === 0) return [];
  const rows = unique.map((modelId) => ({ tenantId: tid, assignmentKey: userId, modelId }));
  for (const chunk of chunked(rows, 100)) {
    await db.insert(uvmTable).values(chunk).onConflictDoNothing();
  }
  return [...unique];
}

export async function listAllAssignments(): Promise<Mapping> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getIamDb();
  const rows = await db.select().from(uvmTable).where(eq(uvmTable.tenantId, tid));
  const map: Mapping = {};
  for (const r of rows) {
    if (!map[r.assignmentKey]) map[r.assignmentKey] = [];
    map[r.assignmentKey]!.push(r.modelId);
  }
  for (const k of Object.keys(map)) {
    map[k] = [...new Set(map[k]!)];
  }
  return map;
}

export async function deleteUserAssignment(userId: string): Promise<void> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getIamDb();
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, userId)));
}

export function userModelsFilePath(): string {
  return LEGACY_PATH;
}

export function __resetUserModelsCache(): void {
  legacyMigrationRan = false;
}
