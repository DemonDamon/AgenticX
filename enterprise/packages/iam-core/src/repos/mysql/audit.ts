import { auditEvents } from "@agenticx/db-schema/mysql";
import { ulid } from "ulid";

import type { AuditInsert } from "../audit";
import type { AuditRepository } from "../contracts";
import { getMysqlRepositoryDb } from "./db";

export async function insertMysqlAuditEvent(input: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  const now = new Date();
  await db.insert(auditEvents).values({
    id: ulid(),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    detail: input.detail ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export const mysqlAuditRepository: AuditRepository = {
  dialect: "mysql",
  insertAuditEvent: async (input, dbOrTx) => {
    if (dbOrTx) {
      throw new Error("PostgreSQL transaction cannot be passed to MySQL audit repository");
    }
    await insertMysqlAuditEvent(input);
  },
};
