import { enterpriseRuntimeVirtualModels as table } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

import {
  parseTargets,
  requiredTenantId,
  timeText,
  validateVirtualModelInput,
  type VirtualModelInput,
  type VirtualModelRecord,
} from "../../virtual-models-shared";

function toRecord(row: {
  id: string;
  tenantId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  targets: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}): VirtualModelRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    displayName: row.displayName,
    enabled: row.enabled,
    targets: parseTargets(row.targets),
    createdAt: timeText(row.createdAt),
    updatedAt: timeText(row.updatedAt),
  };
}

async function loadAll(tenantId: string): Promise<VirtualModelRecord[]> {
  const db = getIamDb();
  const rows = await db.select().from(table).where(eq(table.tenantId, tenantId));
  return rows.map(toRecord).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listVirtualModels(): Promise<VirtualModelRecord[]> {
  return loadAll(requiredTenantId());
}

export async function listVirtualModelsInternal(): Promise<VirtualModelRecord[]> {
  return loadAll(requiredTenantId());
}

export async function createVirtualModel(raw: Parameters<typeof validateVirtualModelInput>[0]): Promise<VirtualModelRecord> {
  const input = validateVirtualModelInput(raw);
  const tenantId = requiredTenantId();
  const db = getIamDb();
  const existing = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.name, input.name)))
    .limit(1);
  if (existing.length > 0) throw new Error("virtual model name already exists");
  const id = ulid();
  const now = new Date();
  await db.insert(table).values({
    id,
    tenantId,
    name: input.name,
    displayName: input.displayName,
    enabled: input.enabled,
    targets: input.targets,
    createdAt: now,
    updatedAt: now,
  });
  const created = (await loadAll(tenantId)).find((row) => row.id === id);
  if (!created) throw new Error("create virtual model failed");
  return created;
}

export async function updateVirtualModel(
  id: string,
  raw: Parameters<typeof validateVirtualModelInput>[0],
): Promise<VirtualModelRecord> {
  const input: VirtualModelInput = validateVirtualModelInput(raw);
  const tenantId = requiredTenantId();
  const db = getIamDb();
  const current = (await loadAll(tenantId)).find((row) => row.id === id);
  if (!current) throw new Error("virtual model not found");
  const clash = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.name, input.name)))
    .limit(1);
  if (clash.length > 0 && clash[0]?.id !== id) throw new Error("virtual model name already exists");
  await db
    .update(table)
    .set({
      name: input.name,
      displayName: input.displayName,
      enabled: input.enabled,
      targets: input.targets,
      updatedAt: new Date(),
    })
    .where(and(eq(table.tenantId, tenantId), eq(table.id, id)));
  const updated = (await loadAll(tenantId)).find((row) => row.id === id);
  if (!updated) throw new Error("virtual model not found");
  return updated;
}

export async function deleteVirtualModel(id: string): Promise<void> {
  const tenantId = requiredTenantId();
  const current = (await loadAll(tenantId)).find((row) => row.id === id);
  if (!current) throw new Error("virtual model not found");
  const db = getIamDb();
  await db.delete(table).where(and(eq(table.tenantId, tenantId), eq(table.id, id)));
}
