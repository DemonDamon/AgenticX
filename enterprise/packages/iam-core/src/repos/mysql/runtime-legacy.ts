import {
  enterpriseRuntimeModelProviders,
  enterpriseRuntimeTokenQuotas,
  enterpriseRuntimeUserVisibleModels,
} from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

export async function mysqlHasRuntimeRows(
  kind: "providers" | "user-models" | "quotas",
  tenantId: string,
): Promise<boolean> {
  const db = await getMysqlRepositoryDb();
  if (kind === "providers") {
    const rows = await db.select({ id: enterpriseRuntimeModelProviders.id })
      .from(enterpriseRuntimeModelProviders)
      .where(eq(enterpriseRuntimeModelProviders.tenantId, tenantId))
      .limit(1);
    return rows.length > 0;
  }
  if (kind === "user-models") {
    const rows = await db.select({ modelId: enterpriseRuntimeUserVisibleModels.modelId })
      .from(enterpriseRuntimeUserVisibleModels)
      .where(eq(enterpriseRuntimeUserVisibleModels.tenantId, tenantId))
      .limit(1);
    return rows.length > 0;
  }
  const rows = await db.select({ tenantId: enterpriseRuntimeTokenQuotas.tenantId })
    .from(enterpriseRuntimeTokenQuotas)
    .where(eq(enterpriseRuntimeTokenQuotas.tenantId, tenantId))
    .limit(1);
  return rows.length > 0;
}

export async function insertMysqlRuntimeProviders(
  rows: Array<typeof enterpriseRuntimeModelProviders.$inferInsert>,
): Promise<void> {
  if (!rows.length) return;
  const db = await getMysqlRepositoryDb();
  await db.insert(enterpriseRuntimeModelProviders).values(rows);
}

export async function insertMysqlUserVisibleModels(
  rows: Array<typeof enterpriseRuntimeUserVisibleModels.$inferInsert>,
): Promise<void> {
  if (!rows.length) return;
  const db = await getMysqlRepositoryDb();
  for (const row of rows) {
    await db.insert(enterpriseRuntimeUserVisibleModels).values(row).onDuplicateKeyUpdate({
      set: { modelId: row.modelId },
    });
  }
}

export async function insertMysqlRuntimeQuota(
  row: typeof enterpriseRuntimeTokenQuotas.$inferInsert,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(enterpriseRuntimeTokenQuotas).values(row);
}
