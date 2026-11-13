import { gatewayInstances } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { desc, lt } from "drizzle-orm";

import {
  coerceDate,
  statusFromStored,
  type GatewayInstanceRepository,
  type GatewayInstanceRow,
} from "../../gateway-instances-model";

function mapRow(row: typeof gatewayInstances.$inferSelect): GatewayInstanceRow {
  return {
    instanceId: row.instanceId,
    tenantScope: row.tenantScope,
    lastSeenAt: coerceDate(row.lastSeenAt),
    updatedAt: coerceDate(row.updatedAt),
    statusJson: statusFromStored(row.statusJson, row.instanceId),
  };
}

export function createGatewayInstanceRepository(): GatewayInstanceRepository {
  return {
    async upsert(row) {
      const db = getIamDb();
      const statusJson = row.statusJson as unknown as Record<string, unknown>;
      await db
        .insert(gatewayInstances)
        .values({
          instanceId: row.instanceId,
          tenantScope: row.tenantScope,
          lastSeenAt: row.lastSeenAt,
          statusJson,
          updatedAt: row.updatedAt,
        })
        .onConflictDoUpdate({
          target: gatewayInstances.instanceId,
          set: {
            tenantScope: row.tenantScope,
            lastSeenAt: row.lastSeenAt,
            statusJson,
            updatedAt: row.updatedAt,
          },
        });
    },
    async deleteLastSeenBefore(cutoff) {
      const db = getIamDb();
      await db.delete(gatewayInstances).where(lt(gatewayInstances.lastSeenAt, cutoff));
    },
    async list() {
      const db = getIamDb();
      const rows = await db.select().from(gatewayInstances).orderBy(desc(gatewayInstances.lastSeenAt));
      return rows.map(mapRow);
    },
  };
}
