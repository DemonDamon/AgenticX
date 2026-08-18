/**
 * 个人关闭记录（能力 + 模型）的读写。
 *
 * 只记「关掉了什么」——用户无权开启企业没给的东西，所以「打开」就是删掉这一行，
 * 没有反向的表。存服务端而非本机：本机存的话换台电脑或重装就全部复原成开启，
 * 也无法审计。
 */

import {
  enterpriseRuntimeTokenQuotas as pgQuotas,
  enterpriseUserOptOuts as pgOptOuts,
} from "@agenticx/db-schema";
import { modelOptOutSubject } from "@agenticx/config";
import { and, eq, inArray } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import {
  mysqlDeleteOptOuts,
  mysqlInsertOptOuts,
  mysqlListOptOuts,
  mysqlListTenantOptOuts,
  mysqlReadQuotaConfigRow,
} from "./mysql/user-opt-outs";

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function clean(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

export async function listUserOptOuts(tenantId: string, userId: string): Promise<string[]> {
  const id = String(userId ?? "").trim();
  if (!id) return [];
  await migrateLegacyModelExclusionsIfNeeded(tenantId);
  const rows = isMysql()
    ? await mysqlListOptOuts(tenantId, id)
    : await getIamDb()
        .select({ subject: pgOptOuts.subject })
        .from(pgOptOuts)
        .where(and(eq(pgOptOuts.tenantId, tenantId), eq(pgOptOuts.userId, id)));
  return [...new Set(rows.map((row) => row.subject))].sort();
}

/**
 * 整租户的关闭记录，按用户分组。
 *
 * 概览页要为每个成员算「他关掉了什么」，逐人查会变成 N 次往返；这张表按租户很小，
 * 一次取回来在内存里分组更划算。
 */
export async function listTenantOptOuts(tenantId: string): Promise<Map<string, string[]>> {
  await migrateLegacyModelExclusionsIfNeeded(tenantId);
  const rows = isMysql()
    ? await mysqlListTenantOptOuts(tenantId)
    : await getIamDb()
        .select({ userId: pgOptOuts.userId, subject: pgOptOuts.subject })
        .from(pgOptOuts)
        .where(eq(pgOptOuts.tenantId, tenantId));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const list = out.get(row.userId) ?? [];
    list.push(row.subject);
    out.set(row.userId, list);
  }
  return out;
}

/** 关掉（disabled=true）或打开（false）一件东西。 */
export async function setUserOptOut(
  tenantId: string,
  userId: string,
  subject: string,
  disabled: boolean,
): Promise<void> {
  const id = String(userId ?? "").trim();
  const key = String(subject ?? "").trim();
  if (!id || !key) return;
  // 先删后插而不是 upsert：两种方言的冲突语法不同，而这张表只有主键没有其他列。
  await removeSubjects(tenantId, id, [key]);
  if (!disabled) return;
  const now = new Date();
  const rows = [{ tenantId, userId: id, subject: key, createdAt: now, updatedAt: now }];
  if (isMysql()) await mysqlInsertOptOuts(rows);
  else await getIamDb().insert(pgOptOuts).values(rows).onConflictDoNothing();
}

/** 整体替换某个用户在某一类主体下的关闭清单（模型编辑页按这个保存）。 */
export async function replaceUserOptOutSubjects(
  tenantId: string,
  userId: string,
  subjects: readonly string[],
  matches: (subject: string) => boolean,
): Promise<string[]> {
  const id = String(userId ?? "").trim();
  if (!id) return [];
  const wanted = clean(subjects).filter(matches);
  const current = await listUserOptOuts(tenantId, id);
  const stale = current.filter((subject) => matches(subject) && !wanted.includes(subject));
  if (stale.length > 0) await removeSubjects(tenantId, id, stale);
  const added = wanted.filter((subject) => !current.includes(subject));
  if (added.length > 0) {
    const now = new Date();
    const rows = added.map((subject) => ({
      tenantId,
      userId: id,
      subject,
      createdAt: now,
      updatedAt: now,
    }));
    if (isMysql()) await mysqlInsertOptOuts(rows);
    else await getIamDb().insert(pgOptOuts).values(rows).onConflictDoNothing();
  }
  return wanted;
}

async function removeSubjects(
  tenantId: string,
  userId: string,
  subjects: readonly string[],
): Promise<void> {
  if (subjects.length === 0) return;
  if (isMysql()) {
    await mysqlDeleteOptOuts(tenantId, userId, subjects);
    return;
  }
  await getIamDb()
    .delete(pgOptOuts)
    .where(
      and(
        eq(pgOptOuts.tenantId, tenantId),
        eq(pgOptOuts.userId, userId),
        inArray(pgOptOuts.subject, [...subjects]),
      ),
    );
}

let migratedTenants = new Set<string>();

/**
 * 把配额 JSON 里的 modelExclusions 搬进这张表。
 *
 * 每个进程对每个租户只跑一次：判据是表里已有 `model:` 行，而「一条都没关过」是
 * 合法状态，光看表会每次都重跑一遍全量扫描。
 */
export async function migrateLegacyModelExclusionsIfNeeded(tenantId: string): Promise<void> {
  if (migratedTenants.has(tenantId)) return;
  migratedTenants.add(tenantId);
  try {
    const rows = isMysql()
      ? await mysqlReadQuotaConfigRow(tenantId)
      : await getIamDb()
          .select({ config: pgQuotas.config })
          .from(pgQuotas)
          .where(eq(pgQuotas.tenantId, tenantId))
          .limit(1);
    const config = rows[0]?.config as Record<string, unknown> | undefined;
    const exclusions = config?.modelExclusions;
    if (!exclusions || typeof exclusions !== "object" || Array.isArray(exclusions)) return;
    const now = new Date();
    const pending: Array<{
      tenantId: string;
      userId: string;
      subject: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    for (const [userId, modelIds] of Object.entries(exclusions as Record<string, unknown>)) {
      if (!Array.isArray(modelIds)) continue;
      for (const modelId of clean(modelIds.map(String))) {
        pending.push({
          tenantId,
          userId,
          subject: modelOptOutSubject(modelId),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (pending.length === 0) return;
    if (isMysql()) await mysqlInsertOptOuts(pending);
    else await getIamDb().insert(pgOptOuts).values(pending).onConflictDoNothing();
  } catch {
    // 迁移失败不该让读取整体失败；下次进程重启再试。
    migratedTenants.delete(tenantId);
  }
}

/** 测试用：清掉进程内的「已迁移」记忆。 */
export function resetLegacyModelExclusionMigration(): void {
  migratedTenants = new Set<string>();
}
