import { groupCapabilityIdsByKind } from "@agenticx/config";
import { and, eq, inArray } from "drizzle-orm";

import { dialectCapabilityTables, type DialectQuery } from "../capability-tables";

export async function loadActiveMcpServers(
  tenantId: string,
  capabilityIds: readonly string[],
): Promise<Array<{ id: string; name: string }>> {
  const ids = groupCapabilityIdsByKind(capabilityIds).mcp;
  if (ids.length === 0) return [];
  const tables = await dialectCapabilityTables();
  const query = tables.db as unknown as DialectQuery;
  const rows = (await query
    .select({ id: tables.mcp.id, name: tables.mcp.name })
    .from(tables.mcp)
    .where(
      and(eq(tables.mcp.tenantId, tenantId), eq(tables.mcp.status, "active"), inArray(tables.mcp.id, ids)),
    )) as Array<{ id: string; name: string }>;
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const found: Array<{ id: string; name: string }> = [];
  for (const id of ids) {
    const name = names.get(id)?.trim();
    if (!name) {
      console.warn("room.agent.mcp_missing", { id, tenantId });
      continue;
    }
    found.push({ id, name });
  }
  return found;
}
